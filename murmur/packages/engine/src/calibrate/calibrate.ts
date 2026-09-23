/**
 * Coordinate-descent calibration scaffold for engine engagement parameters.
 *
 * DATA POLICY (mandatory): the fitness function's input data MUST come from
 * real observed events — production telemetry, recorded human behavior, or
 * other externally measured outcomes. Never feed this function data the engine
 * itself generated: calibrating simulation output against simulation output is
 * CIRCULAR VALIDATION. It will happily "converge" while confirming whatever
 * assumptions the simulation was built on, and it proves nothing about the
 * real world the model claims to represent.
 *
 * Method: cyclic coordinate descent. Each iteration sweeps every parameter and
 * probes ±step along that axis (step = span / 2^(iteration+1), clamped to the
 * parameter's bounds), keeping any move that improves fitness (higher is
 * better). Deterministic — no randomness — so identical inputs always return
 * identical results.
 */

export interface ParamBound {
  min: number;
  max: number;
}

export interface CalibrateResult<P extends Record<string, number>> {
  params: P;
  fitness: number;
  evaluations: number;
}

/**
 * Default search box over the engagement knobs this scaffold is meant to
 * tune: organicLikeBase, the cascade propagation probability and
 * viralityThreshold (see config.engagement / config.cascade in types.ts).
 */
export const ENGAGEMENT_BOUNDS: Record<"organicLikeBase" | "cascadeProbability" | "viralityThreshold", ParamBound> = {
  organicLikeBase: { min: 0.01, max: 0.35 },
  cascadeProbability: { min: 0, max: 1 },
  viralityThreshold: { min: 4, max: 40 },
};

/**
 * Maximize fitnessFn over the bounded parameter box via coordinate descent.
 *
 * @param params    starting point (clamped into bounds before the first probe)
 * @param fitnessFn higher is better; must be a pure function of the params and
 *                  of REAL OBSERVED data (see data policy above)
 * @param bounds    per-parameter [min, max] search box; key order defines the
 *                  deterministic sweep order
 * @param iters     sweep iterations; each halves every parameter's step
 */
export function calibrate<P extends Record<string, number>>(
  params: P,
  fitnessFn: (p: P) => number,
  bounds: { [K in keyof P]: ParamBound },
  iters: number
): CalibrateResult<P> {
  const clampTo = (k: keyof P, v: number): P[keyof P] =>
    Math.min(bounds[k].max, Math.max(bounds[k].min, v)) as P[keyof P];
  const current = { ...params };
  for (const k of Object.keys(bounds) as (keyof P)[]) current[k] = clampTo(k, current[k]) as P[keyof P];
  let best = fitnessFn(current);
  let evaluations = 1;

  const keys = Object.keys(bounds) as (keyof P)[];
  for (let iter = 0; iter < Math.max(0, Math.floor(iters)); iter++) {
    for (const key of keys) {
      const { min, max } = bounds[key];
      const step = (max - min) / Math.pow(2, iter + 1);
      for (const dir of [1, -1]) {
        const candidate = { ...current };
        candidate[key] = clampTo(key, (current[key] as number) + dir * step) as P[keyof P];
        if (candidate[key] === current[key]) continue; // clamped back to where we are
        const f = fitnessFn(candidate);
        evaluations++;
        if (f > best) {
          best = f;
          Object.assign(current, candidate);
        }
      }
    }
  }
  return { params: { ...current }, fitness: best, evaluations };
}
