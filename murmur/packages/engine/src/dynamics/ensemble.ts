/**
 * Phase-2 science — ensemble uncertainty quantification for the report's
 * simulated projection (replaces the old 2-point linear "forecast").
 *
 * Two pure, deterministic helpers:
 *   - ensembleIntervals(perRunTrajectories): per-round P10 / P50 / P90
 *     quantile bands across per-run trajectories.
 *   - simulateEnsemble(seed, runCount, simFn): run a trajectory generator
 *     once per seeded run, deriving run seeds as `${seed}:${i}` so identical
 *     ensembles replay byte-identically. runCount is clamped to [1, 10]
 *     (config default 5, max 10 — see MurmurConfig.ensemble in types.ts);
 *     runCount <= 0 means "disabled" and callers fall back to a single-run
 *     trend line with an honest label.
 *
 * No unseeded randomness: seeds flow in, nothing is drawn here.
 */
import { streamRng } from "../util/rng.js";
import { clamp, round2Safe } from "../util/text.js";
import type { Projection } from "../analytics.js";

export interface TrajectoryPoint {
  round: number;
  value: number;
}

/** One round's uncertainty band: 10th / 50th / 90th percentile across runs. */
export interface EnsembleInterval {
  round: number;
  p10: number;
  p50: number;
  p90: number;
}

/** Max ensemble size (config limit, mirrored here for the helper's clamp). */
export const MAX_ENSEMBLE_RUNS = 10;

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
 * Per-round P10/P50/P90 bands across per-run trajectories. Rounds are the
 * union of every run's rounds (sorted ascending); runs missing a round are
 * skipped for that round. Values are rounded to 2 decimals so rendered
 * reports replay byte-identically.
 */
export function ensembleIntervals(perRunTrajectories: TrajectoryPoint[][]): EnsembleInterval[] {
  const runs = perRunTrajectories.filter((t) => t.length > 0);
  if (runs.length === 0) return [];
  const rounds = [...new Set(runs.flatMap((t) => t.map((p) => p.round)))].sort((a, b) => a - b);
  const out: EnsembleInterval[] = [];
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
 * Run `simFn` once per ensemble member with derived seeds `${seed}:${i}`
 * (runCount clamped to [1, MAX_ENSEMBLE_RUNS]). simFn must be deterministic
 * given its seed — typically by calling streamRng(runSeed, <stream key>>).
 */
export function simulateEnsemble(seed: string, runCount: number, simFn: (runSeed: string) => TrajectoryPoint[]): TrajectoryPoint[][] {
  const n = Math.max(1, Math.min(MAX_ENSEMBLE_RUNS, Math.floor(runCount)));
  const runs: TrajectoryPoint[][] = [];
  for (let i = 0; i < n; i++) runs.push(simFn(`${seed}:${i}`));
  return runs;
}

/** Slope jitter (±, per round) applied to each ensemble run's trend. */
const SLOPE_JITTER = 0.06;

/**
 * Seeded ensemble around the least-squares projection of an observed curve
 * (same fit as analytics.projectCurve): observed rounds are carried into
 * every run unchanged (recording facts carries no uncertainty), while each
 * run jitters the fitted slope by U(−0.06, +0.06) for the `ahead` projected
 * rounds. Returns per-run trajectories ready for ensembleIntervals().
 */
export function projectionEnsemble(seed: string, runCount: number, curve: TrajectoryPoint[], projection: Projection, ahead = 2): TrajectoryPoint[][] {
  const n = Math.max(1, Math.min(MAX_ENSEMBLE_RUNS, Math.floor(runCount)));
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
  void projection; // fitted slope re-derived here so per-run jitter is exact
  return simulateEnsemble(seed, n, (runSeed) => {
    const rng = streamRng(runSeed, "projection");
    const jitteredSlope = slope + (rng.float() * 2 - 1) * SLOPE_JITTER;
    const run: TrajectoryPoint[] = curve.map((p) => ({ round: p.round, value: p.value }));
    for (let i = 1; i <= ahead; i++) {
      const round = lastRound + i;
      run.push({ round, value: round2Safe(clamp(jitteredSlope * (round - xBar) + yBar, -1, 1)) });
    }
    return run;
  });
}
