/**
 * Stage 2 — Ontology. ontology_plan composes the extraction task for the
 * host LLM; applyOntology validates and stores the result.
 */
import { DATA_NOTICE, ENTITY_TYPES, type Entity, type EntityType, type GenerationTask, type ItemError, type Seed, type World } from "./types.js";
import { estTokens, nowIso, truncate } from "./util/text.js";
import type { Storage } from "./store/storage.js";

export const ONTOLOGY_INSTRUCTIONS = `You are the extraction intelligence for a social-simulation engine.
Read the seed material below and return a JSON object:
{
  "entities": [
    { "name": "short canonical name",
      "type": "person|org|product|topic|place|event|idea",
      "description": "1-2 sentences of factual grounding",
      "salience": 0.0-1.0,
      "anchors": ["short factual strings this entity is known to be true"],
      "motives": ["what this entity wants, in one clause each"]
    }
  ]
}
Rules:
- Extract 10-30 entities for a typical corpus: actors (people, orgs), artifacts (products), topics of debate, places, events, ideas.
- anchors must be facts stated in the seeds, not inventions. motives may be inferred but stay conservative.
- salience reflects how central the entity is in the material.
- Use stable canonical names; no duplicates.
Return ONLY the JSON object.`;

export function buildOntologyTask(storage: Storage, world: World): GenerationTask {
  const seeds: Seed[] = storage.listSeeds(world.id);
  if (seeds.length === 0) throw new Error("no seeds: attach material with seed_add_files / seed_add_url / seed_add_text first");
  // Budget: cap the total digest payload so the task stays well under the
  // response limit, trimming the longest digests first.
  const budgetChars = 24000;
  let used = 0;
  const payloads = seeds.map((s) => {
    let digest = s.digest;
    const remaining = budgetChars - used;
    if (remaining <= 200) digest = truncate(digest, 200);
    else if (digest.length > remaining) digest = truncate(digest, remaining);
    used += digest.length;
    return { title: s.title, kind: s.kind, ref: s.ref, bytes: s.bytes, text: `<seed>${digest}</seed>` };
  });
  const task: GenerationTask = {
    id: storage.nextTaskId(),
    worldId: world.id,
    kind: "ontology",
    round: null,
    instructions: `${ONTOLOGY_INSTRUCTIONS}\n\n${DATA_NOTICE}`,
    outputSchema: {
      type: "object",
      required: ["entities"],
      properties: {
        entities: {
          type: "array",
          minItems: 5,
          maxItems: 60,
          items: {
            type: "object",
            required: ["name", "type"],
            properties: {
              name: { type: "string", maxLength: 80 },
              type: { enum: [...ENTITY_TYPES] },
              description: { type: "string", maxLength: 400 },
              salience: { type: "number", minimum: 0, maximum: 1 },
              anchors: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 6 },
              motives: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 6 },
            },
          },
        },
      },
    },
    items: [
      {
        id: "extract-1",
        label: "entity/motive/anchor extraction over all seeds",
        tokens: 0,
        payload: { seeds: payloads },
      },
    ],
    createdAt: nowIso(),
  };
  task.items[0].tokens = estTokens(JSON.stringify(task.items[0].payload));
  storage.saveTask(task);
  return task;
}

export interface OntologySubmitResult {
  entities: Entity[];
  rejected: ItemError[];
  insertedCount: number;
  skippedExisting: string[];
}

export function applyOntology(storage: Storage, world: World, taskId: string, submitted: unknown): OntologySubmitResult {
  const payload = normalizeSubmission(submitted);
  const rawEntities = Array.isArray(payload) ? payload : Array.isArray(payload?.entities) ? payload.entities : null;
  if (!rawEntities) {
    throw new Error('submission must be { "entities": [...] } (or a bare array of entities)');
  }
  const rejected: ItemError[] = [];
  const valid: Entity[] = [];
  const seen = new Set<string>();
  rawEntities.slice(0, 80).forEach((e: Record<string, unknown>, i: number) => {
    const ref = `entities[${i}]`;
    const name = typeof e?.name === "string" ? e.name.trim() : "";
    if (!name) {
      rejected.push({ ref, field: "name", message: "missing or empty name" });
      return;
    }
    if (seen.has(name.toLowerCase())) {
      rejected.push({ ref, field: "name", message: `duplicate name in submission: ${name}` });
      return;
    }
    let type = typeof e?.type === "string" ? e.type.trim().toLowerCase() : "topic";
    if (!(ENTITY_TYPES as readonly string[]).includes(type)) {
      rejected.push({ ref, field: "type", message: `unknown type "${e?.type}"`, hint: `use one of ${ENTITY_TYPES.join("|")} — defaulting would hide typos, so fix and retry` });
      return;
    }
    const description = typeof e?.description === "string" ? e.description.trim().slice(0, 500) : "";
    const salience = clampNum(e?.salience, 0.5, 0, 1);
    const anchors = stringArray(e?.anchors, 6, 300);
    const motives = stringArray(e?.motives, 6, 240);
    seen.add(name.toLowerCase());
    valid.push({ id: "", worldId: world.id, name: name.slice(0, 80), type: type as EntityType, description, salience, anchors, motives });
  });
  const { inserted, skipped } = storage.insertEntities(world.id, valid);
  if (inserted.length > 0) storage.setStage(world.id, "ontologized");
  return { entities: inserted, rejected, insertedCount: inserted.length, skippedExisting: skipped };
}

function clampNum(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function stringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim().slice(0, maxLen)).slice(0, maxItems);
}

/** Accepts { result: X }, { entities: X } or bare X for forgiving hosts. */
export function normalizeSubmission(submitted: unknown): Record<string, unknown> {
  if (submitted == null || typeof submitted !== "object") return {};
  const o = submitted as Record<string, unknown>;
  if ("result" in o && o.result != null && typeof o.result === "object") return o.result as Record<string, unknown>;
  return o;
}
