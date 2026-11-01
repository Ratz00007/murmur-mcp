/**
 * Persona Fabric — lazy single-persona materialization + persona memory.
 *
 * `lazyPersona` computes one persona's view on demand straight from the typed
 * arrays and the fitted model — no LLM, no stored per-persona objects. The
 * rationale string is assembled deterministically from the archetype
 * description, the persona's dominant traits and the model's weights.
 *
 * The persona memory log is a value, not a store: `appendMemory` returns a
 * new log and never mutates its input, so there is nothing to lock — the
 * server swaps the reference atomically. Repeated interviews of the same
 * persona + claim return identical output; when the log holds a prior entry
 * for the persona, the view references it verbatim.
 */
import { fabricHonesty, type FabricHonestyBlock } from "./evaluate.js";
import { predict, type SurrogateModel } from "./surrogate.js";
import {
  personaIdOf,
  resolvePersonaIndex,
  type FabricPopulation,
} from "./sample.js";
import { FABRIC_ARCHETYPES, TRAIT_COUNT, TRAIT_KEYS } from "./traits.js";

// ---------------------------------------------------------------------------
// Persona memory log (pure functions over an immutable array)
// ---------------------------------------------------------------------------

export interface FabricMemoryEntry {
  /** Monotonic sequence number within the log (1-based). */
  seq: number;
  /** Canonical persona id ("#i"). */
  personaId: string;
  /** What the persona said / was told, verbatim. */
  text: string;
}

export type FabricMemoryLog = readonly FabricMemoryEntry[];

/**
 * Canonicalize a persona reference for memory keys: numbers and "i"/"#i"
 * strings all collapse to "#i", so "5" and "#5" address the same memory.
 */
function canonicalPersonaId(personaId: string | number): string {
  if (typeof personaId === "number") return personaIdOf(personaId);
  const m = /^#?(\d+)$/.exec(personaId.trim());
  return m ? personaIdOf(Number(m[1])) : personaId.trim();
}

/** All entries for one persona, in append order. Same key rules as appendMemory. */
export function getMemory(
  log: FabricMemoryLog,
  personaId: string,
): FabricMemoryEntry[] {
  const key = canonicalPersonaId(personaId);
  return log.filter((e) => e.personaId === key);
}

/** Append an entry for one persona. Returns a NEW log; the input is untouched. */
export function appendMemory(
  log: FabricMemoryLog,
  personaId: string | number,
  text: string,
): FabricMemoryLog {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("memory text must be non-empty");
  const entry: FabricMemoryEntry = {
    seq: log.length + 1,
    personaId: canonicalPersonaId(personaId),
    text: trimmed,
  };
  return [...log, entry];
}

// ---------------------------------------------------------------------------
// lazyPersona
// ---------------------------------------------------------------------------

export interface PersonaView {
  /** Canonical id, "#i". */
  personaId: string;
  archetype: string;
  archetypeDescription: string;
  /** Trait values keyed by trait name, rounded to 4 decimals. */
  traits: Record<string, number>;
  claimId: string | null;
  /** Signed stance in [-1, 1]; 0 when uncalibrated. */
  stance: number;
  intensity: number;
  topObjectionId: string | null;
  migrationChoiceId: string | null;
  /** "uncalibrated" views must be labeled UNCALIBRATED by every caller. */
  calibration: "calibrated" | "uncalibrated";
  rationale: string;
  /** Prior memory entries for this persona (deterministically referenced). */
  memory: FabricMemoryEntry[];
  honesty: FabricHonestyBlock;
}

/**
 * Materialize one persona's view of one claim. Pure function of its inputs:
 * same population + model + personaId + claimId + memory ⇒ identical output.
 */
export function lazyPersona(
  population: FabricPopulation,
  model: SurrogateModel | null,
  personaId: string | number,
  claimId?: string,
  memory: FabricMemoryLog = [],
): PersonaView {
  const index = resolvePersonaIndex(population, personaId);
  const id = personaIdOf(index);
  const archetype = FABRIC_ARCHETYPES[population.archetype[index]];

  const traits: Record<string, number> = {};
  for (let k = 0; k < TRAIT_COUNT; k++) {
    traits[TRAIT_KEYS[k]] = round4(population.traits[k][index]);
  }

  const prediction = predict(model, traitRow(population, index), claimId);
  // Claim-scoped views use the claim's own head only — no pooled fallback,
  // so a claim without fitted support is honestly labeled UNCALIBRATED.
  const head = claimId
    ? model?.claims[claimId]?.stance ?? null
    : model?.pooledStance ?? null;

  const parts: string[] = [];
  parts.push(
    `Surrogate persona ${id} (${archetype.name}): ${archetype.description}.`,
  );
  parts.push(`Dominant traits: ${dominantTraits(population, index)}.`);
  if (head) {
    parts.push(
      `Model signal: ${modelSignal(head, population, index)}. Stance ${prediction.stance.toFixed(2)} (intensity ${prediction.intensity.toFixed(2)}) on claim ${claimId ?? "(pooled)"}.`,
    );
  } else {
    parts.push(
      `No fitted surrogate head for claim ${claimId ?? "(none given)"} — stance is UNCALIBRATED; archetype and traits only.`,
    );
  }
  const personaMemory = getMemory(memory, id);
  if (personaMemory.length > 0) {
    const last = personaMemory[personaMemory.length - 1];
    parts.push(
      `Previously stated (${personaMemory.length} ${personaMemory.length === 1 ? "entry" : "entries"} in persona memory): "${last.text}".`,
    );
  }

  return {
    personaId: id,
    archetype: archetype.name,
    archetypeDescription: archetype.description,
    traits,
    claimId: claimId ?? null,
    stance: prediction.stance,
    intensity: prediction.intensity,
    topObjectionId: prediction.topObjectionId,
    migrationChoiceId: prediction.migrationChoiceId,
    calibration: prediction.calibration,
    rationale: parts.join(" "),
    memory: personaMemory,
    honesty: fabricHonesty(model, population.count),
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function traitRow(
  population: FabricPopulation,
  index: number,
): number[] {
  const row: number[] = new Array<number>(TRAIT_COUNT);
  for (let k = 0; k < TRAIT_COUNT; k++) row[k] = population.traits[k][index];
  return row;
}

/** The two traits furthest from the neutral midpoint, TRAIT_KEYS-order ties. */
function dominantTraits(population: FabricPopulation, index: number): string {
  const scored = TRAIT_KEYS.map((key, k) => ({
    key,
    v: population.traits[k][index],
    extremity: Math.abs(population.traits[k][index] - 0.5),
  }));
  scored.sort((a, b) => b.extremity - a.extremity);
  return scored
    .slice(0, 2)
    .map((t) => `${t.v >= 0.5 ? "high" : "low"} ${t.key} (${round4(t.v)})`)
    .join(", ");
}

/**
 * What the model's own weights say about this persona's stance: the trait
 * with the strongest signed contribution w_k · (x_k − 0.5) on each side.
 */
function modelSignal(
  head: { weights: number[]; bias: number },
  population: FabricPopulation,
  index: number,
): string {
  let bestPush: { key: string; w: number; v: number; contribution: number } | null =
    null;
  let bestHold: { key: string; w: number; v: number; contribution: number } | null =
    null;
  for (let k = 0; k < TRAIT_COUNT; k++) {
    const w = head.weights[k];
    const v = population.traits[k][index];
    const contribution = w * (v - 0.5);
    if (contribution > 0) {
      if (!bestPush || contribution > bestPush.contribution) {
        bestPush = { key: TRAIT_KEYS[k], w, v, contribution };
      }
    } else if (contribution < 0) {
      if (!bestHold || contribution < bestHold.contribution) {
        bestHold = { key: TRAIT_KEYS[k], w, v, contribution };
      }
    }
  }
  const bits: string[] = [];
  if (bestPush) {
    bits.push(
      `${bestPush.key} weight ${fmtW(bestPush.w)} pushes support`,
    );
  }
  if (bestHold) {
    bits.push(
      `${bestHold.key} weight ${fmtW(bestHold.w)} pushes oppose`,
    );
  }
  return bits.length > 0 ? bits.join(", ") : "model signal neutral";
}

function fmtW(w: number): string {
  return `${w >= 0 ? "+" : "-"}${Math.abs(round4(w)).toFixed(2)}`;
}
