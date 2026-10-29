/**
 * Tier 2 — Boundary 9: Outrage Amplification & The Ratio Boundaries (R3)
 * Tests 0 engagement, 100k replies/quotes, exact 2.0 Ratio threshold boundary,
 * and negative input clamping.
 */
import { describe, expect, it } from "vitest";
import { computeOutrageMultiplier, computeTheRatio } from "../helpers/reference-engine.js";

describe("Tier 2 - B09: Outrage Amplification & The Ratio Boundaries", () => {
  it("handles exactly 0 replies, 0 quotes, and 0 likes safely", () => {
    const zeroMetrics = computeTheRatio(0, 0, 0);
    expect(zeroMetrics.ratioScore).toBe(0);
    expect(zeroMetrics.isRatioed).toBe(false);
    expect(zeroMetrics.controversyMultiplier).toBe(1.0);
  });

  it("toggles isRatioed accurately at the exact 2.0 boundary", () => {
    // 200 replies vs 100 likes => ratio exactly 2.0
    const exactBoundary = computeTheRatio(200, 0, 100);
    expect(exactBoundary.ratioScore).toBe(2.0);
    expect(exactBoundary.isRatioed).toBe(true);

    // 199 replies vs 100 likes => ratio 1.99
    const subBoundary = computeTheRatio(199, 0, 100);
    expect(subBoundary.ratioScore).toBe(1.99);
    expect(subBoundary.isRatioed).toBe(false);
  });

  it("caps controversy multiplier at 5.0 even under astronomical ratio values", () => {
    // 10,000,000 replies vs 1 like
    const superRatio = computeTheRatio(10_000_000, 5_000_000, 1);
    expect(superRatio.controversyMultiplier).toBe(5.0);
  });

  it("evaluates outrage multiplier at exact boundaries 0.0, 0.5, and 1.0", () => {
    expect(computeOutrageMultiplier(0.0)).toBe(1.0);
    expect(computeOutrageMultiplier(0.5)).toBeCloseTo(1.75, 2);
    expect(computeOutrageMultiplier(1.0)).toBe(4.0);
  });

  it("clamps negative engagement inputs to 0 without math exceptions", () => {
    // Negative likes or replies due to data corruption
    const sanitized = computeTheRatio(Math.max(0, -10), Math.max(0, -5), Math.max(0, -20));
    expect(sanitized.ratioScore).toBe(0);
    expect(sanitized.isRatioed).toBe(false);
  });
});
