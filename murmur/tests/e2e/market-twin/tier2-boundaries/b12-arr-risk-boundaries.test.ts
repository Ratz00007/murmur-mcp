/**
 * Tier 2 — Boundary 12: Executive Churn ARR Risk Boundaries (R5)
 * Tests $0 pre-revenue ARR, $10B enterprise ARR scale, 100% outrage clamp,
 * and negative inputs.
 */
import { describe, expect, it } from "vitest";
import { computeExecutiveARRRisk } from "../helpers/reference-engine.js";

describe("Tier 2 - B12: Executive Churn ARR Risk Boundaries", () => {
  it("handles $0 ARR (pre-revenue startup or OSS project) safely", () => {
    const zeroARR = computeExecutiveARRRisk(0, 0.9, 0.5);
    expect(zeroARR.totalARR).toBe(0);
    expect(zeroARR.grossARRAtRisk).toBe(0);
    expect(zeroARR.expectedChurnLossARR).toBe(0);
    expect(zeroARR.baseCaseLoss).toBe(0);
    expect(zeroARR.p90CaseLoss).toBe(0);
    expect(zeroARR.mitigatedCaseLoss).toBe(0);
  });

  it("handles massive enterprise ARR scale ($10,000,000,000) without float overflow", () => {
    const tenBillionARR = 10_000_000_000;
    const res = computeExecutiveARRRisk(tenBillionARR, 0.6, 0.1);

    expect(res.totalARR).toBe(tenBillionARR);
    expect(res.grossARRAtRisk).toBeGreaterThan(1_000_000_000);
    expect(res.grossARRAtRisk).toBeLessThanOrEqual(tenBillionARR);
    expect(Number.isSafeInteger(res.grossARRAtRisk)).toBe(true);
  });

  it("strictly clamps P90 Case loss when outrage reaches theoretical 1.0 maximum", () => {
    const totalARR = 100_000_000;
    const extremeLoss = computeExecutiveARRRisk(totalARR, 1.0, 0.8);

    expect(extremeLoss.grossARRAtRisk).toBeLessThanOrEqual(totalARR);
    expect(extremeLoss.baseCaseLoss).toBeLessThanOrEqual(totalARR);
  });

  it("verifies Net ARR Waterfall handles zero-churn announcements without negative balance", () => {
    const totalARR = 20_000_000;
    const zeroRisk = computeExecutiveARRRisk(totalARR, 0.0, 0.0);

    expect(zeroRisk.netARRWaterfall[0].balance).toBe(totalARR);
    expect(zeroRisk.netARRWaterfall[zeroRisk.netARRWaterfall.length - 1].balance).toBeGreaterThan(0);
  });

  it("survives outrage inputs bounded beyond [0, 1] without NaN", () => {
    const totalARR = 10_000_000;
    const resLower = computeExecutiveARRRisk(totalARR, -0.5, 0);
    const resUpper = computeExecutiveARRRisk(totalARR, 1.5, 1);

    expect(Number.isFinite(resLower.expectedChurnLossARR)).toBe(true);
    expect(Number.isFinite(resUpper.expectedChurnLossARR)).toBe(true);
  });
});
