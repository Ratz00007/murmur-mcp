/** Ontology tools: ontology_plan, ontology_submit (the plan/submit pair for stage 2). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyOntology, buildOntologyTask, estTokens } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";

export function registerOntologyTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "ontology_plan",
    "Stage 2 · PLAN: compose the extraction task over all seeds (digests + strict JSON schema). Read the returned task, complete it yourself " +
      "(you are the LLM), and return the result via ontology_submit. One call extracts the whole corpus.",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
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
    "Stage 2 · SUBMIT: validate and store the extracted ontology. Invalid entities are itemized for surgical retry; valid ones are applied immediately.",
    {
      task_id: z.string().describe("Task id from ontology_plan"),
      result: z.unknown().describe("Your extraction result: { entities: [{name, type, description, salience, anchors, motives}] }"),
    },
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
