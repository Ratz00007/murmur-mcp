/** World management tools: world_init, world_list, world_open, world_status, world_config (thin alias for sim_configure). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG_LIMITS, NEXT_TOOL, worldStatus, type World } from "@murmur/engine";
import type { ServerContext } from "../session.js";
import { applyWorldConfig } from "./sim.js";

export function registerWorldTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "world_init",
    "Create a new simulated world (the container for seeds, ontology, personas, posts and reports). " +
      "Call this first. Returns the stage map — the ordered pipeline and the next tool to call at each stage.",
    {
      name: z.string().min(1).max(80).describe("Short world name, e.g. 'pricing-reaction'"),
      description: z.string().max(400).optional().describe("One line: what question this world should answer"),
      seed: z.string().max(120).optional().describe("Determinism seed — same seed + same submissions replays identically. Omit for auto."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ name, description, seed }) => {
      try {
        const world = ctx.storage.createWorld({ name, description, seed });
        ctx.activeWorldId = world.id;
        ctx.workspace.ensureWorldDir(world.slug);
        ctx.audit(world, { op: "world_init", name });
        return ctx.reply({
          ok: true,
          world: { id: world.id, name: world.name, slug: world.slug, stage: world.stage, seed: world.seed },
          stageMap: STAGE_MAP,
          next: NEXT_TOOL[world.stage],
        }, world);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "world_list",
    "List every saved world in this workspace with stage and progress.",
    {},
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async () => {
      try {
        const worlds = ctx.storage.listWorlds();
        return ctx.reply({
          ok: true,
          active: ctx.activeWorldId,
          worlds: worlds.map((w) => ({
            id: w.id,
            name: w.name,
            slug: w.slug,
            stage: w.stage,
            round: `${w.round}/${w.config.rounds}`,
            description: w.description,
          })),
          next: worlds.length ? "world_open(id) to make one active, or world_init for a new one" : "world_init to create your first world",
        });
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "world_open",
    "Reopen a saved world and resume at its stage boundary (resumability is a core promise).",
    { world: z.string().describe("World id or slug (see world_list)") },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        return ctx.reply({
          ok: true,
          world: { id: w.id, name: w.name, slug: w.slug, stage: w.stage, round: `${w.round}/${w.config.rounds}` },
          stageMap: STAGE_MAP,
          next: NEXT_TOOL[w.stage],
        }, w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "world_status",
    "Single source of truth for session state: stage, counts, pending task, trending entities and the next recommended tool.",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        return ctx.reply(worldStatus(ctx.storage, w), w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "world_config",
    "Backward-compatible alias for sim_configure — the canonical world-parameter setter. Forwards every parameter (rounds, batch sizes, virality " +
      "threshold, response budget) to the same core; the canonical pipeline calls sim_configure after personas_submit, before the first sim_next_batch.",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      rounds: z.number().int().min(1).max(40).optional().describe("Total simulation rounds (default 8, max 40)"),
      max_personas_per_batch: z.number().int().min(1).max(128).optional().describe("Activated personas per sim_next_batch (default 20)"),
      max_feed_items: z.number().int().min(3).max(15).optional().describe("Feed items per persona digest (default 8)"),
      max_response_tokens: z.number().int().min(2000).max(24000).optional().describe("Tool response budget (default 12000)"),
      virality_threshold: z.number().min(1).max(100).optional().describe("Twitter virality trigger (default 12)"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args) => {
      try {
        const updated = applyWorldConfig(ctx, args);
        ctx.audit(updated, { op: "world_config", args });
        return ctx.reply({
          ok: true,
          config: { rounds: updated.config.rounds, batch: updated.config.batch, context: updated.config.context },
          limits: CONFIG_LIMITS,
          next: NEXT_TOOL[updated.stage],
        }, updated);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}

export const STAGE_MAP = [
  { stage: "1 · seeds", tools: "seed_add_files / seed_add_url / seed_add_text → seeds_review", produces: "source material digests" },
  { stage: "2 · ontology", tools: "ontology_plan → ontology_submit", produces: "entities, motives, anchors" },
  { stage: "3 · graph", tools: "graph_build (→ graph_query, graph_export_mermaid)", produces: "typed relations, tensions, communities" },
  { stage: "4 · personas", tools: "personas_plan → personas_submit (→ persona_inspect / persona_edit)", produces: "the simulated population" },
  { stage: "5 · simulation", tools: "sim_configure → [sim_next_batch → sim_submit_generations] × N rounds (+ sim_inject_event between rounds)", produces: "posts, threads, engagement, memory" },
  { stage: "6 · report", tools: "report_plan → report_submit → report_export", produces: ".murmur/reports/{world}/report-N.md" },
  { stage: "7 · interact", tools: "interview_agent, report_agent_ask", produces: "grounded answers, logged dialogues" },
];

export type { World };
