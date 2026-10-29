/**
 * Tier 2 — Boundary 7: Vectorized Macro Graph Dynamics Boundaries (R2)
 * Tests single-node graph, fully churned state, extreme susceptibility,
 * and TypedArray validation failures.
 */
import { describe, expect, it } from "vitest";
import { validateMacroGraphState } from "../helpers/contracts.js";
import { createMacroGraphState, stepMacroGraph } from "../helpers/reference-engine.js";

describe("Tier 2 - B07: Vectorized Macro Graph Dynamics Boundaries", () => {
  it("handles minimal graph with 1 single node and 0 edges safely", () => {
    const singleNodeState = {
      nodeCount: 1,
      edgeCount: 0,
      stances: new Float32Array([0.0]),
      outrage: new Float32Array([0.1]),
      susceptibility: new Float32Array([0.5]),
      kolWeight: new Float32Array([1.0]),
      states: new Uint8Array([0]),
      rowPointers: new Int32Array([0, 0]),
      columnIndices: new Int32Array(0),
      edgeWeights: new Float32Array(0),
    };

    const validated = validateMacroGraphState(singleNodeState);
    expect(validated.nodeCount).toBe(1);

    const stepRes = stepMacroGraph(singleNodeState, { round: 1 });
    expect(stepRes.round).toBe(1);
    expect(stepRes.stateDistribution.susceptible).toBe(1);
    expect(stepRes.churnCount).toBe(0);
  });

  it("maintains steady equilibrium when 100% of nodes are already churned", () => {
    const nodeCount = 500;
    const allChurned = createMacroGraphState({ nodeCount, averageDegree: 4 });
    for (let i = 0; i < nodeCount; i++) {
      allChurned.states[i] = 4; // Churned
      allChurned.outrage[i] = 1.0;
      allChurned.stances[i] = -1.0;
    }

    const stepRes = stepMacroGraph(allChurned, { round: 1 });
    expect(stepRes.churnCount).toBe(nodeCount);
    expect(stepRes.stateDistribution.churned).toBe(nodeCount);
    expect(stepRes.meanStance).toBe(-1.0);
    expect(stepRes.outrageIndex).toBe(1.0);
  });

  it("handles disconnected graph with multiple independent component islands", () => {
    // 200 nodes divided into 2 completely isolated islands
    const nodeCount = 200;
    const state = createMacroGraphState({ nodeCount, averageDegree: 2, initialOutrageSeedRate: 0.0 });

    // Seed island A only (nodes 0-99)
    for (let i = 0; i < 50; i++) {
      state.outrage[i] = 0.9;
      state.states[i] = 2; // Infected
    }

    const res = stepMacroGraph(state, { round: 1 });
    expect(res.outrageIndex).toBeGreaterThan(0);
    expect(res.stateDistribution.infected + res.stateDistribution.contagious).toBeGreaterThanOrEqual(50);
  });

  it("rejects invalid MacroGraphState with mismatched TypedArray buffer dimensions", () => {
    expect(() =>
      validateMacroGraphState({
        nodeCount: 100,
        edgeCount: 200,
        stances: new Float32Array(50), // Mismatched length (50 vs 100)
        outrage: new Float32Array(100),
        susceptibility: new Float32Array(100),
        kolWeight: new Float32Array(100),
        states: new Uint8Array(100),
        rowPointers: new Int32Array(101),
        columnIndices: new Int32Array(200),
        edgeWeights: new Float32Array(200),
      }),
    ).toThrow("stances must be Float32Array of length nodeCount");
  });

  it("rejects non-positive nodeCount values", () => {
    expect(() =>
      validateMacroGraphState({
        nodeCount: 0,
        edgeCount: 0,
        stances: new Float32Array(0),
        outrage: new Float32Array(0),
        susceptibility: new Float32Array(0),
        kolWeight: new Float32Array(0),
        states: new Uint8Array(0),
        rowPointers: new Int32Array(1),
        columnIndices: new Int32Array(0),
        edgeWeights: new Float32Array(0),
      }),
    ).toThrow("Invalid nodeCount");
  });
});
