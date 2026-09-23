/** Unit tests for the coordinate-descent calibration scaffold. */
import { describe, expect, it } from "vitest";
import { ENGAGEMENT_BOUNDS, calibrate } from "./calibrate.js";

describe("calibrate (coordinate descent)", () => {
  it("converges near the optimum of a synthetic quadratic fitness", () => {
    const target = { x: 3, y: -7 };
    const fitness = (p: { x: number; y: number }): number => 100 - (p.x - target.x) ** 2 - (p.y - target.y) ** 2;
    const start = { x: 0, y: 0 };
    const bounds = { x: { min: -10, max: 10 }, y: { min: -10, max: 10 } };
    const res = calibrate(start, fitness, bounds, 60);
    expect(res.params.x).toBeCloseTo(target.x, 1);
    expect(res.params.y).toBeCloseTo(target.y, 1);
    expect(res.fitness).toBeGreaterThan(99);
    expect(res.fitness).toBeGreaterThanOrEqual(fitness(start));
    expect(res.evaluations).toBeGreaterThan(1);
  });

  it("never leaves the parameter bounds", () => {
    // fitness climbs toward +∞ beyond max — must stop exactly at the bound
    const res = calibrate({ a: 0.5 }, (p: { a: number }) => p.a, { a: { min: 0, max: 1 } }, 20);
    expect(res.params.a).toBe(1);
    expect(res.params.a).toBeGreaterThanOrEqual(0);
    // and clamp a start that is out of range before probing
    const clamped = calibrate({ a: 99 }, (p: { a: number }) => -Math.abs(p.a - 0.25), { a: { min: 0, max: 1 } }, 40);
    expect(clamped.params.a).toBeCloseTo(0.25, 2);
  });

  it("sweeps the engagement bounds (organicLikeBase, cascade prob, viralityThreshold)", () => {
    const target = { organicLikeBase: 0.12, cascadeProbability: 0.4, viralityThreshold: 16 };
    const fitness = (p: typeof target): number =>
      -((p.organicLikeBase - target.organicLikeBase) ** 2) -
      ((p.cascadeProbability - target.cascadeProbability) ** 2) -
      ((p.viralityThreshold - target.viralityThreshold) ** 2) * 0.001;
    const start = { organicLikeBase: 0.01, cascadeProbability: 0, viralityThreshold: 4 };
    const res = calibrate(start, fitness, ENGAGEMENT_BOUNDS, 60);
    expect(res.params.organicLikeBase).toBeCloseTo(target.organicLikeBase, 3);
    expect(res.params.cascadeProbability).toBeCloseTo(target.cascadeProbability, 3);
    expect(res.params.viralityThreshold).toBeCloseTo(target.viralityThreshold, 1);
    // bound sanity: each engagement knob stays a plausible value
    expect(ENGAGEMENT_BOUNDS.organicLikeBase.min).toBeGreaterThan(0);
    expect(ENGAGEMENT_BOUNDS.cascadeProbability.max).toBeLessThanOrEqual(1);
    expect(ENGAGEMENT_BOUNDS.viralityThreshold.max).toBeGreaterThan(ENGAGEMENT_BOUNDS.viralityThreshold.min);
  });

  it("is deterministic — identical inputs return identical results", () => {
    const fitness = (p: { a: number; b: number }): number => -((p.a - 0.5) ** 2) - ((p.b + 2) ** 2);
    const bounds = { a: { min: 0, max: 1 }, b: { min: -5, max: 5 } };
    const r1 = calibrate({ a: 0.1, b: 0 }, fitness, bounds, 30);
    const r2 = calibrate({ a: 0.1, b: 0 }, fitness, bounds, 30);
    expect(r1).toEqual(r2);
  });
});
