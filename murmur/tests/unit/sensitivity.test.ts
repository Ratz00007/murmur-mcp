/**
 * Slope-jitter sensitivity: what the band is, and what it is not.
 *
 * The module was renamed from "ensemble" because the name promised a robustness
 * that was never computed. Nothing re-simulates — the observed curve is
 * carried into every refit unchanged and only the fitted slope is perturbed. Two
 * consequences are asserted here so the semantics cannot quietly drift back:
 *
 *   1. The band is IDENTICALLY ZERO on recorded rounds, by construction.
 *   2. It is a perturbation of one least-squares fit, not a confidence interval
 *      over anything in the world.
 *
 * The strongest available evidence that no re-simulation occurs: refits with
 * different seeds must agree EXACTLY on every recorded round. If the mechanism
 * were being resampled, they would disagree there.
 */
import { describe, expect, it } from "vitest";
import {
  projectionRefits,
  sensitivityIntervals,
  SLOPE_JITTER,
  MAX_SENSITIVITY_REFITS,
  type TrajectoryPoint,
} from "../../packages/engine/src/dynamics/sensitivity.js";

const CURVE: TrajectoryPoint[] = [
  { round: 1, value: 0.1 },
  { round: 2, value: 0.25 },
  { round: 3, value: 0.4 },
  { round: 4, value: 0.3 },
];

describe("slope-jitter sensitivity", () => {
  it("agrees exactly on recorded rounds across every refit", () => {
    const refits = projectionRefits("seed-a", 5, CURVE, {
      entity: "x",
      slope: 0,
      direction: "up",
      projected: [],
    } as never);
    expect(refits).toHaveLength(5);
    for (const refit of refits) {
      for (const p of refit.filter((x) => x.round <= 4)) {
        const original = CURVE.find((c) => c.round === p.round)!;
        expect(p.value).toBe(original.value);
      }
    }
  });

  it("produces a zero-width band on recorded rounds and a non-zero one on projected rounds", () => {
    const bands = sensitivityIntervals(
      projectionRefits("seed-b", 5, CURVE, {
        entity: "x",
        slope: 0,
        direction: "up",
        projected: [],
      } as never),
    );
    const recorded = bands.filter((b) => b.round <= 4);
    const projected = bands.filter((b) => b.round > 4);

    expect(recorded.length).toBeGreaterThan(0);
    for (const b of recorded) expect(b.p90 - b.p10).toBe(0);
    expect(projected.length).toBeGreaterThan(0);
    expect(projected.some((b) => b.p90 - b.p10 > 0)).toBe(true);
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const a = projectionRefits("same", 4, CURVE, {
      entity: "x",
      slope: 0,
      direction: "up",
      projected: [],
    } as never);
    const b = projectionRefits("same", 4, CURVE, {
      entity: "x",
      slope: 0,
      direction: "up",
      projected: [],
    } as never);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const c = projectionRefits("different", 4, CURVE, {
      entity: "x",
      slope: 0,
      direction: "up",
      projected: [],
    } as never);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("stays within the documented +/- slope jitter of the true fit", () => {
    // Independent least-squares fit of the same curve, so the bound is checked
    // against arithmetic rather than against the implementation.
    const m = CURVE.length;
    const sx = CURVE.reduce((a, p) => a + p.round, 0);
    const sy = CURVE.reduce((a, p) => a + p.value, 0);
    const sxx = CURVE.reduce((a, p) => a + p.round * p.round, 0);
    const sxy = CURVE.reduce((a, p) => a + p.round * p.value, 0);
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);

    const refits = projectionRefits(
      "bound",
      8,
      CURVE,
      { entity: "x", slope, direction: "up", projected: [] } as never,
      2,
    );
    const last = CURVE[CURVE.length - 1].round;
    const xBar = sx / m;
    const yBar = sy / m;
    for (const refit of refits) {
      for (const p of refit.filter((x) => x.round > last)) {
        const implied = (p.value - yBar) / (p.round - xBar);
        expect(Math.abs(implied - slope)).toBeLessThanOrEqual(
          SLOPE_JITTER + 1e-6,
        );
      }
    }
  });

  it("clamps the refit count and returns nothing for a degenerate curve", () => {
    const many = projectionRefits("c", 99, CURVE, {
      entity: "x",
      slope: 0,
      direction: "up",
      projected: [],
    } as never);
    expect(many.length).toBe(MAX_SENSITIVITY_REFITS);
    const tooShort = projectionRefits(
      "c",
      5,
      [{ round: 1, value: 0.1 }],
      {} as never,
    );
    expect(tooShort).toEqual([]);
  });
});
