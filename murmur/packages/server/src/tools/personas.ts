/**
 * Stage 4 — personas: one tool for the population and for auditing individuals.
 *
 * `plan`/`submit` are the two phases of the same protocol as everywhere else.
 * `inspect`/`edit` act on one member of that population, reading exactly the
 * fields `edit` can change — the same subject seen from two sides.
 *
 * Persona Fabric (Phase B) rides the same tool: `fabricate` mints a
 * deterministic typed-array surrogate population (up to 1,000,000 personas,
 * zero LLM calls), `materialize` lazily interviews one surrogate persona on
 * one claim, and `remember` appends to a persona's memory log. Fabric state
 * (spec + fitted model + memory) persists in the world directory; the
 * population itself replays from the seed and is never stored. Every
 * fabric-derived reply carries the honesty block — personaCount, surrogate
 * holdout metrics and the disclaimer — and uncalibrated claims are labeled
 * UNCALIBRATED.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyPersonas,
  archetypeSharesByName,
  appendMemory,
  buildPersonasTask,
  fabricHonesty,
  fabricate,
  getMemory,
  hashHex,
  lazyPersona,
  personaIdOf,
  resolvePersonaIndex,
  traitMeans,
  CONFIG_LIMITS,
  personaCard,
  personaPatch,
  type Entity,
  type FabricSpec,
  type Persona,
} from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";
import { PERSONAS_OUTPUT } from "./outputs.js";
import { registerTaskTool } from "./tasks.js";
import type { FabricWorldState } from "./fabric-state.js";

export const PERSONAS_TOOL_NAMES = ["personas"] as const;

/** Mirrors the task.outputSchema the engine attaches to personas tasks (engine/src/personas.ts). */
const personaDraftItem = z.object({
  name: z.string().max(80).describe("Full display name, e.g. 'Ada Okafor'"),
  handle: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Platform handle (@name or u/name; generated from the name when omitted)",
    ),
  archetype: z
    .string()
    .max(40)
    .describe("One of the archetype names from the task instructions"),
  bio: z.string().max(200).optional().describe("One line of backstory"),
  traits: z
    .record(z.number())
    .optional()
    .describe(
      "Big-Five-lite traits: openness, conscientiousness, extraversion, agreeableness, emotionalStability (0-1)",
    ),
  stances: z
    .record(z.number().min(-1).max(1))
    .optional()
    .describe("Stance toward each entity by name: {EntityName: -1..1}"),
  platform: z
    .enum(["twitter", "reddit", "both"])
    .describe("twitter | reddit | both"),
  activity: z
    .number()
    .min(0.05)
    .max(1)
    .optional()
    .describe("Posting activity (0.05-1, default 0.5)"),
});

const personaPatchShape = z.object({
  name: z.string().max(80).optional().describe("New display name"),
  handle: z.string().max(40).optional().describe("New platform handle"),
  archetype: z.string().max(40).optional().describe("New archetype name"),
  bio: z.string().max(200).optional().describe("New backstory line"),
  traits: z
    .record(z.number())
    .optional()
    .describe(
      "Trait overrides: {openness?, conscientiousness?, extraversion?, agreeableness?, emotionalStability?} (0-1)",
    ),
  stances: z
    .record(z.number().min(-1).max(1))
    .optional()
    .describe("Stance overrides by entity name: {EntityName: -1..1}"),
  platform: z
    .enum(["twitter", "reddit", "both"])
    .optional()
    .describe("New platform: twitter | reddit | both"),
  activity: z
    .number()
    .min(0.05)
    .max(1)
    .optional()
    .describe("New activity (0.05-1)"),
});

export function registerPersonaTools(
  server: McpServer,
  ctx: ServerContext,
): void {
  registerTaskTool(server, "personas", {
    title: "Draft / store / audit the population",
    description:
      "Stage 4 of the pipeline. action:'plan' composes the population-drafting task (count + archetype distribution " +
      "derived from the ontology, plus a stance hint per entity); complete it and return it with action:'submit'. " +
      "action:'inspect' audits one persona — full record, the compact card that fits in a digest, communities, follows and " +
      "recent posts — recommended before a run to catch low-fidelity personas. action:'edit' surgically fixes one " +
      "persona: only the fields you pass change. Persona Fabric: action:'fabricate' mints a deterministic surrogate " +
      "population (count 1-1,000,000, archetypeWeights, seed; zero LLM calls, replayable) and stores it for the world; " +
      "action:'materialize' interviews one surrogate persona ('#i') on one claim deterministically; " +
      "action:'remember' appends to a persona's memory log. Fabric outputs always print the honesty block " +
      "(personaCount + surrogate metrics + disclaimer) and claims without a fitted model are UNCALIBRATED.",
    inputSchema: {
      action: z
        .enum([
          "plan",
          "submit",
          "inspect",
          "edit",
          "fabricate",
          "materialize",
          "remember",
        ])
        .describe("What to do with the population"),
      world: z
        .string()
        .optional()
        .describe("World id/slug (default: active world)"),
      count: z
        .number()
        .int()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe(
          "Population size — action:'plan' (8-128, default 24) or action:'fabricate' (1-1,000,000 surrogate personas)",
        ),
      hint: z
        .string()
        .max(300)
        .optional()
        .describe(
          "Optional platform-mix hint, e.g. 'mostly reddit' — action:'plan'",
        ),
      task_id: z
        .string()
        .optional()
        .describe(
          "Task id from the plan receipt — required for action:'submit'",
        ),
      result: z
        .union([
          z
            .object({
              personas: z
                .array(personaDraftItem)
                .min(CONFIG_LIMITS.population.min)
                .max(CONFIG_LIMITS.population.max)
                .describe(
                  `The population (min ${CONFIG_LIMITS.population.min}, max ${CONFIG_LIMITS.population.max}) mirroring the task.outputSchema the engine returned`,
                ),
            })
            .describe("Your drafting result: { personas: [...] }"),
          z
            .string()
            .describe("The same result as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe(
          "Your drafting result: { personas: [{name, handle, archetype, bio, traits, stances, platform, activity}] } — action:'submit' only",
        ),
      persona: z
        .string()
        .optional()
        .describe(
          "Persona id or handle (e.g. p_3 or @ada) — action:'inspect' / 'edit'",
        ),
      patch: z
        .union([
          personaPatchShape.describe(
            "Partial persona — only the provided fields change",
          ),
          z
            .string()
            .describe("The same patch as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe(
          "Partial persona: {name?, handle?, archetype?, bio?, traits?, stances?: {EntityName: -1..1}, platform?, activity?} — action:'edit' only",
        ),
      archetypeWeights: z
        .union([
          z.record(z.number()).describe(
            "Fabric archetype mix, e.g. {pragmatic_smb: 2, oss_maintainer: 1} — keys are archetype names",
          ),
          z
            .string()
            .describe("The same weights as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe(
          "Archetype weights for action:'fabricate' (default: uniform over the 8 fabric archetypes)",
        ),
      seed: z
        .string()
        .max(120)
        .optional()
        .describe(
          "Fabric seed — same seed replays the population byte-identically (default: derived from the world seed)",
        ),
      personaId: z
        .string()
        .max(40)
        .optional()
        .describe(
          "Fabric persona index, '#i' or i — action:'materialize' / 'remember'",
        ),
      claimId: z
        .string()
        .max(160)
        .optional()
        .describe(
          "Claim id the persona is interviewed on — action:'materialize'",
        ),
      claimText: z
        .string()
        .max(600)
        .optional()
        .describe(
          "Claim text (used when no claimId exists; hashed into a stable id) — action:'materialize'",
        ),
      text: z
        .string()
        .min(1)
        .max(2000)
        .optional()
        .describe(
          "What the persona said / was told, stored verbatim — action:'remember'",
        ),
    },
    outputSchema: PERSONAS_OUTPUT,
    run: async (args) => {
      try {
        const w = ctx.resolveWorld(args.world);
        if (args.action === "plan") {
          if (args.count !== undefined && (args.count < 8 || args.count > 128)) {
            throw new Error(
              `action:'plan' needs count in 8..128 (got ${args.count}) — populations up to 1,000,000 belong to action:'fabricate'`,
            );
          }
          const task = buildPersonasTask(ctx.storage, w, {
            count: args.count,
            hint: args.hint,
          });
          ctx.audit(w, {
            op: "personas_plan",
            taskId: task.id,
            count: args.count,
          });
          return ctx.reply(
            {
              ok: true,
              taskId: task.id,
              how: "Draft the population per the task instructions (names, handles, archetypes, Big-Five-lite traits, stances toward the listed entities, platform, activity), then call personas({action:'submit', task_id, result}).",
              task,
              next: 'personas({action:"submit", task_id, result})',
            },
            w,
            PERSONAS_OUTPUT,
          );
        }
        if (args.action === "submit") return submit(ctx, args);
        if (args.action === "inspect") return inspect(ctx, w, args.persona);
        if (args.action === "edit") return edit(ctx, w, args);
        if (args.action === "fabricate") return fabricate_(ctx, w, args);
        if (args.action === "materialize") return materialize_(ctx, w, args);
        return remember_(ctx, w, args);
      } catch (e) {
        return ctx.fail(e);
      }
    },
  });
}

function submit(
  ctx: ServerContext,
  args: { task_id?: string; result?: unknown },
) {
  if (!args.task_id)
    throw new Error("action:'submit' needs task_id from the plan receipt");
  const wActive = ctx.resolveWorld(undefined);
  const task = ctx.storage.getTask(wActive.id, args.task_id);
  if (!task)
    throw new Error(
      `unknown task id: ${args.task_id} (no such task in the active world ${wActive.id})`,
    );
  const w = ctx.storage.getWorld(task.worldId);
  if (!w) throw new Error("world for task not found");
  const out = applyPersonas(
    ctx.storage,
    w,
    args.task_id,
    coerceJson(args.result),
  );
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
        ? {
            rejected: out.rejected,
            hint: "fix rejected personas and resubmit the same task_id — already-inserted names are skipped",
          }
        : {}),
      next: okAll
        ? 'personas({action:"inspect", persona}) to audit individuals (recommended), or world_config'
        : "fix the rejected personas and resubmit the same task_id",
    },
    w,
    PERSONAS_OUTPUT,
  );
}

function inspect(
  ctx: ServerContext,
  w: ReturnType<ServerContext["resolveWorld"]>,
  persona?: string,
) {
  if (!persona)
    throw new Error("action:'inspect' needs persona (id or handle)");
  const p = ctx.storage.getPersona(w.id, persona);
  if (!p) throw new Error(`persona not found: ${persona}`);
  const entities = ctx.storage.listEntities(w.id);
  const handles = new Map(
    ctx.storage.listPersonas(w.id).map((x) => [x.id, x.handle]),
  );
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
        .map((x) => ({
          id: x.id,
          round: x.round,
          platform: x.platform,
          kind: x.kind,
          body: x.body.slice(0, 160),
        })),
      next: 'personas({action:"edit", persona, patch}) to fix anything, or world_config',
    },
    w,
    PERSONAS_OUTPUT,
  );
}

function edit(
  ctx: ServerContext,
  w: ReturnType<ServerContext["resolveWorld"]>,
  args: { persona?: string; patch?: unknown },
) {
  if (!args.persona)
    throw new Error("action:'edit' needs persona (id or handle)");
  const p = coerceJson(args.patch);
  if (!p || typeof p !== "object")
    throw new Error("action:'edit' needs a patch object");
  const out = personaPatch(
    ctx.storage,
    w,
    args.persona,
    p as Record<string, unknown>,
  );
  ctx.audit(w, { op: "persona_edit", persona: args.persona });
  return ctx.reply(
    {
      ok: out.rejected.length === 0 && !!out.persona,
      persona: out.persona ? inspectLite(out.persona) : null,
      ...(out.rejected.length ? { rejected: out.rejected } : {}),
      next: 'personas({action:"inspect", persona}) to verify, or world_config',
    },
    w,
    PERSONAS_OUTPUT,
  );
}

// ---------------------------------------------------------------------------
// Persona Fabric (Phase B) — deterministic surrogate populations.
// ---------------------------------------------------------------------------

/** The fabric state a fabric action needs, or a teaching error. */
function requireFabric(
  ctx: ServerContext,
  w: ReturnType<ServerContext["resolveWorld"]>,
): FabricWorldState {
  const state = ctx.fabric.get(w);
  if (!state) {
    throw new Error(
      `no fabric population active for world ${w.slug} — call personas({action:'fabricate', count, seed}) first`,
    );
  }
  return state;
}

function fabricate_(
  ctx: ServerContext,
  w: ReturnType<ServerContext["resolveWorld"]>,
  args: { count?: number; archetypeWeights?: unknown; seed?: string },
) {
  if (!args.count)
    throw new Error("action:'fabricate' needs count (1-1,000,000)");
  let weights: Record<string, number> | undefined;
  if (args.archetypeWeights !== undefined) {
    const parsed = coerceJson(args.archetypeWeights);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        "action:'fabricate' needs archetypeWeights as an object of {archetypeName: weight}",
      );
    }
    weights = parsed as Record<string, number>;
  }
  const seed = args.seed?.trim() || `${w.seed}:fabric`;
  const existing = ctx.fabric.get(w);
  // Per-persona seeding keeps persona #i identical for the same seed even
  // when count changes, so same-seed refabrication can keep persona memory;
  // a different seed addresses different personas and the log starts fresh.
  // The fitted model is trait-space and survives either way.
  const keepMemory = !!existing && existing.spec.seed === seed;
  const spec: FabricSpec = {
    count: args.count,
    seed,
    ...(weights ? { archetypeWeights: weights } : {}),
  };
  const population = fabricate(spec);
  const state: FabricWorldState = {
    worldId: w.id,
    spec,
    model: existing?.model ?? null,
    memory: keepMemory && existing ? existing.memory : [],
    population,
  };
  ctx.fabric.save(w, state);
  ctx.audit(w, {
    op: "personas_fabricate",
    count: population.count,
    seed,
    modelAttached: !!state.model,
  });
  return ctx.reply(
    {
      ok: true,
      fabric: {
        population: population.count,
        seed,
        archetypeShares: archetypeSharesByName(population),
        traitMeans: traitMeans(population),
        modelAttached: !!state.model,
        memoryEntries: state.memory.length,
        honesty: fabricHonesty(state.model, population.count),
      },
      ...(state.model
        ? {}
        : {
            note: "no surrogate model fitted for this world — materialize views are UNCALIBRATED until one is attached",
          }),
      next: 'personas({action:"materialize", personaId, claimId}) to interview individual surrogate personas',
    },
    w,
    PERSONAS_OUTPUT,
  );
}

function materialize_(
  ctx: ServerContext,
  w: ReturnType<ServerContext["resolveWorld"]>,
  args: { personaId?: string; claimId?: string; claimText?: string },
) {
  const state = requireFabric(ctx, w);
  if (!args.personaId)
    throw new Error("action:'materialize' needs personaId ('#i')");
  const claimId =
    args.claimId?.trim() ||
    (args.claimText?.trim()
      ? `text:${hashHex(args.claimText.trim().toLowerCase())}`
      : undefined);
  if (!claimId)
    throw new Error("action:'materialize' needs claimId or claimText");
  const population = ctx.fabric.population(state);
  const view = lazyPersona(
    population,
    state.model,
    args.personaId,
    claimId,
    state.memory,
  );
  ctx.audit(w, {
    op: "persona_materialize",
    personaId: view.personaId,
    claimId,
    calibration: view.calibration,
  });
  return ctx.reply(
    {
      ok: true,
      personaView: view,
      uncalibrated: view.calibration === "uncalibrated",
      next:
        view.calibration === "uncalibrated"
          ? "fit a surrogate for this claim (engine fit()) or treat this view as UNCALIBRATED"
          : 'personas({action:"remember", personaId, text}) to log what this persona said',
    },
    w,
    PERSONAS_OUTPUT,
  );
}

function remember_(
  ctx: ServerContext,
  w: ReturnType<ServerContext["resolveWorld"]>,
  args: { personaId?: string; text?: string },
) {
  const state = requireFabric(ctx, w);
  if (!args.personaId)
    throw new Error("action:'remember' needs personaId ('#i')");
  if (!args.text) throw new Error("action:'remember' needs text (what the persona said)");
  const population = ctx.fabric.population(state);
  // Validate against the population so memory keys are real personas.
  const index = resolvePersonaIndex(population, args.personaId);
  const id = personaIdOf(index);
  state.memory = appendMemory(state.memory, id, args.text);
  ctx.fabric.save(w, state);
  ctx.audit(w, { op: "persona_remember", personaId: id });
  return ctx.reply(
    {
      ok: true,
      personaId: id,
      remembered: getMemory(state.memory, id).length,
      honesty: fabricHonesty(state.model, population.count),
      next: 'personas({action:"materialize", personaId, claimId}) — the view now references this memory deterministically',
    },
    w,
    PERSONAS_OUTPUT,
  );
}

function detailedStances(
  p: Persona,
  entities: Entity[],
): { entity: string; stance: number }[] {
  return Object.entries(p.stances).map(([id, v]) => ({
    entity: entities.find((e) => e.id === id)?.name ?? id,
    stance: v,
  }));
}

function inspectLite(p: Persona): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    handle: p.handle,
    archetype: p.archetype,
    platform: p.platform,
    activity: p.activity,
    stances: p.stances,
  };
}
