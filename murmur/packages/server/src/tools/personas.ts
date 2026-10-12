/**
 * Stage 4 — personas: one tool for the population and for auditing individuals.
 *
 * `plan`/`submit` are the two phases of the same protocol as everywhere else.
 * `inspect`/`edit` act on one member of that population, reading exactly the
 * fields `edit` can change — the same subject seen from two sides.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyPersonas, buildPersonasTask, CONFIG_LIMITS, personaCard, personaPatch, type Entity, type Persona } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";
import { PERSONAS_OUTPUT } from "./outputs.js";
import { registerTaskTool } from "./tasks.js";

export const PERSONAS_TOOL_NAMES = ["personas"] as const;

/** Mirrors the task.outputSchema the engine attaches to personas tasks (engine/src/personas.ts). */
const personaDraftItem = z.object({
  name: z.string().max(80).describe("Full display name, e.g. 'Ada Okafor'"),
  handle: z.string().max(40).optional().describe("Platform handle (@name or u/name; generated from the name when omitted)"),
  archetype: z.string().max(40).describe("One of the archetype names from the task instructions"),
  bio: z.string().max(200).optional().describe("One line of backstory"),
  traits: z.record(z.number()).optional().describe("Big-Five-lite traits: openness, conscientiousness, extraversion, agreeableness, emotionalStability (0-1)"),
  stances: z.record(z.number().min(-1).max(1)).optional().describe("Stance toward each entity by name: {EntityName: -1..1}"),
  platform: z.enum(["twitter", "reddit", "both"]).describe("twitter | reddit | both"),
  activity: z.number().min(0.05).max(1).optional().describe("Posting activity (0.05-1, default 0.5)"),
});

const personaPatchShape = z.object({
  name: z.string().max(80).optional().describe("New display name"),
  handle: z.string().max(40).optional().describe("New platform handle"),
  archetype: z.string().max(40).optional().describe("New archetype name"),
  bio: z.string().max(200).optional().describe("New backstory line"),
  traits: z.record(z.number()).optional().describe("Trait overrides: {openness?, conscientiousness?, extraversion?, agreeableness?, emotionalStability?} (0-1)"),
  stances: z.record(z.number().min(-1).max(1)).optional().describe("Stance overrides by entity name: {EntityName: -1..1}"),
  platform: z.enum(["twitter", "reddit", "both"]).optional().describe("New platform: twitter | reddit | both"),
  activity: z.number().min(0.05).max(1).optional().describe("New activity (0.05-1)"),
});

export function registerPersonaTools(server: McpServer, ctx: ServerContext): void {
  registerTaskTool(server, "personas", {
    title: "Draft / store / audit the population",
    description:
      "Stage 4 of the pipeline. action:'plan' composes the population-drafting task (count + archetype distribution " +
      "derived from the ontology, plus a stance hint per entity); complete it and return it with action:'submit'. " +
      "action:'inspect' audits one persona — full record, the compact card that fits in a digest, communities, follows and " +
      "recent posts — recommended before a run to catch low-fidelity personas. action:'edit' surgically fixes one " +
      "persona: only the fields you pass change.",
    inputSchema: {
      action: z.enum(["plan", "submit", "inspect", "edit"]).describe("What to do with the population"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
      count: z.number().int().min(8).max(128).optional().describe("Population size (default 24, range 8-128) — action:'plan'"),
      hint: z.string().max(300).optional().describe("Optional platform-mix hint, e.g. 'mostly reddit' — action:'plan'"),
      task_id: z.string().optional().describe("Task id from the plan receipt — required for action:'submit'"),
      result: z
        .union([
          z
            .object({
              personas: z
                .array(personaDraftItem)
                .min(CONFIG_LIMITS.population.min)
                .max(CONFIG_LIMITS.population.max)
                .describe(`The population (min ${CONFIG_LIMITS.population.min}, max ${CONFIG_LIMITS.population.max}) mirroring the task.outputSchema the engine returned`),
            })
            .describe("Your drafting result: { personas: [...] }"),
          z.string().describe("The same result as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe("Your drafting result: { personas: [{name, handle, archetype, bio, traits, stances, platform, activity}] } — action:'submit' only"),
      persona: z.string().optional().describe("Persona id or handle (e.g. p_3 or @ada) — action:'inspect' / 'edit'"),
      patch: z
        .union([
          personaPatchShape.describe("Partial persona — only the provided fields change"),
          z.string().describe("The same patch as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe("Partial persona: {name?, handle?, archetype?, bio?, traits?, stances?: {EntityName: -1..1}, platform?, activity?} — action:'edit' only"),
    },
    outputSchema: PERSONAS_OUTPUT,
    run: async (args) => {
      try {
        const w = ctx.resolveWorld(args.world);
        if (args.action === "plan") {
          const task = buildPersonasTask(ctx.storage, w, { count: args.count, hint: args.hint });
          ctx.audit(w, { op: "personas_plan", taskId: task.id, count: args.count });
          return ctx.reply(
            {
              ok: true,
              taskId: task.id,
              how: "Draft the population per the task instructions (names, handles, archetypes, Big-Five-lite traits, stances toward the listed entities, platform, activity), then call personas({action:'submit', task_id, result}).",
              task,
              next: 'personas({action:"submit", task_id, result})',
            },
            w,
            PERSONAS_OUTPUT
          );
        }
        if (args.action === "submit") return submit(ctx, args);
        if (args.action === "inspect") return inspect(ctx, w, args.persona);
        return edit(ctx, w, args);
      } catch (e) {
        return ctx.fail(e);
      }
    },
  });
}

function submit(ctx: ServerContext, args: { task_id?: string; result?: unknown }) {
  if (!args.task_id) throw new Error("action:'submit' needs task_id from the plan receipt");
  const wActive = ctx.resolveWorld(undefined);
  const task = ctx.storage.getTask(wActive.id, args.task_id);
  if (!task) throw new Error(`unknown task id: ${args.task_id} (no such task in the active world ${wActive.id})`);
  const w = ctx.storage.getWorld(task.worldId);
  if (!w) throw new Error("world for task not found");
  const out = applyPersonas(ctx.storage, w, args.task_id, coerceJson(args.result));
  ctx.audit(w, {
    op: "personas_submit",
    taskId: args.task_id,
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
      ...(out.rejected.length
        ? { rejected: out.rejected, hint: "fix rejected personas and resubmit the same task_id — already-inserted names are skipped" }
        : {}),
      next: okAll
        ? 'personas({action:"inspect", persona}) to audit individuals (recommended), or world_config'
        : "fix the rejected personas and resubmit the same task_id",
    },
    w,
    PERSONAS_OUTPUT
  );
}

function inspect(ctx: ServerContext, w: ReturnType<ServerContext["resolveWorld"]>, persona?: string) {
  if (!persona) throw new Error("action:'inspect' needs persona (id or handle)");
  const p = ctx.storage.getPersona(w.id, persona);
  if (!p) throw new Error(`persona not found: ${persona}`);
  const entities = ctx.storage.listEntities(w.id);
  const handles = new Map(ctx.storage.listPersonas(w.id).map((x) => [x.id, x.handle]));
  return ctx.reply(
    {
      ok: true,
      persona: {
        ...p,
        stancesDetailed: detailedStances(p, entities),
        followsHandles: p.follows.map((id) => handles.get(id) ?? id),
      },
      card: personaCard(p, entities, w.config),
      recentPosts: ctx.storage
        .listPosts(w.id, { personaId: p.id, limit: 10 })
        .map((x) => ({ id: x.id, round: x.round, platform: x.platform, kind: x.kind, body: x.body.slice(0, 160) })),
      next: 'personas({action:"edit", persona, patch}) to fix anything, or world_config',
    },
    w,
    PERSONAS_OUTPUT
  );
}

function edit(ctx: ServerContext, w: ReturnType<ServerContext["resolveWorld"]>, args: { persona?: string; patch?: unknown }) {
  if (!args.persona) throw new Error("action:'edit' needs persona (id or handle)");
  const p = coerceJson(args.patch);
  if (!p || typeof p !== "object") throw new Error("action:'edit' needs a patch object");
  const out = personaPatch(ctx.storage, w, args.persona, p as Record<string, unknown>);
  ctx.audit(w, { op: "persona_edit", persona: args.persona });
  return ctx.reply(
    {
      ok: out.rejected.length === 0 && !!out.persona,
      persona: out.persona ? inspectLite(out.persona) : null,
      ...(out.rejected.length ? { rejected: out.rejected } : {}),
      next: 'personas({action:"inspect", persona}) to verify, or world_config',
    },
    w,
    PERSONAS_OUTPUT
  );
}

function detailedStances(p: Persona, entities: Entity[]): { entity: string; stance: number }[] {
  return Object.entries(p.stances).map(([id, v]) => ({
    entity: entities.find((e) => e.id === id)?.name ?? id,
    stance: v,
  }));
}

function inspectLite(p: Persona): Record<string, unknown> {
  return { id: p.id, name: p.name, handle: p.handle, archetype: p.archetype, platform: p.platform, activity: p.activity, stances: p.stances };
}
