/** Persona tools: personas_plan, personas_submit, persona_inspect, persona_edit. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyPersonas, buildPersonasTask, personaCard, personaPatch, type Persona } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";

export function registerPersonaTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "personas_plan",
    "Stage 4 · PLAN: compose the population-drafting task (count + archetype distribution derived from the ontology + stance hints per entity). " +
      "Complete it and return the result via personas_submit.",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      count: z.number().int().min(8).max(128).optional().describe("Population size (default 24, range 8-128)"),
      hint: z.string().max(300).optional().describe("Optional platform-mix hint, e.g. 'mostly reddit'"),
    },
    async ({ world, count, hint }) => {
      try {
        const w = ctx.resolveWorld(world);
        const task = buildPersonasTask(ctx.storage, w, { count, hint });
        ctx.audit(w, { op: "personas_plan", taskId: task.id, count });
        return ctx.reply(
          {
            ok: true,
            taskId: task.id,
            how: "Draft the population per the task instructions (names, handles, archetypes, Big-Five-lite traits, stances toward the listed entities, platform, activity), then call personas_submit with this task_id and your result.",
            task,
            next: "personas_submit",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "personas_submit",
    "Stage 4 · SUBMIT: validate and store the population (8-128 personas). Bad personas are itemized; the population also gets its follow graph and community memberships wired here.",
    {
      task_id: z.string().describe("Task id from personas_plan"),
      result: z.unknown().describe("Your drafting result: { personas: [{name, handle, archetype, bio, traits, stances, platform, activity}] }"),
    },
    async ({ task_id, result }) => {
      try {
        const task = ctx.storage.getTask(task_id);
        if (!task) throw new Error(`unknown task id: ${task_id}`);
        const w = ctx.storage.getWorld(task.worldId);
        if (!w) throw new Error("world for task not found");
        const submitted = coerceJson(result);
        const out = applyPersonas(ctx.storage, w, task_id, submitted);
        ctx.audit(w, {
          op: "personas_submit",
          taskId: task_id,
          personas: out.personas.length,
          rejected: out.rejected.length,
          follows: out.followEdges,
        });
        const okAll = out.rejected.length === 0 && out.personas.length > 0;
        return ctx.reply(
          {
            ok: okAll,
            population: out.personas.length,
            personaIds: out.personas.map((p) => p.id),
            platformBreakdown: out.platformBreakdown,
            archetypeBreakdown: out.archetypeBreakdown,
            followEdges: out.followEdges,
            communityMemberships: out.memberships,
            ...(out.rejected.length ? { rejected: out.rejected, hint: "fix rejected personas and resubmit the same task_id — already-inserted names are skipped" } : {}),
            next: okAll ? "persona_inspect to audit individuals (recommended), or sim_configure" : "fix and resubmit",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "persona_inspect",
    "Audit one persona: full record, compact card (what fits in a digest), communities, follows and recent posts. Use before a run to catch low-fidelity personas.",
    {
      persona: z.string().describe("Persona id or handle (e.g. p_3 or @ada)"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ persona, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const p = ctx.storage.getPersona(w.id, persona);
        if (!p) throw new Error(`persona not found: ${persona}`);
        const entities = ctx.storage.listEntities(w.id);
        const card = personaCard(p, entities, w.config);
        const all = ctx.storage.listPersonas(w.id);
        const handles = new Map(all.map((x) => [x.id, x.handle]));
        const stances = Object.entries(p.stances).map(([id, v]) => ({
          entity: entities.find((e) => e.id === id)?.name ?? id,
          stance: v,
        }));
        const posts = ctx.storage
          .listPosts(w.id, { personaId: p.id, limit: 10 })
          .map((x) => ({ id: x.id, round: x.round, platform: x.platform, kind: x.kind, body: x.body.slice(0, 160) }));
        return ctx.reply(
          {
            ok: true,
            persona: { ...p, stancesDetailed: stances, followsHandles: p.follows.map((id) => handles.get(id) ?? id) },
            card,
            recentPosts: posts,
            next: "persona_edit to fix anything, or sim_configure",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "persona_edit",
    "Fix an individual persona before (or during) a run: rename, re-voice, retarget stances, change platform or activity. Surgical — only provided fields change.",
    {
      persona: z.string().describe("Persona id or handle"),
      patch: z.unknown().describe("Partial persona: {name?, handle?, archetype?, bio?, traits?, stances?: {EntityName: -1..1}, platform?, activity?}"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ persona, patch, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const p = coerceJson(patch);
        if (!p || typeof p !== "object") throw new Error("patch must be an object");
        const out = personaPatch(ctx.storage, w, persona, p as Record<string, unknown>);
        ctx.audit(w, { op: "persona_edit", persona });
        return ctx.reply(
          {
            ok: out.rejected.length === 0 && !!out.persona,
            persona: out.persona ? inspectLite(out.persona) : null,
            ...(out.rejected.length ? { rejected: out.rejected } : {}),
            next: "persona_inspect to verify, or sim_configure",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}

function inspectLite(p: Persona): Record<string, unknown> {
  return { id: p.id, name: p.name, handle: p.handle, archetype: p.archetype, platform: p.platform, activity: p.activity, stances: p.stances };
}
