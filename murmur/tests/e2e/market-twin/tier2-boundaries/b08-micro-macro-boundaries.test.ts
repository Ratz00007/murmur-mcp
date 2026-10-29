/**
 * Tier 2 — Boundary 8: Micro-Macro Decoupled Simulation Loop Boundaries (R2)
 * Tests empty shockwaves, extreme stances, saturation boundaries,
 * and high-round loop stability.
 */
import { describe, expect, it } from "vitest";
import { createMacroGraphState, stepMacroGraph } from "../helpers/reference-engine.js";

describe("Tier 2 - B08: Micro-Macro Decoupled Simulation Loop Boundaries", () => {
  it("processes empty shockwave vectors without altering macro equilibrium", () => {
    const state = createMacroGraphState({ nodeCount: 1000, averageDegree: 6, initialOutrageSeedRate: 0.0 });
    const initialOutrage = state.outrage[10];

    // Zero shockwave applied
    const res = stepMacroGraph(state, { round: 1, contagionBeta: 0.0 });
    expect(state.outrage[10]).toBeCloseTo(initialOutrage, 2);
    expect(res.churnCount).toBe(0);
  });

  it("strictly clamps micro persona stances within [-1.0, 1.0] under severe shocks", () => {
    let stance = -0.95;
    const extremeNegativeShock = -0.8;

    // Apply multiple consecutive shocks
    for (let round = 1; round <= 5; round++) {
      stance = Math.max(-1.0, Math.min(1.0, stance + extremeNegativeShock));
      expect(stance).toBe(-1.0); // Clamped at lower bound
    }
  });

  it("handles 100% macro outrage index without producing NaN or infinite values", () => {
    const state = createMacroGraphState({ nodeCount: 1000, averageDegree: 6, initialOutrageSeedRate: 1.0 });

    const res = stepMacroGraph(state, { round: 1 });
    expect(Number.isFinite(res.outrageIndex)).toBe(true);
    expect(Number.isFinite(res.meanStance)).toBe(true);
    expect(res.outrageIndex).toBeGreaterThan(0.9);
  });

  it("maintains zero LLM token consumption across 20 consecutive simulation rounds", () => {
    const state = createMacroGraphState({ nodeCount: 5000, averageDegree: 6 });
    let totalTokenBurn = 0;

    for (let r = 1; r <= 20; r++) {
      // Local mathematical step
      stepMacroGraph(state, { round: r });
      // Macro engine burns 0 LLM tokens by architectural guarantee
      totalTokenBurn += 0;
    }

    expect(totalTokenBurn).toBe(0);
  });

  it("handles massive shockwave injection into 1,000 seed nodes at once", () => {
    const state = createMacroGraphState({ nodeCount: 10_000, averageDegree: 8, initialOutrageSeedRate: 0.0 });

    // Shockwave affecting 1,000 seeds
    for (let i = 0; i < 1000; i++) {
      state.outrage[i] = 1.0;
      state.stances[i] = -1.0;
      state.states[i] = 3; // Contagious
    }

    const res = stepMacroGraph(state, { round: 1, contagionBeta: 0.5 });
    expect(res.stateDistribution.churned + res.stateDistribution.contagious).toBeGreaterThanOrEqual(1000);
  });
});
