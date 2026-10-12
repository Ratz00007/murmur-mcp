/**
 * Stage 2 — ontology: one tool, two phases of the plan/submit protocol.
 *
 * `ontology({action:"plan"})` hands you the extraction task (digests + the
 * engine's own outputSchema); `ontology({action:"submit", task_id, result})`
 * validates and stores what you produced. Splitting one stage's two phases
 * across two tool names doubled the catalog for no extra information: the
 * submit arguments are entirely determined by the plan receipt.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyOntology, buildOntologyTask, ENTITY_TYPES } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";
import { ONTOLOGY_OUTPUT } from "./outputs.js";
import { registerTaskTool } from "./tasks.js";

export const ONTOLOGY_TOOL_NAMES = ["ontology"] as const;

/** Mirrors the task.outputSchema the engine attaches to ontology tasks (engine/src/ontology.ts). */
const ontologyEntity = z.object({
  name: z.string().max(80).describe("Entity name, e.g. 'Acme Cloud'"),
  type: z.enum(ENTITY_TYPES).describe("person | org | product | topic | place | event | idea"),
  description: z.string().max(400).optional().describe("One sentence: what this entity is in the scenario"),
  salience: z.number().min(0).max(1).optional().describe("Prominence in the source material (0-1)"),
  anchors: z.array(z.string().max(300)).max(6).optional().describe("Verbatim quotes from the seeds anchoring this entity"),
  motives: z.array(z.string().max(200)).max(6).optional().describe("What the entity wants or how the crowd reads it"),
});

export function registerOntologyTools(server: McpServer, ctx: ServerContext): void {
  registerTaskTool(server, "ontology", {
    title: "Extract the ontology (plan / submit)",
    description:
      "Stage 2 of the pipeline. action:'plan' composes the extraction task over all seeds (digests + a strict JSON schema); " +
      "read it, complete it yourself (you are the LLM), and return the result with action:'submit'. One plan extracts the " +
      "whole corpus. Invalid entities are itemized for surgical retry; valid ones are applied immediately, and resubmitting " +
      "the same task_id skips what already landed.",
    inputSchema: {
      action: z.enum(["plan", "submit"]).describe("'plan' returns the task; 'submit' stores your completed task"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
      task_id: z.string().optional().describe("Task id from the plan receipt — required for action:'submit'"),
      result: z
        .union([
          z
            .object({
              entities: z
                .array(ontologyEntity)
                .min(5)
                .max(60)
                .describe("5-60 extracted entities mirroring the task.outputSchema the engine returned"),
            })
            .describe("Your extraction result: { entities: [...] }"),
          z.string().describe("The same result as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe("Your extraction result: { entities: [{name, type, description, salience, anchors, motives}] } — action:'submit' only"),
    },
    outputSchema: ONTOLOGY_OUTPUT,
    run: async (args) => {
      try {
        if (args.action === "plan") {
          const w = ctx.resolveWorld(args.world);
          const task = buildOntologyTask(ctx.storage, w);
          ctx.audit(w, { op: "ontology_plan", taskId: task.id, tokens: task.items[0]?.tokens ?? 0 });
          return ctx.reply(
            {
              ok: true,
              taskId: task.id,
              how: "Complete the task per its instructions (extract entities/motives/anchors from the seed digests), then call ontology({action:'submit', task_id, result}).",
              task,
              next: 'ontology({action:"submit", task_id, result})',
            },
            w,
            ONTOLOGY_OUTPUT
          );
        }
        if (!args.task_id) throw new Error("action:'submit' needs task_id from the plan receipt");
        const wActive = ctx.resolveWorld(undefined);
        const task = ctx.storage.getTask(wActive.id, args.task_id);
        if (!task) throw new Error(`unknown task id: ${args.task_id} (no such task in the active world ${wActive.id})`);
        const w = ctx.storage.getWorld(task.worldId);
        if (!w) throw new Error("world for task not found");
        const out = applyOntology(ctx.storage, w, args.task_id, coerceJson(args.result));
        ctx.audit(w, { op: "ontology_submit", taskId: args.task_id, inserted: out.insertedCount, rejected: out.rejected.length });
        const okAll = out.rejected.length === 0;
        return ctx.reply(
          {
            ok: okAll,
            inserted: out.insertedCount,
            entities: out.entities.slice(0, 40).map((e) => ({ id: e.id, name: e.name, type: e.type, salience: e.salience })),
            skippedExisting: out.skippedExisting,
            ...(out.rejected.length
              ? {
                  rejected: out.rejected,
                  hint: "fix the rejected entities and resubmit the same task_id — valid ones already applied and will be skipped",
                }
              : {}),
            next:
              okAll && out.insertedCount + out.skippedExisting.length > 0
                ? 'graph({action:"build"})'
                : "fix the rejected items and resubmit the same task_id, or add more material and re-plan",
          },
          w,
          ONTOLOGY_OUTPUT
        );
      } catch (e) {
        return ctx.fail(e);
      }
    },
  });
}
