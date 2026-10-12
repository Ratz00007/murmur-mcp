/**
 * Slope-jitter sensitivity for the report's projected rounds.
 *
 * WHAT THIS IS: a refit of the least-squares trend line under a seeded
 * perturbation of its slope, summarised as P10/P50/P90 across refits.
 *
 * WHAT THIS IS NOT: an ensemble of simulations, and not an uncertainty
 * interval. The name "ensemble" was removed because it promised robustness
 * that was never computed. Nothing here re-runs the simulation: the observed
 * sentiment curve is carried into every refit unchanged, and only the fitted
 * slope is perturbed. A genuine ensemble would re-sample the mechanism —
 * activation, engagement draws, stance migration, cascade — and the spread
 * would then describe the model's own randomness. This spread describes only
 * the sensitivity of a straight line to its slope.
 *
 * Two consequences callers must honour:
 *   1. The band is IDENTICALLY ZERO on recorded rounds, by construction. The
 *      observed values are the same number in every refit. It carries
 *      information only on projected rounds.
 *   2. It is not a confidence interval for anything in the world. It is a
 *      perturbation analysis of one fit.
 *
 * The refit is deterministic: seeds flow in as `${seed}:${i}` and nothing is
 * drawn here, so identical inputs replay byte-identically.
 */
import { streamRng } from "../util/rng.js";
import { clamp, round2Safe } from "../util/text.js";
import type { Projection } from "../analytics.js";

export interface TrajectoryPoint {
  round: number;
  value: number;
}

/** One round's sensitivity band: 10th / 50th / 90th percentile across refits. */
export interface SensitivityInterval {
  round: number;
  p10: number;
  p50: number;
  p90: number;
}

/** Max refit count (config limit, mirrored here for the clamp). */
export const MAX_SENSITIVITY_REFITS = 10;

/** Linear-interpolation quantile (R type-7) over an unsorted sample. */
function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  if (s.length === 1) return s[0];
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (pos - lo) * (s[hi] - s[lo]);
}

/**
 * Per-round P10/P50/P90 across refitted trajectories. Rounds are the union of
 * every refit's rounds (ascending); refits missing a round are skipped for it.
 * Values are rounded to 2 decimals so rendered reports replay byte-identically.
 */
export function sensitivityIntervals(perFitTrajectories: TrajectoryPoint[][]): SensitivityInterval[] {
  const runs = perFitTrajectories.filter((t) => t.length > 0);
  if (runs.length === 0) return [];
  const rounds = [...new Set(runs.flatMap((t) => t.map((p) => p.round)))].sort((a, b) => a - b);
  const out: SensitivityInterval[] = [];
  for (const round of rounds) {
    const values: number[] = [];
    for (const run of runs) {
      const hit = run.find((p) => p.round === round);
      if (hit) values.push(hit.value);
    }
    if (values.length === 0) continue;
    out.push({
      round,
      p10: round2Safe(quantile(values, 0.1)),
      p50: round2Safe(quantile(values, 0.5)),
      p90: round2Safe(quantile(values, 0.9)),
    });
  }
  return out;
}

/**
 * Run `fitFn` once per refit with derived seeds `${seed}:${i}` (count clamped to
 * [1, MAX_SENSITIVITY_REFITS]). fitFn must be deterministic given its seed.
 */
export function refitSpread(seed: string, count: number, fitFn: (refitSeed: string) => TrajectoryPoint[]): TrajectoryPoint[][] {
  const n = Math.max(1, Math.min(MAX_SENSITIVITY_REFITS, Math.floor(count)));
  const runs: TrajectoryPoint[][] = [];
  for (let i = 0; i < n; i++) runs.push(fitFn(`${seed}:${i}`));
  return runs;
}

/** Slope jitter (±) applied to each refit's trend. Fixed, and documented as such. */
export const SLOPE_JITTER = 0.06;

/**
 * Seeded slope-jitter refits around the least-squares projection of an observed
 * curve (the same fit as analytics.projectCurve). Observed rounds are carried
 * into every refit unchanged — the recorded values are facts, and perturbing
 * them would be fabricating disagreement — while each refit jitters the fitted
 * slope by U(−SLOPE_JITTER, +SLOPE_JITTER) across the `ahead` projected rounds.
 *
 * Returns per-refit trajectories ready for sensitivityIntervals().
 */
export function projectionRefits(seed: string, count: number, curve: TrajectoryPoint[], _projection: Projection, ahead = 2): TrajectoryPoint[][] {
  const n = Math.max(1, Math.min(MAX_SENSITIVITY_REFITS, Math.floor(count)));
  if (curve.length < 2 || n <= 0) return [];
  const sx = curve.reduce((a, p) => a + p.round, 0);
  const sy = curve.reduce((a, p) => a + p.value, 0);
  const sxx = curve.reduce((a, p) => a + p.round * p.round, 0);
  const sxy = curve.reduce((a, p) => a + p.round * p.value, 0);
  const m = curve.length;
  const denom = m * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (m * sxy - sx * sy) / denom;
  const xBar = sx / m;
  const yBar = sy / m;
  const lastRound = curve[curve.length - 1].round;
  // _projection is accepted but not read: the fitted slope is re-derived here
  // so the jitter is exact, and keeping the parameter documents that the
  // caller already holds a projection for the same curve.
  return refitSpread(seed, n, (refitSeed) => {
    const rng = streamRng(refitSeed, "projection");
    const jitteredSlope = slope + (rng.float() * 2 - 1) * SLOPE_JITTER;
    const run: TrajectoryPoint[] = curve.map((p) => ({ round: p.round, value: p.value }));
    for (let i = 1; i <= ahead; i++) {
      const round = lastRound + i;
      run.push({ round, value: round2Safe(clamp(jitteredSlope * (round - xBar) + yBar, -1, 1)) });
    }
    return run;
  });
}
