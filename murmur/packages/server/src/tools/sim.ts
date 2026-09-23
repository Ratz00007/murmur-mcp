/** Simulation tools: sim_configure, sim_next_batch, sim_submit_generations, sim_inject_event, sim_round_summary, sim_timeline. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { batchBrief, buildSimBatch, roundSummary, submitGenerations, timeline, engagementPeaks, type SimGeneration } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";

export function registerSimTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "sim_configure",
    "Stage 5 setup: set rounds (default 8, max 40) and platform parameters. Call after personas_submit (before the first sim_next_batch).",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      rounds: z.number().int().min(1).max(40).optional().describe("Total rounds (default 8, max 40)"),
      virality_threshold: z.number().min(1).max(100).optional().describe("Twitter virality trigger (default 12)"),
      max_personas_per_batch: z.number().int().min(1).max(128).optional().describe("Activated personas per round batch (default 20)"),
      max_feed_items: z.number().int().min(3).max(15).optional().describe("Feed items per persona digest (default 8)"),
    },
    async (args) => {
      try {
        const w = ctx.resolveWorld(args.world);
        const config = structuredClone(w.config);
        if (args.rounds !== undefined) {
          if (args.rounds < w.round) throw new Error(`cannot reduce rounds below completed rounds (${w.round})`);
          config.rounds = args.rounds;
        }
        if (args.virality_threshold !== undefined) config.engagement.viralityThreshold = args.virality_threshold;
        if (args.max_personas_per_batch !== undefined) config.batch.maxPersonas = args.max_personas_per_batch;
        if (args.max_feed_items !== undefined) config.batch.maxFeedItems = args.max_feed_items;
        ctx.storage.updateWorld(w.id, { config });
        if (ctx.storage.countPersonas(w.id) > 0) ctx.storage.setStage(w.id, "configured");
        const updated = ctx.storage.getWorld(w.id)!;
        ctx.audit(w, { op: "sim_configure", rounds: updated.config.rounds });
        return ctx.reply(
          {
            ok: true,
            rounds: updated.config.rounds,
            stage: updated.stage,
            next: "sim_next_batch to start round 1",
          },
          updated
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "sim_next_batch",
    "One round of simulation · PLAN: activates a weighted persona subset and composes their personalized digests (persona card ≤120 tokens, ranked feed, " +
      "working memory, collective view, allowed actions). Complete the task by writing each persona's actions, then submit via sim_submit_generations.",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const { task, targetRound, activated } = buildSimBatch(ctx.storage, w);
        ctx.audit(w, { op: "sim_next_batch", taskId: task.id, round: targetRound, personas: activated.length });
        return ctx.reply(
          {
            ok: true,
            ...batchBrief(task, targetRound),
            how: "For each persona item, write their actions this round (stay in character, react to their actual feed, max 3 actions). Then call sim_submit_generations with this task_id and your array.",
            task,
            next: "sim_submit_generations",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "sim_submit_generations",
    "One round of simulation · SUBMIT: ingests the generated posts/replies/votes, applies platform mechanics (feed ranking, virality, vote gravity), " +
      "runs organic engagement, updates memories and stances, computes round stats and advances the round. Invalid items are itemized; the round holds " +
      "until you fix them or pass finalize.",
    {
      task_id: z.string().describe("Task id from sim_next_batch"),
      generations: z.unknown().describe("Array of { persona: id, actions: [...] } — see the task instructions for action formats"),
      finalize: z.boolean().optional().describe("Force the round to advance even with rejected items (missing personas become lurkers)"),
      use_sampling: z.boolean().optional().describe("Opt-in accelerator: if the client supports MCP sampling, missing personas' actions are generated via sampling"),
    },
    async ({ task_id, generations, finalize, use_sampling }) => {
      try {
        const task = ctx.storage.getTask(task_id);
        if (!task) throw new Error(`unknown task id: ${task_id}`);
        const w = ctx.storage.getWorld(task.worldId);
        if (!w) throw new Error("world for task not found");
        let subs = (Array.isArray(coerceJson(generations)) ? coerceJson(generations) : []) as SimGeneration[];
        let samplingUsed = 0;
        if (use_sampling && ctx.sampling) {
          const patched = await fillViaSampling(ctx, w.id, task, subs);
          subs = patched.subs;
          samplingUsed = patched.added;
        }
        const out = submitGenerations(ctx.storage, w, task_id, subs, { finalize });
        ctx.audit(w, {
          op: "sim_submit_generations",
          taskId: task_id,
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
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "sim_inject_event",
    "God's-eye variable injection: drop an external event (competitor price cut, leaked memo, celebrity opinion…) into the world between rounds. " +
      "Activated personas see it in their next digest and their reactions shift the trajectory — measurable in the next round summary.",
    {
      text: z.string().min(4).max(600).describe("The event, one sentence: 'Competitor undercuts price by 30%'"),
      round: z.number().int().min(1).max(40).optional().describe("Round in which the event lands (default: next round)"),
      type: z.enum(["news", "price", "leak", "opinion", "outage", "other"]).optional().describe("Event flavor (default news)"),
      scope: z.string().max(120).optional().describe("Who notices: 'all' (default), 'twitter', 'reddit', an entity or community name"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ text, round, type, scope, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        if (w.round >= w.config.rounds) {
          throw new Error(`all ${w.config.rounds} rounds complete — extend with sim_configure({rounds: N}) before injecting`);
        }
        const targetRound = Math.max(round ?? w.round + 1, w.round + 1);
        const ev = ctx.storage.addEvent(w.id, targetRound, "injection", { text, subtype: type ?? "news" }, scope ?? "all");
        ctx.audit(w, { op: "sim_inject_event", event: ev.id, round: targetRound });
        return ctx.reply(
          {
            ok: true,
            eventId: ev.id,
            landsInRound: targetRound,
            note: "personas activated in this round will see the event in their digest and remember witnessing it",
            next: w.round === 0 ? "sim_next_batch to start round 1" : `sim_next_batch to continue (round ${w.round + 1})`,
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "sim_round_summary",
    "Compact readout of one round: posts by platform, engagement, sentiment per entity, escalations, movers, lurkers.",
    {
      round: z.number().int().min(1).max(40).optional().describe("Round number (default: latest)"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ round, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const r = round ?? w.round;
        const stats = roundSummary(ctx.storage, w, r);
        if (!stats) throw new Error(`no round ${r} recorded yet (world is at round ${w.round})`);
        return ctx.reply({ ok: true, stats, next: w.round >= w.config.rounds ? "report_plan" : "sim_next_batch" }, w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "sim_timeline",
    "The whole trajectory: per-round posts, engagement, sentiment per entity, escalations and injections — plus engagement peaks (mean + 2σ).",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const rows = timeline(ctx.storage, w);
        return ctx.reply(
          {
            ok: true,
            rounds: w.round,
            of: w.config.rounds,
            timeline: rows,
            engagementPeaks: engagementPeaks(rows),
            next: w.round >= w.config.rounds ? "report_plan" : "sim_next_batch",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// MCP sampling accelerator (opt-in). Fills actions for personas the host
// skipped, via the client's sampling capability. Produces identical
// artifacts to the plan/submit path — it's an accelerator, not a dependency.
// ---------------------------------------------------------------------------

async function fillViaSampling(
  ctx: ServerContext,
  worldId: string,
  task: { items: { id: string; payload: Record<string, unknown>; label: string }[] },
  subs: SimGeneration[]
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
      const text = await ctx.sampling?.(prompt, "You are a social-simulation engine. Output only JSON.", 700);
      if (!text) continue;
      const parsed = JSON.parse(text.trim().replace(/^```(json)?|```$/g, ""));
      const actions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.actions) ? parsed.actions : null;
      if (!actions) continue;
      out.push({ persona: personaId, actions });
      added++;
    } catch {
      // sampling failed for this persona — it will simply lurk
    }
  }
  void worldId;
  return { subs: out, added };
}
