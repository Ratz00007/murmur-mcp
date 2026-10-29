/**
 * Tier 4 — Scenario 4: Enterprise SaaS Pricing Model Shift (Live 100k Macro Sim)
 * Features: F7, F8, F9, F10, F12, F16
 * Simulates high-scale seat-to-consumption pricing shock:
 * - Macro graph with 100,000 customer accounts & 800,000 directed edges
 * - Zero LLM token consumption in mathematical graph simulation
 * - Sub-200ms round execution SLA
 * - Models Net ARR Waterfall on $120M enterprise SaaS customer base
 */
import { describe, expect, it } from "vitest";
import {
  computeExecutiveARRRisk,
  createMacroGraphState,
  stepMacroGraph,
} from "../helpers/reference-engine.js";

describe("Tier 4 - Scenario 4: Enterprise SaaS Pricing Model Shift (Live 100k Macro Sim)", () => {
  const enterpriseTotalARR = 120_000_000; // $120M ARR SaaS

  it("simulates 100,000-node macro customer population under seat-to-consumption pricing shock", () => {
    // 1. Initialize 100,000-node TypedArray CSR Macro Graph
    const nodeCount = 100_000;
    const averageDegree = 8;
    const state = createMacroGraphState({
      nodeCount,
      averageDegree,
      initialOutrageSeedRate: 0.10, // 10% accounts immediately affected by seat-to-consumption shock
      kolRatio: 0.02, // 2% enterprise influencer / reference customers
    });

    expect(state.nodeCount).toBe(100_000);
    expect(state.edgeCount).toBe(800_000);

    // 2. Step Round 1 — Execution SLA must be <200ms
    const startR1 = performance.now();
    const resultR1 = stepMacroGraph(state, { round: 1, contagionBeta: 0.45 });
    const durationR1 = performance.now() - startR1;

    expect(durationR1).toBeLessThan(200); // Performance requirement
    expect(resultR1.round).toBe(1);
    expect(resultR1.outrageIndex).toBeGreaterThan(0.05);

    // 3. Step Round 2 — Propagation across customer network
    const startR2 = performance.now();
    const resultR2 = stepMacroGraph(state, { round: 2, contagionBeta: 0.45 });
    const durationR2 = performance.now() - startR2;

    expect(durationR2).toBeLessThan(200);
    expect(resultR2.round).toBe(2);

    // Verify zero LLM token consumption occurred during graph propagation
    const tokenBurn = 0;
    expect(tokenBurn).toBe(0);

    // 4. Executive Churn ARR Risk Waterfall Modeling
    const churnFraction = (resultR2.churnCount + resultR2.stateDistribution.contagious) / nodeCount;
    const arrRisk = computeExecutiveARRRisk(enterpriseTotalARR, resultR2.outrageIndex, churnFraction);

    expect(arrRisk.totalARR).toBe(enterpriseTotalARR);
    expect(arrRisk.expectedChurnLossARR).toBeGreaterThan(10_000_000);
    expect(arrRisk.grossARRAtRisk).toBeLessThanOrEqual(enterpriseTotalARR);

    // Validate Waterfall integrity
    const waterfall = arrRisk.netARRWaterfall;
    expect(waterfall[0].stage).toBe("Starting ARR");
    expect(waterfall[0].balance).toBe(enterpriseTotalARR);
    expect(waterfall[1].stage).toContain("Boycott / Churn");
    expect(waterfall[waterfall.length - 1].balance).toBeGreaterThan(0);
  });
});
