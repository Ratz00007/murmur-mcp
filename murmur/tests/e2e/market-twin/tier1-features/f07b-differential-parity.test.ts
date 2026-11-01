/**
 * Tier 1 — Feature 7b: Differential Parity — Production ≡ Reference Engine.
 *
 * The reference engine (helpers/reference-engine.ts) is the hand-written mirror
 * the e2e suite was built against. This file asserts the PRODUCTION modules
 * (packages/engine/src/dynamics/macro-graph.js, packages/engine/src/report-executive.js)
 * match that mirror exactly. ANY mismatch here is a real defect: the suite's
 * oracle and the shipped artifact disagree.
 *
 * Note: executeMinimaxDebate is intentionally NOT asserted here — production
 * branches its turn text on policy lexicon while the reference returns a fixed
 * script, so they are not equal by construction (and it is not in the parity
 * scope). It is covered separately by war-room unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  createMacroGraphState as prodCreate,
  stepMacroGraph as prodStep,
} from "../../../../packages/engine/src/dynamics/macro-graph.js";
import {
  computeExecutiveARRRisk as prodARRRisk,
  generateVaccineRewrites as prodVaccine,
} from "../../../../packages/engine/src/report-executive.js";
import {
  createMacroGraphState as refCreate,
  stepMacroGraph as refStep,
  computeExecutiveARRRisk as refARRRisk,
  generateVaccineRewrites as refVaccine,
} from "../helpers/reference-engine.js";

const NODE_COUNT = 1000;
const AVERAGE_DEGREE = 8;
const ROUNDS = 3;

function arraysEqual(
  a: Float32Array | Uint8Array,
  b: Float32Array | Uint8Array,
  label: string,
) {
  expect(a.length, `${label} length`).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i], `${label}[${i}]`).toBe(b[i]);
  }
}

describe("Tier 1 - F07b: Production ≡ Reference Engine Differential Parity", () => {
  it("createMacroGraphState + stepMacroGraph produce identical states and step results", () => {
    // Initialization is index-deterministic (the `seed` option is reserved),
    // so a few distinct configurations cover the state space.
    for (const cfg of [
      { nodeCount: NODE_COUNT, averageDegree: AVERAGE_DEGREE },
      { nodeCount: NODE_COUNT, averageDegree: AVERAGE_DEGREE, initialOutrageSeedRate: 0.2 },
      { nodeCount: 2000, averageDegree: 6, initialOutrageSeedRate: 0.05, kolRatio: 0.05 },
    ]) {
      const prodState = prodCreate(cfg);
      const refState = refCreate(cfg);

      // Initial state must be deep-equal across every buffer.
      arraysEqual(prodState.stances, refState.stances, "init stances");
      arraysEqual(prodState.outrage, refState.outrage, "init outrage");
      arraysEqual(prodState.susceptibility, refState.susceptibility, "init susceptibility");
      arraysEqual(prodState.kolWeight, refState.kolWeight, "init kolWeight");
      arraysEqual(prodState.states, refState.states, "init states");
      expect(prodState.rowPointers).toEqual(refState.rowPointers);
      expect(prodState.columnIndices).toEqual(refState.columnIndices);
      expect(prodState.edgeWeights).toEqual(refState.edgeWeights);

      for (let round = 1; round <= ROUNDS; round++) {
        const prodResult = prodStep(prodState, {
          round,
          contagionBeta: 0.4,
          decayFactor: 0.95,
          churnThreshold: 0.85,
        });
        const refResult = refStep(refState, {
          round,
          contagionBeta: 0.4,
          decayFactor: 0.95,
          churnThreshold: 0.85,
        });

        // Step result key fields.
        expect(prodResult.meanStance).toBe(refResult.meanStance);
        expect(prodResult.outrageIndex).toBe(refResult.outrageIndex);
        expect(prodResult.churnCount).toBe(refResult.churnCount);
        expect(prodResult.stateDistribution).toEqual(refResult.stateDistribution);

        // Post-step state arrays must remain identical.
        arraysEqual(prodState.stances, refState.stances, `r${round} stances`);
        arraysEqual(prodState.outrage, refState.outrage, `r${round} outrage`);
        arraysEqual(prodState.states, refState.states, `r${round} states`);
      }
    }
  });

  it("computeExecutiveARRRisk produces identical numbers over fixed inputs", () => {
    const cases: Array<[number, number, number]> = [
      [50_000_000, 0.75, 0.18],
      [250_000_000, 0.62, 0.11],
      [120_000_000, 0.4, 0.05],
      [10_000_000_000, 0.9, 0.3],
    ];
    for (const [arr, outrage, churn] of cases) {
      const prod = prodARRRisk(arr, outrage, churn);
      const ref = refARRRisk(arr, outrage, churn);
      expect(prod.totalARR).toBe(ref.totalARR);
      expect(prod.grossARRAtRisk).toBe(ref.grossARRAtRisk);
      expect(prod.expectedChurnLossARR).toBe(ref.expectedChurnLossARR);
      expect(prod.baseCaseLoss).toBe(ref.baseCaseLoss);
      expect(prod.p90CaseLoss).toBe(ref.p90CaseLoss);
      expect(prod.mitigatedCaseLoss).toBe(ref.mitigatedCaseLoss);
      expect(prod.netARRWaterfall).toEqual(ref.netARRWaterfall);
      // Production adds calibrationStatus provenance metadata (additive, not a divergence).
      expect(typeof prod.calibrationStatus).toBe("string");
    }
  });

  it("generateVaccineRewrites produces deep-equal items (including copy text)", () => {
    const cases: Array<[string, number]> = [
      ["DataEngine Corp", 25_000_000],
      ["Acme & Co.", 0],
      ["X", 1_000_000],
      ["Hyperscale Inc", 100_000_000],
    ];
    for (const [vendor, arr] of cases) {
      const prod = prodVaccine(vendor, arr);
      const ref = refVaccine(vendor, arr);
      expect(prod).toEqual(ref);
    }
  });
});
