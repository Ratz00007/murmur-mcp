/**
 * Persona Fabric — deterministic population sampling.
 *
 * Persona i is derived from its own seed (`murmur-fabric:<seed>:<i>`), so a
 * persona's traits are stable no matter how large the population is: persona
 * #7 of a 100-persona run IS persona #7 of a 1,000,000-persona run. Archetype
 * assignment walks one master stream in persona order, which is deterministic
 * for a fixed seed but does depend on count — the traits (the part models
 * consume) do not.
 *
 * Storage is typed arrays, one column per trait plus archetype ids and
 * per-persona seeds. There are no per-persona objects at rest, ever: at 1M
 * personas a JS object array would be gigabytes, the columns are ~85MB.
 */
import {
  ARCHETYPE_NAMES,
  clamp01,
  FABRIC_ARCHETYPES,
  MAX_FABRIC_POPULATION,
  normalizeArchetypeWeights,
  TRAIT_COUNT,
  TRAIT_KEYS,
  type FabricSpec,
} from "./traits.js";
import { hashString, mulberry32 } from "../util/rng.js";

/**
 * A fabricated population. `traits[k][i]` is persona i's value for
 * TRAIT_KEYS[k]; `archetype[i]` indexes FABRIC_ARCHETYPES; `personaSeed[i]`
 * is the persona's private 32-bit RNG seed (also the replay key).
 */
export interface FabricPopulation {
  readonly count: number;
  /** The spec this population was fabricated from (replay provenance). */
  readonly spec: FabricSpec;
  /** One Float64Array per trait, TRAIT_KEYS order. */
  readonly traits: readonly Float64Array[];
  readonly archetype: Uint8Array;
  readonly personaSeed: Uint32Array;
}

/**
 * Fabricate a deterministic surrogate population.
 *
 * Same {count, archetypeWeights, seed} ⇒ byte-identical typed arrays. No
 * unseeded randomness is consulted anywhere (Box-Muller consumes the
 * persona's own seeded stream; no unseeded PRNG, no wall clock, no crypto).
 */
export function fabricate(spec: FabricSpec): FabricPopulation {
  const count = spec.count;
  if (!Number.isInteger(count) || count < 1 || count > MAX_FABRIC_POPULATION) {
    throw new Error(
      `count must be an integer in [1, ${MAX_FABRIC_POPULATION}] (got ${String(count)})`,
    );
  }
  if (typeof spec.seed !== "string" || spec.seed.trim().length === 0) {
    throw new Error("seed must be a non-empty string");
  }
  const weights = normalizeArchetypeWeights(spec.archetypeWeights);

  const master = mulberry32(hashString(`murmur-fabric:${spec.seed}`));
  // Cumulative distribution for weighted archetype assignment.
  const cum = new Float64Array(weights.length);
  let acc = 0;
  for (let k = 0; k < weights.length; k++) {
    acc += weights[k];
    cum[k] = acc;
  }
  cum[weights.length - 1] = 1; // guard float drift so the walk never falls off

  const traits: Float64Array[] = [];
  for (let k = 0; k < TRAIT_COUNT; k++) traits.push(new Float64Array(count));
  const archetype = new Uint8Array(count);
  const personaSeed = new Uint32Array(count);

  for (let i = 0; i < count; i++) {
    const seed = hashString(`murmur-fabric:${spec.seed}:${i}`);
    personaSeed[i] = seed;

    const r = master();
    let a = 0;
    while (a < weights.length - 1 && r >= cum[a]) a++;
    archetype[i] = a;

    const prior = FABRIC_ARCHETYPES[a];
    const rng = mulberry32(seed);
    for (let k = 0; k < TRAIT_COUNT; k++) {
      traits[k][i] = clamp01(prior.mean[k] + prior.sd[k] * gaussian(rng));
    }
  }

  return {
    count,
    spec: {
      count,
      seed: spec.seed,
      ...(spec.archetypeWeights
        ? { archetypeWeights: { ...spec.archetypeWeights } }
        : {}),
    },
    traits,
    archetype,
    personaSeed,
  };
}

/** Standard normal via Box-Muller (cos branch); consumes 2 uniforms. */
function gaussian(rng: () => number): number {
  let u1 = rng();
  while (u1 <= 1e-12) u1 = rng(); // log(0) guard
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Resolve a persona reference ("#12", "12", or 12) to a population index.
 * Throws on anything else — fabric personas are only addressable by index.
 */
export function resolvePersonaIndex(
  population: FabricPopulation,
  personaId: string | number,
): number {
  const raw =
    typeof personaId === "number"
      ? personaId
      : personaId.trim().replace(/^#/, "");
  const idx = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(idx) || idx < 0 || idx >= population.count) {
    throw new Error(
      `personaId must be an integer in [0, ${population.count - 1}] as a number or '#i' (got ${String(personaId)})`,
    );
  }
  return idx;
}

/** Canonical display id for a persona index. */
export function personaIdOf(index: number): string {
  return `#${index}`;
}

/** Persona counts per archetype (FABRIC_ARCHETYPES order). */
export function archetypeCounts(population: FabricPopulation): number[] {
  const counts = new Array<number>(FABRIC_ARCHETYPES.length).fill(0);
  for (let i = 0; i < population.count; i++) counts[population.archetype[i]]++;
  return counts;
}

/** Archetype share as a name-keyed record for receipts (rounded, sums to 1). */
export function archetypeSharesByName(
  population: FabricPopulation,
): Record<string, number> {
  const counts = archetypeCounts(population);
  const out: Record<string, number> = {};
  ARCHETYPE_NAMES.forEach((name, i) => {
    out[name] = round6(counts[i] / population.count);
  });
  return out;
}

/** Per-trait population means, keyed by trait name, rounded to 6 decimals. */
export function traitMeans(population: FabricPopulation): Record<string, number> {
  const out: Record<string, number> = {};
  for (let k = 0; k < TRAIT_COUNT; k++) {
    const col = population.traits[k];
    let s = 0;
    for (let i = 0; i < population.count; i++) s += col[i];
    out[TRAIT_KEYS[k]] = round6(s / population.count);
  }
  return out;
}

/** Round to 6 decimals — the precision every fabric aggregate is printed at. */
export function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
