/**
 * Persona Fabric — mass evaluation.
 *
 * Runs a fitted surrogate over the whole population in typed-array passes:
 * per persona the work is a handful of multiply-adds, and nothing is
 * allocated per persona (scratch buffers are hoisted to one allocation per
 * call). 1,000,000 personas × 3 claims must complete well under 5 seconds —
 * the unit test pins a generous 5000ms ceiling so Windows CI parallelism
 * never makes the assertion flaky.
 *
 * Honesty: the returned block carries personaCount, the surrogate's holdout
 * metrics and the disclaimer verbatim. A claim without a fitted head is
 * reported with calibrated:false and the caller must label it UNCALIBRATED.
 */
import { round6, type FabricPopulation } from "./sample.js";
import type { SurrogateModel } from "./surrogate.js";
import { SURROGATE_DISCLAIMER, TRAIT_COUNT } from "./traits.js";

/** A claim to evaluate: stable id plus optional display text. */
export interface FabricClaimInput {
  id: string;
  text?: string;
}

/** The honesty block every fabric-derived output must carry. */
export interface FabricHonestyBlock {
  personaCount: number;
  surrogate: {
    holdoutAccuracy: number;
    labeledCount: number;
    effectiveSampleSize: number;
  };
  disclaimer: string;
}

export interface ClaimAggregate {
  claimId: string;
  /** False when the model has no fitted head for this claim (UNCALIBRATED). */
  calibrated: boolean;
  /** Stance counts: support / neutral / oppose. */
  stance: { support: number; neutral: number; oppose: number };
  /** Same distribution as shares of the population, rounded to 6 decimals. */
  stanceShares: { support: number; neutral: number; oppose: number };
  meanStance: number;
  /**
   * (committed ÷ population) × (0.5 + 0.5 × camp balance) — the same
   * reparameterization the report uses; it is NOT an uncertainty measure.
   */
  polarization: number;
  /** Histogram of argmax objection ids (only when a fitted head exists). */
  objectionHistogram: { id: string; count: number; share: number }[];
}

export interface FabricEvaluation {
  personaCount: number;
  claims: ClaimAggregate[];
  /** Global migration-choice shares over the population. */
  migrationShares: { choiceId: string; count: number; share: number }[];
  honesty: FabricHonestyBlock;
}

/** |stance| at or above this counts as committed (below is neutral). */
const STANCE_BAND = 0.1;

/** Build the honesty block for a model + population size. */
export function fabricHonesty(
  model: SurrogateModel | null,
  personaCount: number,
): FabricHonestyBlock {
  return {
    personaCount,
    surrogate: {
      holdoutAccuracy: model?.metrics.holdoutAccuracy ?? 0,
      labeledCount: model?.metrics.labeledCount ?? 0,
      effectiveSampleSize: model?.metrics.effectiveSampleSize ?? 0,
    },
    disclaimer: SURROGATE_DISCLAIMER,
  };
}

/**
 * Evaluate the model over the whole population for every claim.
 *
 * Deterministic; no allocations inside the persona loops. Scratch buffers
 * are sized once (O(count) floats) and reused across claims and heads.
 */
export function massEvaluate(
  model: SurrogateModel | null,
  population: FabricPopulation,
  claims: readonly FabricClaimInput[],
): FabricEvaluation {
  if (claims.length === 0) {
    throw new Error("massEvaluate needs at least one claim");
  }
  const seen = new Set<string>();
  for (const c of claims) {
    if (!c.id || typeof c.id !== "string") {
      throw new Error("every claim needs a non-empty string id");
    }
    if (seen.has(c.id)) throw new Error(`duplicate claim id: ${c.id}`);
    seen.add(c.id);
  }

  const n = population.count;
  const traits = population.traits;

  // Hoisted scratch buffers — one allocation per call, reused everywhere.
  // `score` holds the current class/persona logits; objBest/objArg hold the
  // running argmax for whichever multinomial head is being walked.
  const score = new Float64Array(n);
  const objBest = new Float64Array(n);
  const objArg = new Int32Array(n);

  const claimAggregates: ClaimAggregate[] = [];
  for (const claim of claims) {
    const head = model?.claims[claim.id]?.stance ?? null;
    const objHead = model?.claims[claim.id]?.objections ?? null;
    if (!head || n === 0) {
      claimAggregates.push({
        claimId: claim.id,
        calibrated: false,
        stance: { support: 0, neutral: 0, oppose: 0 },
        stanceShares: { support: 0, neutral: 0, oppose: 0 },
        meanStance: 0,
        polarization: 0,
        objectionHistogram: [],
      });
      continue;
    }

    // Stance pass: z = bias + Σ w_k · trait_k, column-major for cache locality.
    const w = head.weights;
    for (let i = 0; i < n; i++) score[i] = head.bias;
    for (let k = 0; k < TRAIT_COUNT; k++) {
      const wk = w[k];
      if (wk === 0) continue;
      const col = traits[k];
      for (let i = 0; i < n; i++) score[i] += wk * col[i];
    }

    let support = 0;
    let neutral = 0;
    let oppose = 0;
    let stanceSum = 0;
    for (let i = 0; i < n; i++) {
      // logistic(score) mapped to [-1, 1]; committed beyond ±STANCE_BAND.
      const s = 2 / (1 + Math.exp(-score[i])) - 1;
      stanceSum += s;
      if (s >= STANCE_BAND) support++;
      else if (s <= -STANCE_BAND) oppose++;
      else neutral++;
    }

    // Objection argmax pass (per claim, when the model has a head for it).
    const objCounts = new Map<string, number>();
    if (objHead) {
      argmaxInto(objHead, traits, score, objBest, objArg, n);
      for (let i = 0; i < n; i++) {
        const id = objHead.classes[objArg[i]];
        objCounts.set(id, (objCounts.get(id) ?? 0) + 1);
      }
    }

    const committed = support + oppose;
    const balance =
      committed > 0 && support > 0 && oppose > 0
        ? Math.min(support, oppose) / Math.max(support, oppose)
        : 0;
    claimAggregates.push({
      claimId: claim.id,
      calibrated: true,
      stance: { support, neutral, oppose },
      stanceShares: {
        support: round6(support / n),
        neutral: round6(neutral / n),
        oppose: round6(oppose / n),
      },
      meanStance: round6(stanceSum / n),
      polarization: round6((committed / n) * (0.5 + 0.5 * balance)),
      objectionHistogram: [...objCounts.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([id, count]) => ({ id, count, share: round6(count / n) })),
    });
  }

  // Migration share table: one argmax pass over the global head, independent
  // of claims — a persona's migration choice does not depend on the claim.
  const migrationShares: { choiceId: string; count: number; share: number }[] =
    [];
  const migHead = model?.migration ?? null;
  if (migHead && n > 0) {
    argmaxInto(migHead, traits, score, objBest, objArg, n);
    const counts = new Array<number>(migHead.classes.length).fill(0);
    for (let i = 0; i < n; i++) counts[objArg[i]]++;
    migHead.classes.forEach((id, c) => {
      migrationShares.push({
        choiceId: id,
        count: counts[c],
        share: round6(counts[c] / n),
      });
    });
  }

  return {
    personaCount: n,
    claims: claimAggregates,
    migrationShares,
    honesty: fabricHonesty(model, n),
  };
}

/**
 * Column-major argmax over a softmax head: score = bias_c + Σ w_ck · trait_k
 * for every persona, keeping the best class per persona in objBest/objArg.
 * First class wins ties — deterministic.
 */
function argmaxInto(
  head: { classes: string[]; weights: number[][]; biases: number[] },
  traits: readonly Float64Array[],
  score: Float64Array,
  best: Float64Array,
  arg: Int32Array,
  n: number,
): void {
  best.fill(-Infinity);
  for (let c = 0; c < head.classes.length; c++) {
    const row = head.weights[c];
    const biasC = head.biases[c];
    for (let i = 0; i < n; i++) score[i] = biasC;
    for (let k = 0; k < TRAIT_COUNT; k++) {
      const wk = row[k];
      if (wk === 0) continue;
      const col = traits[k];
      for (let i = 0; i < n; i++) score[i] += wk * col[i];
    }
    for (let i = 0; i < n; i++) {
      if (c === 0 || score[i] > best[i]) {
        best[i] = score[i];
        arg[i] = c;
      }
    }
  }
}
