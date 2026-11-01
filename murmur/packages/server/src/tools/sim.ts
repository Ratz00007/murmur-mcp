/**
 * Stage 5 — simulation: one tool for the round loop, the god's-eye injection
 * and the trajectory readouts.
 *
 * `next_batch` and `submit` are the two halves of a round; `inject` drops an
 * external variable in between rounds; `summary` and `timeline` read the
 * trajectory back. All five act on the same world state through the same
 * engine, so they are five actions of one tool.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  batchBrief,
  buildSimBatch,
  fabricHonesty,
  roundSummary,
  submitGenerations,
  timeline,
  engagementPeaks,
  type SimGeneration,
} from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";
import { SIM_OUTPUT } from "./outputs.js";
import { registerTaskTool } from "./tasks.js";

export const SIM_TOOL_NAMES = ["sim"] as const;

/** Mirrors the task.outputSchema the engine attaches to sim batches (sim/batch.ts). */
const simGenerationItem = z.object({
  persona: z
    .string()
    .min(1)
    .describe("Persona id from the batch task, e.g. 'p_3'"),
  actions: z
    .array(z.object({ type: z.string() }).passthrough())
    .max(3)
    .describe(
      "1-3 action objects (post/reply/like/comment/upvote/downvote/quote) — see the task instructions for exact fields",
    ),
});

export function registerSimTools(server: McpServer, ctx: ServerContext): void {
  registerTaskTool(server, "sim", {
    title: "Run a round, inject an event, read the trajectory",
    description:
      "Stage 5 of the pipeline. action:'next_batch' activates a weighted persona subset and composes their personalized " +
      "digests (persona card <=120 tokens, ranked feed, working memory, collective view, allowed actions) — complete the " +
      "task by writing each persona's actions, then hand them back with action:'submit'. action:'submit' ingests the " +
      "generated posts/replies/votes, applies platform mechanics (feed ranking, virality, vote gravity), runs organic " +
      "engagement, updates memories and stances, computes round stats and advances the round; invalid items are " +
      "itemized and the round holds until you fix them or pass finalize, and resubmitting the same task_id skips " +
      "already-applied personas. action:'inject' drops an external event (competitor price cut, leaked memo, celebrity " +
      "opinion) into the world between rounds; activated personas see it in their next digest and their reactions shift " +
      "the trajectory. action:'summary' reads one round back, action:'timeline' reads the whole trajectory including " +
      "engagement peaks (mean + 2 sigma).",
    inputSchema: {
      action: z
        .enum(["next_batch", "submit", "inject", "summary", "timeline"])
        .describe("Which half of the simulation to drive"),
      world: z
        .string()
        .optional()
        .describe("World id/slug (default: active world)"),
      task_id: z
        .string()
        .optional()
        .describe(
          "Task id from action:'next_batch' — required for action:'submit'",
        ),
      generations: z
        .union([
          z
            .array(simGenerationItem)
            .describe(
              "Array of { persona: id, actions: [...] } — mirrors the task.outputSchema the engine returned",
            ),
          z
            .string()
            .describe("The same array as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe(
          "Array of { persona: id, actions: [...] } — see the task instructions for action formats",
        ),
      finalize: z
        .boolean()
        .optional()
        .describe(
          "Force the round to advance even with rejected items (missing personas become lurkers)",
        ),
      use_sampling: z
        .boolean()
        .optional()
        .describe(
          "Opt-in accelerator: if the client supports MCP sampling, missing personas' actions are generated via sampling",
        ),
      text: z
        .string()
        .min(4)
        .max(600)
        .optional()
        .describe(
          "The event, one sentence: 'Competitor undercuts price by 30%' — action:'inject'",
        ),
      round: z
        .number()
        .int()
        .min(1)
        .max(40)
        .optional()
        .describe(
          "Round the event lands in (default: next), or the round to summarise",
        ),
      type: z
        .enum(["news", "price", "leak", "opinion", "outage", "other"])
        .optional()
        .describe("Event flavor (default news) — action:'inject'"),
      scope: z
        .string()
        .max(120)
        .optional()
        .describe(
          "Who notices: 'all' (default), 'twitter', 'reddit', an entity or community name — action:'inject'",
        ),
    },
    outputSchema: SIM_OUTPUT,
    run: async (args) => {
      try {
        switch (args.action) {
          case "next_batch":
            return nextBatch(ctx, args.world);
          case "submit":
            return submitGenerations_(ctx, args);
          case "inject":
            return inject(ctx, args);
          case "summary":
            return summary(ctx, args.world, args.round);
          default:
            return timeline_(ctx, args.world);
        }
      } catch (e) {
        return ctx.fail(e);
      }
    },
  });
}

function nextBatch(ctx: ServerContext, world?: string) {
  const w = ctx.resolveWorld(world);
  const { task, targetRound, activated } = buildSimBatch(ctx.storage, w);
  ctx.audit(w, {
    op: "sim_next_batch",
    taskId: task.id,
    round: targetRound,
    personas: activated.length,
  });
  return ctx.reply(
    {
      ok: true,
      ...batchBrief(task, targetRound),
      how: "For each persona item, write their actions this round (stay in character, react to their actual feed, max 3 actions). Then call sim({action:'submit', task_id, generations}).",
      task,
      next: 'sim({action:"submit", task_id, generations})',
    },
    w,
    SIM_OUTPUT,
  );
}

async function submitGenerations_(
  ctx: ServerContext,
  args: {
    task_id?: string;
    generations?: unknown;
    finalize?: boolean;
    use_sampling?: boolean;
  },
) {
  if (!args.task_id)
    throw new Error(
      "action:'submit' needs task_id from the next_batch receipt",
    );
  const wActive = ctx.resolveWorld(undefined);
  const task = ctx.storage.getTask(wActive.id, args.task_id);
  if (!task)
    throw new Error(
      `unknown task id: ${args.task_id} (no such task in the active world ${wActive.id})`,
    );
  const w = ctx.storage.getWorld(task.worldId);
  if (!w) throw new Error("world for task not found");
  let subs = (
    Array.isArray(coerceJson(args.generations))
      ? coerceJson(args.generations)
      : []
  ) as SimGeneration[];
  let samplingUsed = 0;
  if (args.use_sampling && ctx.sampling) {
    const patched = await fillViaSampling(ctx, w.id, task, subs);
    subs = patched.subs;
    samplingUsed = patched.added;
  }
  const out = submitGenerations(ctx.storage, w, args.task_id, subs, {
    finalize: args.finalize,
  });
  ctx.audit(w, {
    op: "sim_submit_generations",
    taskId: args.task_id,
    round: out.round,
    posts: out.postsCreated,
    rejected: out.rejected.length,
    advanced: out.advanced,
  });
  return ctx.reply(
    {
      ok: out.rejected.length === 0,
      ...(samplingUsed ? { samplingUsed } : {}),
      round: out.round,
      advanced: out.advanced,
      completed: out.completed,
      appliedPersonas: out.appliedPersonas.length,
      lurkers: out.lurkers.length,
      postsCreated: out.postsCreated,
      ...(out.stats
        ? {
            statsDigest: {
              round: out.stats.round,
              postsByPlatform: out.stats.postsByPlatform,
              engagement: out.stats.engagement,
              sentimentByEntity: out.stats.sentimentByEntity,
              escalations: out.stats.escalations.length,
              topMovers: out.stats.topMovers.slice(0, 4),
            },
          }
        : {}),
      ...(out.rejected.length ? { rejected: out.rejected } : {}),
      next: out.next,
    },
    w,
    SIM_OUTPUT,
  );
}

function inject(
  ctx: ServerContext,
  args: {
    world?: string;
    text?: string;
    round?: number;
    type?: string;
    scope?: string;
  },
) {
  if (!args.text)
    throw new Error("action:'inject' needs text — the event, in one sentence");
  const w = ctx.resolveWorld(args.world);
  if (w.round >= w.config.rounds) {
    throw new Error(
      `all ${w.config.rounds} rounds complete — extend with world_config({rounds: N}) before injecting`,
    );
  }
  const targetRound = Math.max(args.round ?? w.round + 1, w.round + 1);
  const ev = ctx.storage.addEvent(
    w.id,
    targetRound,
    "injection",
    { text: args.text, subtype: args.type ?? "news" },
    args.scope ?? "all",
  );
  ctx.audit(w, { op: "sim_inject_event", event: ev.id, round: targetRound });
  return ctx.reply(
    {
      ok: true,
      eventId: ev.id,
      landsInRound: targetRound,
      note: "personas activated in this round will see the event in their digest and remember witnessing it",
      next:
        w.round === 0
          ? 'sim({action:"next_batch"}) to start round 1'
          : `sim({action:"next_batch"}) to continue (round ${w.round + 1})`,
    },
    w,
    SIM_OUTPUT,
  );
}

function summary(ctx: ServerContext, world?: string, round?: number) {
  const w = ctx.resolveWorld(world);
  const r = round ?? w.round;
  const stats = roundSummary(ctx.storage, w, r);
  if (!stats)
    throw new Error(
      `no round ${r} recorded yet (world is at round ${w.round})`,
    );
  // When a fabric population is active the round's population framing is
  // surrogate-derived — the honesty block rides on every aggregate readout.
  const fab = ctx.fabric.get(w);
  return ctx.reply(
    {
      ok: true,
      stats,
      ...(fab
        ? {
            fabric: {
              active: true as const,
              honesty: fabricHonesty(fab.model, fab.spec.count),
            },
          }
        : {}),
      next:
        w.round >= w.config.rounds
          ? 'report({action:"plan"})'
          : 'sim({action:"next_batch"})',
    },
    w,
    SIM_OUTPUT,
  );
}

function timeline_(ctx: ServerContext, world?: string) {
  const w = ctx.resolveWorld(world);
  const rows = timeline(ctx.storage, w);
  const fab = ctx.fabric.get(w);
  return ctx.reply(
    {
      ok: true,
      rounds: w.round,
      of: w.config.rounds,
      timeline: rows,
      engagementPeaks: engagementPeaks(rows),
      ...(fab
        ? {
            fabric: {
              active: true as const,
              honesty: fabricHonesty(fab.model, fab.spec.count),
            },
          }
        : {}),
      next:
        w.round >= w.config.rounds
          ? 'report({action:"plan"})'
          : 'sim({action:"next_batch"})',
    },
    w,
    SIM_OUTPUT,
  );
}

// ---------------------------------------------------------------------------
// MCP sampling accelerator (opt-in). Fills actions for personas the host
// skipped, via the client's sampling capability. Produces identical
// artifacts to the plan/submit path — it's an accelerator, not a dependency.
// ---------------------------------------------------------------------------

async function fillViaSampling(
  ctx: ServerContext,
  _worldId: string,
  task: {
    items: { id: string; payload: Record<string, unknown>; label: string }[];
  },
  subs: SimGeneration[],
): Promise<{ subs: SimGeneration[]; added: number }> {
  const covered = new Set(subs.map((s) => String(s.persona)));
  const out = [...subs];
  let added = 0;
  for (const item of task.items) {
    const personaId = String(item.id).replace(/^persona-/, "");
    if (covered.has(personaId)) continue;
    const digest = item.payload as Record<string, unknown>;
    const prompt =
      `You are simulating a social-media user. Persona card: ${JSON.stringify(digest.persona)}\n` +
      `Memory: ${JSON.stringify(digest.memory)}\nFeed: ${JSON.stringify(digest.feed)}\n` +
      `Collective: ${JSON.stringify(digest.collective)}\nAllowed actions: ${JSON.stringify(digest.allowedActions)}\n` +
      `Write 1-2 actions this persona takes now. Return ONLY a JSON array of action objects (types like post/reply/like/comment/upvote), max 3.`;
    try {
      const text = await ctx.sampling?.(
        prompt,
        "You are a social-simulation engine. Output only JSON.",
        700,
      );
      if (!text) continue;
      const parsed = JSON.parse(text.trim().replace(/^```(json)?|```$/g, ""));
      const actions = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.actions)
          ? parsed.actions
          : null;
      if (!actions) continue;
      out.push({ persona: personaId, actions });
      added++;
    } catch {
      // sampling failed for this persona — it will simply lurk
    }
  }
  return { subs: out, added };
}
