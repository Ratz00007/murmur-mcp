/**
 * Persona Fabric — the trait space every surrogate persona lives in.
 *
 * A fabric persona is NOT an LLM-drafted persona and not a row in the
 * `personas` table: it is a point in a fixed 10-dimensional trait space plus
 * an archetype label, stored in typed arrays so a million of them cost bytes,
 * not objects. All randomness flows from the engine's seeded RNG (util/rng)
 * — same spec, byte-identical population.
 *
 * Honesty: these are surrogate personas. Every fabric-derived output must
 * carry SURROGATE_DISCLAIMER verbatim; nothing in this module may describe a
 * persona as a real person or a count as N independent opinions.
 */

/** The 10 numeric traits, fixed order — model weights and population columns index into this. */
export const TRAIT_KEYS = [
  "priceSensitivity",
  "lockInAversion",
  "ossLoyalty",
  "switchingCost",
  "socialInfluence",
  "riskAversion",
  "platformFluidity",
  "cynicism",
  "detailOrientation",
  "communityCentrality",
] as const;

export type TraitKey = (typeof TRAIT_KEYS)[number];

export const TRAIT_COUNT = TRAIT_KEYS.length;

export const TRAIT_INDEX: Record<TraitKey, number> = Object.fromEntries(
  TRAIT_KEYS.map((k, i) => [k, i]),
) as Record<TraitKey, number>;

export interface FabricArchetype {
  /** Stable archetype key — the fabricate weights and persisted records use it. */
  name: string;
  description: string;
  /** Prior mean per trait, TRAIT_KEYS order, all in [0,1]. */
  mean: readonly number[];
  /** Prior per-trait sd, TRAIT_KEYS order. */
  sd: readonly number[];
}

/** Default sd when an archetype does not narrow one for a trait. */
const DEFAULT_SD = 0.15;

function archetype(
  name: string,
  description: string,
  means: Record<TraitKey, number>,
  sds?: Partial<Record<TraitKey, number>>,
): FabricArchetype {
  return {
    name,
    description,
    mean: TRAIT_KEYS.map((k) => means[k]),
    sd: TRAIT_KEYS.map((k) => sds?.[k] ?? DEFAULT_SD),
  };
}

/**
 * The 8 fabric archetypes. Distinct from the LLM-drafting archetypes in
 * engine/personas.ts (those seed prose personas; these seed numeric trait
 * priors for the deterministic population).
 */
export const FABRIC_ARCHETYPES: readonly FabricArchetype[] = [
  archetype(
    "pragmatic_smb",
    "runs a small business on the product; weighs price against hours saved, allergic to surprises",
    {
      priceSensitivity: 0.62,
      lockInAversion: 0.38,
      ossLoyalty: 0.32,
      switchingCost: 0.5,
      socialInfluence: 0.45,
      riskAversion: 0.58,
      platformFluidity: 0.4,
      cynicism: 0.42,
      detailOrientation: 0.52,
      communityCentrality: 0.3,
    },
    { riskAversion: 0.12, priceSensitivity: 0.12 },
  ),
  archetype(
    "enterprise_ops",
    "procurement-minded operator; long contracts, compliance checklists, hates migration projects",
    {
      priceSensitivity: 0.34,
      lockInAversion: 0.26,
      ossLoyalty: 0.34,
      switchingCost: 0.76,
      socialInfluence: 0.4,
      riskAversion: 0.8,
      platformFluidity: 0.2,
      cynicism: 0.3,
      detailOrientation: 0.8,
      communityCentrality: 0.34,
    },
    { switchingCost: 0.1, riskAversion: 0.1, platformFluidity: 0.1 },
  ),
  archetype(
    "oss_maintainer",
    "maintains pieces of the stack themselves; license terms and vendor capture are personal",
    {
      priceSensitivity: 0.5,
      lockInAversion: 0.85,
      ossLoyalty: 0.94,
      switchingCost: 0.3,
      socialInfluence: 0.7,
      riskAversion: 0.36,
      platformFluidity: 0.74,
      cynicism: 0.55,
      detailOrientation: 0.9,
      communityCentrality: 0.88,
    },
    { ossLoyalty: 0.06, lockInAversion: 0.1, detailOrientation: 0.08 },
  ),
  archetype(
    "hobbyist_selfhoster",
    "self-hosts everything on a homelab; pays in time to avoid paying in fees",
    {
      priceSensitivity: 0.72,
      lockInAversion: 0.8,
      ossLoyalty: 0.84,
      switchingCost: 0.36,
      socialInfluence: 0.5,
      riskAversion: 0.3,
      platformFluidity: 0.8,
      cynicism: 0.6,
      detailOrientation: 0.74,
      communityCentrality: 0.68,
    },
    { platformFluidity: 0.1 },
  ),
  archetype(
    "cost_conscious_indie",
    "solo builder watching every recurring charge; will migrate for a better free tier",
    {
      priceSensitivity: 0.9,
      lockInAversion: 0.66,
      ossLoyalty: 0.6,
      switchingCost: 0.4,
      socialInfluence: 0.36,
      riskAversion: 0.5,
      platformFluidity: 0.7,
      cynicism: 0.5,
      detailOrientation: 0.56,
      communityCentrality: 0.4,
    },
    { priceSensitivity: 0.08 },
  ),
  archetype(
    "vendor_fan",
    "bought into the vendor ecosystem; defaults to defending it in public threads",
    {
      priceSensitivity: 0.2,
      lockInAversion: 0.16,
      ossLoyalty: 0.2,
      switchingCost: 0.8,
      socialInfluence: 0.6,
      riskAversion: 0.4,
      platformFluidity: 0.16,
      cynicism: 0.16,
      detailOrientation: 0.36,
      communityCentrality: 0.46,
    },
    { cynicism: 0.1, lockInAversion: 0.1 },
  ),
  archetype(
    "lurker",
    "reads, rarely posts; opinion exists but is hard to observe from the outside",
    {
      priceSensitivity: 0.5,
      lockInAversion: 0.46,
      ossLoyalty: 0.44,
      switchingCost: 0.5,
      socialInfluence: 0.12,
      riskAversion: 0.6,
      platformFluidity: 0.4,
      cynicism: 0.5,
      detailOrientation: 0.4,
      communityCentrality: 0.1,
    },
    { socialInfluence: 0.08, communityCentrality: 0.08 },
  ),
  archetype(
    "evangelist",
    "loud advocate whose recommendations move others; identity fused with the tooling they praise",
    {
      priceSensitivity: 0.3,
      lockInAversion: 0.42,
      ossLoyalty: 0.74,
      switchingCost: 0.3,
      socialInfluence: 0.94,
      riskAversion: 0.26,
      platformFluidity: 0.6,
      cynicism: 0.2,
      detailOrientation: 0.6,
      communityCentrality: 0.94,
    },
    { socialInfluence: 0.06, communityCentrality: 0.06 },
  ),
];

export const ARCHETYPE_INDEX: Record<string, number> = Object.fromEntries(
  FABRIC_ARCHETYPES.map((a, i) => [a.name, i]),
);

export const ARCHETYPE_NAMES: readonly string[] = FABRIC_ARCHETYPES.map(
  (a) => a.name,
);

/** Hard ceiling on any fabricated population. */
export const MAX_FABRIC_POPULATION = 1_000_000;

/**
 * Mandatory companion of every fabric-derived output. Print it together with
 * the surrogate metrics; never let a fabric number travel without it.
 */
export const SURROGATE_DISCLAIMER =
  "surrogate personas — a compressed model of labeled opinions, not data about real people";

/** Spec for fabricate(): a population size, archetype mix and RNG seed. */
export interface FabricSpec {
  count: number;
  archetypeWeights?: Record<string, number>;
  seed: string;
}

/**
 * Validate + normalize archetype weights into a length-8 probability vector
 * (FABRIC_ARCHETYPES order). Unknown names, negatives and all-zero input are
 * rejected; omitted or empty input yields the uniform mix.
 */
export function normalizeArchetypeWeights(
  input?: Record<string, number>,
): number[] {
  if (!input || Object.keys(input).length === 0) {
    return FABRIC_ARCHETYPES.map(() => 1 / FABRIC_ARCHETYPES.length);
  }
  const out = FABRIC_ARCHETYPES.map(() => 0);
  let total = 0;
  for (const [name, w] of Object.entries(input)) {
    const idx = ARCHETYPE_INDEX[name];
    if (idx === undefined) {
      throw new Error(
        `unknown archetype '${name}' — known archetypes: ${ARCHETYPE_NAMES.join(", ")}`,
      );
    }
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
      throw new Error(`archetype weight for '${name}' must be a number >= 0`);
    }
    out[idx] = w;
    total += w;
  }
  if (total <= 0) {
    throw new Error("archetypeWeights must sum to a positive number");
  }
  return out.map((w) => w / total);
}

/** Clamp a trait sample into [0,1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
