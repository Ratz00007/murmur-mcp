/**
 * Stage 4 — Population. personas_plan composes the drafting task (archetype
 * distribution derived from the ontology); applyPersonas validates, wires the
 * follow graph and community memberships; personaCard renders the ≤120-token
 * digest every activated persona gets each round.
 */
import {
  CONFIG_LIMITS,
  DATA_NOTICE,
  type Entity,
  type GenerationTask,
  type ItemError,
  type MurmurConfig,
  type Persona,
  type Platform,
  type Relation,
  type World,
} from "./types.js";
import { clamp, estTokens, nowIso, round2Safe, slugify, truncate } from "./util/text.js";
import type { Storage } from "./store/storage.js";
import { buildFollowGraph, communitiesFor, findEntity, stanceHint } from "./graph.js";

export const ARCHETYPES = [
  { name: "power user", share: 0.2, description: "deep daily user; technical, loud, opinionated, other people quote them" },
  { name: "casual scroller", share: 0.3, description: "drops in a few times a week; reacts to headlines, rarely argues" },
  { name: "pragmatic skeptic", share: 0.15, description: "wants receipts; questions claims, pricing and motives" },
  { name: "passionate advocate", share: 0.15, description: "identifies with the topic; defends it, evangelizes, takes conflict personally" },
  { name: "curious newcomer", share: 0.1, description: "new to the space; asks basic questions, easily influenced by the feed" },
  { name: "industry professional", share: 0.1, description: "works adjacent to the space; measured, credential-aware, plays chess not checkers" },
];

export const PERSONAS_INSTRUCTIONS = `You are the population designer for a social-simulation engine.
Draft a simulated population of realistic social-media users for the scenario below.
Return a JSON object:
{
  "personas": [
    { "name": "Full Name",
      "handle": "@handle or u/username",
      "archetype": "one of the provided archetypes",
      "bio": "one sentence, max 160 chars, in their own voice",
      "traits": { "openness": 0.0-1.0, "conscientiousness": 0.0-1.0, "extraversion": 0.0-1.0, "agreeableness": 0.0-1.0, "emotionalStability": 0.0-1.0 },
      "stances": { "Entity Name": -1.0 to 1.0 },
      "platform": "twitter" | "reddit" | "both",
      "activity": 0.05-1.0
    }
  ]
}
Rules:
- Follow the requested count and the archetype distribution.
- Stance keys MUST match the provided entity names exactly. Positive = supportive, negative = hostile, 0 = indifferent.
- Mix platforms roughly as suggested; make handles unique; names diverse.
- Personas must feel like individuals, not an editorial committee.
Return ONLY the JSON object.`;

export function buildPersonasTask(storage: Storage, world: World, opts: { count?: number; hint?: string } = {}): GenerationTask {
  const entities = storage.listEntities(world.id);
  if (entities.length === 0) throw new Error("no entities: run ontology_plan / ontology_submit first");
  const count = Math.max(CONFIG_LIMITS.population.min, Math.min(CONFIG_LIMITS.population.max, opts.count ?? CONFIG_LIMITS.population.default));

  // Ontology-derived archetype mix (deterministic)
  const orgish = entities.filter((e) => e.type === "org" || e.type === "person").length / entities.length;
  const productish = entities.filter((e) => e.type === "product").length / entities.length;
  const mix = ARCHETYPES.map((a) => ({ ...a }));
  const adj = (name: string, d: number) => {
    const a = mix.find((m) => m.name === name);
    if (a) a.share = round2Safe(Math.max(0.05, a.share + d));
  };
  if (orgish > 0.25) { adj("industry professional", +0.1); adj("casual scroller", -0.1); }
  if (productish > 0.3) { adj("power user", +0.1); adj("curious newcomer", +0.05); adj("casual scroller", -0.15); }

  const relations = storage.listRelations(world.id);
  const task: GenerationTask = {
    id: storage.nextTaskId(),
    worldId: world.id,
    kind: "personas",
    round: null,
    instructions: `${PERSONAS_INSTRUCTIONS}\n\n${DATA_NOTICE}`,
    outputSchema: {
      type: "object",
      required: ["personas"],
      properties: {
        personas: {
          type: "array",
          minItems: CONFIG_LIMITS.population.min,
          maxItems: CONFIG_LIMITS.population.max,
          items: {
            type: "object",
            required: ["name", "archetype", "platform"],
            properties: {
              name: { type: "string", maxLength: 80 },
              handle: { type: "string", maxLength: 40 },
              archetype: { type: "string", maxLength: 40 },
              bio: { type: "string", maxLength: 200 },
              traits: { type: "object" },
              stances: { type: "object", additionalProperties: { type: "number", minimum: -1, maximum: 1 } },
              platform: { enum: ["twitter", "reddit", "both"] },
              activity: { type: "number", minimum: 0.05, maximum: 1 },
            },
          },
        },
      },
    },
    items: [
      {
        id: "draft-1",
        label: `draft ${count} personas`,
        tokens: 0,
        payload: {
          population: {
            count,
            archetypes: mix,
            entities: entities.map((e) => ({ name: e.name, type: e.type, salience: e.salience, stanceHint: stanceHint(e, relations) })),
            platformMix: opts.hint ?? "roughly 40% twitter-lean, 40% reddit-lean, 20% both",
          },
        },
      },
    ],
    createdAt: nowIso(),
  };
  task.items[0].tokens = estTokens(JSON.stringify(task.items[0].payload));
  storage.saveTask(task);
  return task;
}

export interface PersonasSubmitResult {
  personas: Persona[];
  rejected: ItemError[];
  followEdges: number;
  memberships: number;
  platformBreakdown: Record<string, number>;
  archetypeBreakdown: Record<string, number>;
}

export function applyPersonas(storage: Storage, world: World, taskId: string, submitted: unknown): PersonasSubmitResult {
  const payload = submitted as Record<string, unknown>;
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.personas) ? payload.personas : null;
  if (!raw) throw new Error('submission must be { "personas": [...] }');

  const entities = storage.listEntities(world.id);
  const existingNames = new Set(storage.listPersonas(world.id).map((p) => p.name.toLowerCase() + "|" + p.handle.toLowerCase()));
  const rejected: ItemError[] = [];
  const valid: Omit<Persona, "id" | "worldId" | "createdAt">[] = [];
  const seen = new Set<string>();

  raw.slice(0, CONFIG_LIMITS.population.max).forEach((p: Record<string, unknown>, i: number) => {
    const ref = `personas[${i}]`;
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name) {
      rejected.push({ ref, field: "name", message: "missing or empty name" });
      return;
    }
    const platform = String(p?.platform ?? "twitter") as Platform;
    if (platform !== "twitter" && platform !== "reddit" && platform !== "both") {
      rejected.push({ ref, field: "platform", message: `invalid platform "${p?.platform}"`, hint: "use twitter | reddit | both" });
      return;
    }
    const handle = (typeof p?.handle === "string" && p.handle.trim()) || (platform === "reddit" ? `u/${slugify(name)}` : `@${slugify(name)}`);
    const key = name.toLowerCase() + "|" + handle.toLowerCase();
    if (seen.has(key) || existingNames.has(key)) {
      rejected.push({ ref, field: "name", message: `duplicate persona name/handle: ${name} (${handle})` });
      return;
    }
    const traitsIn = (p?.traits ?? {}) as Record<string, unknown>;
    const traits = {
      openness: clampNum(traitsIn.openness, 0.5),
      conscientiousness: clampNum(traitsIn.conscientiousness, 0.5),
      extraversion: clampNum(traitsIn.extraversion, 0.5),
      agreeableness: clampNum(traitsIn.agreeableness, 0.5),
      emotionalStability: clampNum(traitsIn.emotionalStability, 0.5),
    };
    const stancesIn = (p?.stances ?? {}) as Record<string, unknown>;
    const stances: Record<string, number> = {};
    let badStance: string | null = null;
    for (const [ename, ev] of Object.entries(stancesIn).slice(0, 40)) {
      const ent = findEntity(entities, ename);
      if (!ent) {
        badStance = ename;
        break;
      }
      stances[ent.id] = Math.max(-1, Math.min(1, Number(ev) || 0));
    }
    if (badStance) {
      rejected.push({ ref, field: `stances["${badStance}"]`, message: `unknown entity "${badStance}"`, hint: `valid entities: ${entities.map((e) => e.name).join(", ")}` });
      return;
    }
    if (Object.keys(stances).length === 0) {
      rejected.push({ ref, field: "stances", message: "persona has no stances", hint: "give each persona a stance toward at least one entity" });
      return;
    }
    seen.add(key);
    valid.push({
      name: name.slice(0, 80),
      handle: handle.slice(0, 40),
      archetype: (typeof p?.archetype === "string" ? p.archetype : "casual scroller").slice(0, 40),
      bio: (typeof p?.bio === "string" ? p.bio : "").slice(0, 200),
      traits,
      stances,
      platform,
      activity: clampNum(p?.activity, 0.4, 0.05, 1),
      communityIds: [],
      follows: [],
    });
  });

  if (valid.length < CONFIG_LIMITS.population.min) {
    return {
      personas: [],
      rejected: [...rejected, { ref: "personas", message: `only ${valid.length} valid personas (minimum ${CONFIG_LIMITS.population.min}); fix the rejected items and resubmit this task` }],
      followEdges: 0,
      memberships: 0,
      platformBreakdown: {},
      archetypeBreakdown: {},
    };
  }

  const inserted = storage.insertPersonas(world.id, valid);

  // Wire the social graph deterministically.
  const all = storage.listPersonas(world.id);
  const followsMap = new Map(buildFollowGraph(world, all).map((f) => [f.personaId, f.follows]));
  const communities = buildCommunitiesLocal(entities);
  let memberships = 0;
  let followEdges = 0;
  for (const p of all) {
    const follows = followsMap.get(p.id) ?? p.follows;
    const membership = communitiesFor(p, communities, entities);
    followEdges += follows.length;
    memberships += membership.length;
    storage.patchPersona(p.id, { follows, communityIds: membership });
  }

  storage.setStage(world.id, "populated");
  const platformBreakdown: Record<string, number> = { twitter: 0, reddit: 0, both: 0 };
  const archetypeBreakdown: Record<string, number> = {};
  for (const p of all) {
    platformBreakdown[p.platform] = (platformBreakdown[p.platform] ?? 0) + 1;
    archetypeBreakdown[p.archetype] = (archetypeBreakdown[p.archetype] ?? 0) + 1;
  }
  return { personas: inserted, rejected, followEdges, memberships, platformBreakdown, archetypeBreakdown };
}

function buildCommunitiesLocal(entities: Entity[]): { id: string; entityId: string; name: string }[] {
  return entities
    .filter((e) => e.type === "product" || e.type === "topic" || e.type === "org")
    .map((e) => ({ id: `c_${e.id}`, entityId: e.id, name: `r/${slugify(e.name)}` }));
}

// ---------------------------------------------------------------------------
// Persona card (≤ personaCardTokens) + edit
// ---------------------------------------------------------------------------

export interface PersonaCard {
  card: Record<string, unknown>;
  tokens: number;
}

export function personaCard(persona: Persona, entities: Entity[], config: MurmurConfig): PersonaCard {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const topStances = Object.entries(persona.stances)
    .map(([id, v]) => ({ name: byId.get(id)?.name ?? id, v, score: Math.abs(v) * (byId.get(id)?.salience ?? 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((s) => [s.name, round2Safe(s.v)] as [string, number]);
  const topTraits = Object.entries(persona.traits)
    .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
    .slice(0, 2)
    .map(([k, v]) => [k, round2Safe(v)] as [string, number]);

  let card: Record<string, unknown> = {
    id: persona.id,
    name: persona.name,
    handle: persona.handle,
    archetype: persona.archetype,
    platform: persona.platform,
    activity: round2Safe(persona.activity),
    traits: topTraits,
    stances: topStances,
    bio: truncate(persona.bio, 110),
  };
  let tokens = estTokens(JSON.stringify(card));
  if (tokens > config.batch.personaCardTokens) {
    delete card.bio;
    tokens = estTokens(JSON.stringify(card));
  }
  if (tokens > config.batch.personaCardTokens) {
    card = { ...card, stances: topStances.slice(0, 2) };
    tokens = estTokens(JSON.stringify(card));
  }
  return { card, tokens };
}

/** Validate + apply a partial persona patch (persona_edit). */
export function personaPatch(
  storage: Storage,
  world: World,
  personaId: string,
  patch: Record<string, unknown>
): { persona: Persona | null; rejected: ItemError[] } {
  const persona = storage.getPersona(world.id, personaId);
  if (!persona) return { persona: null, rejected: [{ ref: "persona", message: `persona not found: ${personaId}` }] };
  const rejected: ItemError[] = [];
  const out: Record<string, unknown> = {};

  if (typeof patch.name === "string" && patch.name.trim()) out.name = patch.name.trim().slice(0, 80);
  if (typeof patch.handle === "string" && patch.handle.trim()) out.handle = patch.handle.trim().slice(0, 40);
  if (typeof patch.archetype === "string" && patch.archetype.trim()) out.archetype = patch.archetype.trim().slice(0, 40);
  if (typeof patch.bio === "string") out.bio = patch.bio.slice(0, 200);
  if (patch.platform !== undefined) {
    if (["twitter", "reddit", "both"].includes(String(patch.platform))) out.platform = patch.platform;
    else rejected.push({ ref: "platform", message: `invalid platform "${patch.platform}"` });
  }
  if (patch.activity !== undefined) out.activity = clamp(Number(patch.activity) || 0.4, 0.05, 1);
  if (patch.traits && typeof patch.traits === "object") {
    const t: Record<string, number> = { ...persona.traits };
    for (const [k, v] of Object.entries(patch.traits as Record<string, unknown>)) {
      if (k in t) t[k] = clampNum(v, 0.5);
    }
    out.traits = t;
  }
  if (patch.stances && typeof patch.stances === "object") {
    const entities = storage.listEntities(world.id);
    const s: Record<string, number> = { ...persona.stances };
    for (const [ename, ev] of Object.entries(patch.stances as Record<string, unknown>)) {
      const ent = findEntity(entities, ename);
      if (!ent) {
        rejected.push({ ref: `stances["${ename}"]`, message: `unknown entity "${ename}"` });
        continue;
      }
      s[ent.id] = clamp(Number(ev) || 0, -1, 1);
    }
    out.stances = s;
  }
  if (rejected.length > 0) return { persona, rejected };
  storage.patchPersona(persona.id, out);
  return { persona: storage.getPersona(world.id, persona.id), rejected: [] };
}

function clampNum(v: unknown, dflt: number, lo = 0, hi = 1): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
