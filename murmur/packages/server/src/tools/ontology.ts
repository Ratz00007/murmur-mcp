/** Ontology tools: ontology_plan, ontology_submit (the plan/submit pair for stage 2). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyOntology, buildOntologyTask, ENTITY_TYPES, estTokens } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";

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
  server.tool(
    "ontology_plan",
    "Stage 2 · PLAN: compose the extraction task over all seeds (digests + strict JSON schema). Read the returned task, complete it yourself " +
      "(you are the LLM), and return the result via ontology_submit. One call extracts the whole corpus.",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const task = buildOntologyTask(ctx.storage, w);
        ctx.audit(w, { op: "ontology_plan", taskId: task.id, tokens: task.items[0]?.tokens ?? 0 });
        return ctx.reply(
          {
            ok: true,
            taskId: task.id,
            how: "Complete the task per its instructions (extract entities/motives/anchors from the seed digests), then call ontology_submit with this task_id and your result.",
            task,
            next: "ontology_submit",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "ontology_submit",
    "Stage 2 · SUBMIT: validate and store the extracted ontology. Invalid entities are itemized for surgical retry; valid ones are applied immediately. " +
      "Resubmitting the same task_id skips already-applied entities.",
    {
      task_id: z.string().describe("Task id from ontology_plan"),
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
        .describe("Your extraction result: { entities: [{name, type, description, salience, anchors, motives}] }"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ task_id, result }) => {
      try {
        const task = ctx.storage.getTask(task_id);
        if (!task) throw new Error(`unknown task id: ${task_id}`);
        const w = ctx.storage.getWorld(task.worldId);
        if (!w) throw new Error("world for task not found");
        const submitted = coerceJson(result);
        const out = applyOntology(ctx.storage, w, task_id, submitted);
        ctx.audit(w, { op: "ontology_submit", taskId: task_id, inserted: out.insertedCount, rejected: out.rejected.length });
        const okAll = out.rejected.length === 0;
        return ctx.reply(
          {
            ok: okAll,
            inserted: out.insertedCount,
            entities: out.entities.slice(0, 40).map((e) => ({ id: e.id, name: e.name, type: e.type, salience: e.salience })),
            skippedExisting: out.skippedExisting,
            ...(out.rejected.length ? { rejected: out.rejected, hint: "fix the rejected entities and resubmit the same task_id — valid ones already applied and will be skipped" } : {}),
            next: okAll && out.insertedCount + out.skippedExisting.length > 0 ? "graph_build" : "fix rejected items and resubmit, or add more seeds and re-run ontology_plan",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  void estTokens;
}
