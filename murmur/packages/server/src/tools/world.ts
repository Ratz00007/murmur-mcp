/**
 * World tools: world_init, world_list (list / open / status), world_config.
 *
 * `world_config` is the single world-parameter setter. It used to exist twice
 * — as `world_config` and as `sim_configure` — with field-for-field identical
 * input and the same `applyWorldConfig` core, and the module that owned the
 * core (`sim.ts`) was imported by the module that owned the world. The core
 * now lives here, with the world, and `sim.ts` no longer exports it.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG_LIMITS, NEXT_TOOL, worldStatus, type World } from "@murmur/engine";
import type { ServerContext } from "../session.js";
import { WORLD_CONFIG_OUTPUT, WORLD_INIT_OUTPUT, WORLD_LIST_OUTPUT } from "./outputs.js";

export const WORLD_TOOL_NAMES = ["world_init", "world_list", "world_config"] as const;

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/**
 * The one world-parameter setter, shared by every caller.
 *
 * Safe to call at any point in a run: it only ever tightens or widens limits,
 * never discards state, and it moves the stage to "configured" as soon as a
 * population exists.
 */
export function applyWorldConfig(
  ctx: ServerContext,
  args: {
    world?: string;
    rounds?: number;
    virality_threshold?: number;
    max_personas_per_batch?: number;
    max_feed_items?: number;
    max_response_tokens?: number;
  }
): World {
  const w = ctx.resolveWorld(args.world);
  const config = structuredClone(w.config);
  if (args.rounds !== undefined) {
    if (args.rounds < w.round) throw new Error(`cannot reduce rounds below the completed round count (${w.round})`);
    config.rounds = args.rounds;
  }
  if (args.virality_threshold !== undefined) config.engagement.viralityThreshold = args.virality_threshold;
  if (args.max_personas_per_batch !== undefined) config.batch.maxPersonas = args.max_personas_per_batch;
  if (args.max_feed_items !== undefined) config.batch.maxFeedItems = args.max_feed_items;
  if (args.max_response_tokens !== undefined) config.context.maxResponseTokens = args.max_response_tokens;
  ctx.storage.updateWorld(w.id, { config });
  if (ctx.storage.countPersonas(w.id) > 0) ctx.storage.setStage(w.id, "configured");
  return ctx.storage.getWorld(w.id)!;
}

export function registerWorldTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "world_init",
    {
      title: "Create a world",
      description:
        "Create a new simulated world (the container for seeds, ontology, personas, posts and reports). " +
        "Call this first. Returns the stage map — the ordered pipeline and the next tool to call at each stage.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Short world name, e.g. 'pricing-reaction'"),
        description: z.string().max(400).optional().describe("One line: what question this world should answer"),
        seed: z.string().max(120).optional().describe("Determinism seed — same seed + same submissions replays identically. Omit for auto."),
      },
      outputSchema: WORLD_INIT_OUTPUT,
      annotations: WRITE,
    },
    async ({ name, description, seed }) => {
      try {
        const world = ctx.storage.createWorld({ name, description, seed });
        ctx.activeWorldId = world.id;
        ctx.workspace.ensureWorldDir(world.slug);
        ctx.audit(world, { op: "world_init", name });
        return ctx.reply(
          {
            ok: true,
            world: { id: world.id, name: world.name, slug: world.slug, stage: world.stage, seed: world.seed },
            stageMap: STAGE_MAP,
            next: NEXT_TOOL[world.stage],
          },
          world,
          WORLD_INIT_OUTPUT
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.registerTool(
    "world_list",
    {
      title: "List / open / inspect worlds",
      description:
        "Navigate worlds. detail:'rows' lists every world in the workspace (default when no `world` is given); " +
        "detail:'open' makes the named world active so later calls resolve to it (default when `world` is given); " +
        "detail:'status' returns the full session readout for a world — stage, counts, pending task, trending entities, next step. " +
        "Use it to resume after a crash: 'open' the world and read its 'status'.",
      inputSchema: {
        world: z.string().optional().describe("World id or slug (default: the active world)"),
        detail: z.enum(["rows", "open", "status"]).optional().describe("What to return (default: 'rows' with no world, 'open' with one)"),
      },
      outputSchema: WORLD_LIST_OUTPUT,
      annotations: READ,
    },
    async ({ world, detail }) => {
      try {
        const mode = detail ?? (world && world.trim() ? "open" : "rows");
        if (mode === "rows") {
          const worlds = ctx.storage.listWorlds();
          return ctx.reply(
            {
              ok: true,
              active: ctx.activeWorldId,
              worlds: worlds.map((w) => ({
                id: w.id,
                name: w.name,
                slug: w.slug,
                stage: w.stage,
                round: `${w.round}/${w.config.rounds}`,
                personas: ctx.storage.countPersonas(w.id),
                posts: ctx.storage.countPosts(w.id),
                description: w.description,
              })),
              next: worlds.length
                ? "world_list({world: id}) to make one active, or world_init for a new one"
                : "world_init to create your first world",
            },
            undefined,
            WORLD_LIST_OUTPUT
          );
        }
        if (mode === "open" && !(world && world.trim())) {
          throw new Error("detail:'open' needs a world — pass world: <id or slug> (see detail:'rows')");
        }
        const w = ctx.resolveWorld(world);
        if (mode === "open") {
          return ctx.reply(
            {
              ok: true,
              world: { id: w.id, name: w.name, slug: w.slug, stage: w.stage, round: `${w.round}/${w.config.rounds}` },
              stageMap: STAGE_MAP,
              next: NEXT_TOOL[w.stage],
            },
            w,
            WORLD_LIST_OUTPUT
          );
        }
        // The engine's worldStatus carries the storage-world shape (round as a
        // NUMBER, plus rounds/seed), but the wire contract for `world` is the
        // row shape (round as "3/8"). Spreading the engine object straight
        // through is exactly the mismatch a strict client rejects — a number
        // where the schema promises a string — so the world is normalised here
        // and the rest of the status passes through untouched.
        const status = worldStatus(ctx.storage, w);
        return ctx.reply(
          {
            ok: true,
            ...status,
            world: { id: w.id, name: w.name, slug: w.slug, stage: w.stage, round: `${w.round}/${w.config.rounds}` },
          },
          w,
          WORLD_LIST_OUTPUT
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.registerTool(
    "world_config",
    {
      title: "Tune world parameters",
      description:
        "The world-parameter setter: tune rounds (default 8, max 40), batch sizes, platform limits and the response " +
        "budget in one call. The pipeline calls it after the population is drafted, before the first simulation round — " +
        "but it is safe any time before or during a run. Returns the stored config and the engine's hard limits.",
      inputSchema: {
        world: z.string().optional().describe("World id/slug (default: active world)"),
        rounds: z.number().int().min(1).max(40).optional().describe("Total simulation rounds (default 8, max 40)"),
        virality_threshold: z.number().min(1).max(100).optional().describe("Twitter virality trigger (default 8)"),
        max_personas_per_batch: z.number().int().min(1).max(128).optional().describe("Activated personas per sim batch (default 20)"),
        max_feed_items: z.number().int().min(3).max(15).optional().describe("Feed items per persona digest (default 8)"),
        max_response_tokens: z.number().int().min(2000).max(24000).optional().describe("Tool response budget (default 12000)"),
      },
      outputSchema: WORLD_CONFIG_OUTPUT,
      annotations: WRITE_IDEMPOTENT,
    },
    async (args) => {
      try {
        const updated = applyWorldConfig(ctx, args);
        ctx.audit(updated, { op: "world_config", args });
        return ctx.reply(
          {
            ok: true,
            config: { rounds: updated.config.rounds, batch: updated.config.batch, context: updated.config.context },
            limits: CONFIG_LIMITS,
            stage: updated.stage,
            rounds: updated.config.rounds,
            next: NEXT_TOOL[updated.stage],
          },
          updated,
          WORLD_CONFIG_OUTPUT
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}

export const STAGE_MAP = [
  { stage: "1 · seeds", tools: 'seed_add({source:"files"|"url"|"text"}) → seeds_review', produces: "source material digests" },
  { stage: "2 · ontology", tools: 'ontology({action:"plan"}) → ontology({action:"submit"})', produces: "entities, motives, anchors" },
  { stage: "3 · graph", tools: 'graph({action:"build"}) (then action:"query" / "export")', produces: "typed relations, tensions, communities" },
  { stage: "4 · personas", tools: 'personas({action:"plan"}) → personas({action:"submit"}) (then "inspect" / "edit")', produces: "the simulated population" },
  { stage: "5 · simulation", tools: 'world_config → [sim({action:"next_batch"}) → sim({action:"submit"})] × N rounds (+ action:"inject" between rounds)', produces: "posts, threads, engagement, memory" },
  { stage: "6 · report", tools: 'report({action:"plan"}) → report({action:"submit"}) → report({action:"export"})', produces: ".murmur/reports/{world}/report-N.md" },
  { stage: "7 · interact", tools: 'interact({target:"persona"|"run"})', produces: "grounded answers, logged dialogues" },
];

export type { World };
