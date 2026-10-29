/**
 * Tier 1 — Feature 12: Executive Churn ARR Risk Projections & Waterfall (R5)
 * Validates logistic hazard churn modeling, gross ARR at risk,
 * Base / P90 / Mitigated loss scenarios, and Net ARR Waterfall accounting.
 */
import { describe, expect, it } from "vitest";
import { computeExecutiveARRRisk } from "../helpers/reference-engine.js";

describe("Tier 1 - F12: Executive Churn ARR Risk Projections", () => {
  const totalARR = 50_000_000; // $50M ARR Enterprise SaaS

  it("computes logistic hazard churn loss scaling with macro outrage", () => {
    const lowRisk = computeExecutiveARRRisk(totalARR, 0.1, 0.02);
    const highRisk = computeExecutiveARRRisk(totalARR, 0.9, 0.25);

    expect(highRisk.expectedChurnLossARR).toBeGreaterThan(lowRisk.expectedChurnLossARR * 3);
    expect(highRisk.grossARRAtRisk).toBeLessThanOrEqual(totalARR);
    expect(lowRisk.grossARRAtRisk).toBeLessThan(highRisk.grossARRAtRisk);
  });

  it("generates Base, P90, and Mitigated case scenarios with logical bounds", () => {
    const risk = computeExecutiveARRRisk(totalARR, 0.75, 0.15);

    expect(risk.p90CaseLoss).toBeGreaterThan(risk.baseCaseLoss);
    expect(risk.mitigatedCaseLoss).toBeLessThan(risk.baseCaseLoss);
    expect(risk.mitigatedCaseLoss).toBeGreaterThan(0);
  });

  it("verifies Net ARR Waterfall arithmetic balance consistency across stages", () => {
    const risk = computeExecutiveARRRisk(totalARR, 0.8, 0.2);
    const waterfall = risk.netARRWaterfall;

    expect(waterfall.length).toBeGreaterThanOrEqual(4);
    expect(waterfall[0].stage).toBe("Starting ARR");
    expect(waterfall[0].balance).toBe(totalARR);

    let runningBalance = waterfall[0].balance;
    for (let i = 1; i < waterfall.length; i++) {
      runningBalance += waterfall[i].deltaARR;
      expect(waterfall[i].balance).toBe(runningBalance);
    }

    // Ending balance must remain positive for a viable going concern
    expect(waterfall[waterfall.length - 1].balance).toBeGreaterThan(0);
  });

  it("ensures gross ARR at risk never exceeds total enterprise contract ARR", () => {
    // Extreme outrage (1.0) and high churn
    const extremeRisk = computeExecutiveARRRisk(totalARR, 1.0, 0.9);
    expect(extremeRisk.grossARRAtRisk).toBeLessThanOrEqual(totalARR);
    expect(extremeRisk.expectedChurnLossARR).toBeLessThanOrEqual(totalARR);
  });

  it("evaluates near-zero churn impact in tranquil, low-outrage scenarios", () => {
    const tranquilRisk = computeExecutiveARRRisk(totalARR, 0.05, 0.01);
    expect(tranquilRisk.expectedChurnLossARR).toBeLessThan(totalARR * 0.05);
    expect(tranquilRisk.grossARRAtRisk).toBeLessThan(totalARR * 0.1);
  });
});
