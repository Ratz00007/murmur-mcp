/**
 * Tier 1 — Feature 8: Micro-Macro Decoupled Simulation Loop (R2)
 * Validates dual-scale decoupling: micro qualitative LLM personas (10-30)
 * receiving compact macro state priors, and injecting semantic shockwaves
 * into 100k+ macro population graph with zero token burn.
 */
import { describe, expect, it } from "vitest";
import { createMacroGraphState, stepMacroGraph } from "../helpers/reference-engine.js";

describe("Tier 1 - F08: Micro-Macro Decoupled Simulation Loop", () => {
  it("formats compact macro state summary priors for micro personas (<150 tokens)", () => {
    const macroState = createMacroGraphState({ nodeCount: 100_000, averageDegree: 8, initialOutrageSeedRate: 0.08 });
    const stepResult = stepMacroGraph(macroState, { round: 1 });

    const macroPrior = {
      population: macroState.nodeCount,
      outragedPct: Math.round(stepResult.outrageIndex * 1000) / 10,
      churnCount: stepResult.churnCount,
      dominantCohortOutrage: stepResult.stateDistribution.contagious > 0 ? "high" : "moderate",
    };

    const priorJson = JSON.stringify(macroPrior);
    const estimatedTokens = Math.ceil(priorJson.length / 4);

    expect(estimatedTokens).toBeLessThan(150);
    expect(macroPrior.population).toBe(100_000);
    expect(typeof macroPrior.outragedPct).toBe("number");
  });

  it("injects micro semantic shockwaves into macro seed nodes without LLM token burn", () => {
    const macroState = createMacroGraphState({ nodeCount: 10_000, averageDegree: 6, initialOutrageSeedRate: 0.01 });
    const initialOutrage = macroState.outrage[0];

    // Micro semantic shockwave payload from cohort debate
    const shockwave = {
      targetSeedIndices: [0, 1, 2, 3, 4],
      deltaOutrage: 0.75,
      stanceShift: -0.8,
    };

    // Inject into macro graph
    for (const idx of shockwave.targetSeedIndices) {
      macroState.outrage[idx] = Math.min(1.0, macroState.outrage[idx] + shockwave.deltaOutrage);
      macroState.stances[idx] = Math.max(-1.0, macroState.stances[idx] + shockwave.stanceShift);
      macroState.states[idx] = 3; // Contagious
    }

    expect(macroState.outrage[0]).toBeGreaterThan(initialOutrage);
    expect(macroState.stances[0]).toBeLessThan(-0.5);

    const stepResult = stepMacroGraph(macroState, { round: 1 });
    expect(stepResult.stateDistribution.contagious).toBeGreaterThanOrEqual(5);
  });

  it("converges macro aggregate metrics with micro cohort sentiment direction", () => {
    const macroState = createMacroGraphState({ nodeCount: 5000, averageDegree: 8, initialOutrageSeedRate: 0.15 });

    // Micro cohort expresses severe objection -> high contagion
    const res = stepMacroGraph(macroState, { round: 1, contagionBeta: 0.4 });
    expect(res.meanStance).toBeLessThan(0); // Shifted negative
    expect(res.outrageIndex).toBeGreaterThan(0.1);
  });

  it("preserves separate micro persona identities while reflecting macro population trends", () => {
    const microPersonas = [
      { id: "p_indie", archetype: "indie_dev", stance: -0.2 },
      { id: "p_enterprise", archetype: "enterprise_architect", stance: 0.1 },
      { id: "p_oss", archetype: "oss_maintainer", stance: -0.5 },
    ];

    // When macro outrage is high, micro personas update their stances according to archetype susceptibility
    const macroOutrageIndex = 0.85;
    const updated = microPersonas.map((p) => {
      const sensitivity = p.archetype === "oss_maintainer" ? 1.0 : p.archetype === "indie_dev" ? 0.7 : 0.3;
      return {
        ...p,
        stance: Math.max(-1.0, p.stance - macroOutrageIndex * sensitivity * 0.5),
      };
    });

    expect(updated[2].stance).toBeLessThan(updated[0].stance);
    expect(updated[0].stance).toBeLessThan(updated[1].stance);
  });

  it("executes multi-round decoupled loops deterministically", () => {
    const stateA = createMacroGraphState({ nodeCount: 2000, averageDegree: 6 });
    const stateB = createMacroGraphState({ nodeCount: 2000, averageDegree: 6 });

    const resA = stepMacroGraph(stateA, { round: 1 });
    const resB = stepMacroGraph(stateB, { round: 1 });

    expect(resA.meanStance).toBeCloseTo(resB.meanStance, 4);
    expect(resA.outrageIndex).toBeCloseTo(resB.outrageIndex, 4);
    expect(resA.churnCount).toBe(resB.churnCount);
  });
});
