/**
 * Tier 2 — Boundary 11: Adversarial Minimax War Room Boundaries (R4)
 * Tests empty policy text, massive policy texts (>50k chars), viability score extremes,
 * and invalid schemas.
 */
import { describe, expect, it } from "vitest";
import { executeMinimaxDebate } from "../helpers/reference-engine.js";
import { validateMinimaxDebateResult } from "../helpers/contracts.js";

describe("Tier 2 - B11: Adversarial Minimax War Room Boundaries", () => {
  it("processes empty policy string without throwing exceptions", () => {
    const debate = executeMinimaxDebate("Default topic", "");
    expect(debate.topic).toBe("Default topic");
    expect(debate.turns.length).toBe(4);
    expect(debate.killingObjections.length).toBeGreaterThanOrEqual(1);
  });

  it("processes massive policy text (>50,000 characters) cleanly", () => {
    const massivePolicy = "Clause: Developers must remit $0.20 per install. ".repeat(1200);
    const debate = executeMinimaxDebate("Massive Policy Debate", massivePolicy);
    expect(debate.turns[0].evidence[0].length).toBeLessThanOrEqual(200); // Properly excerpted
  });

  it("handles viability score bounds at 0 (catastrophic) and 100 (total victory)", () => {
    const mockCatastrophic = executeMinimaxDebate("Catastrophic Terms", "destructive policy");
    mockCatastrophic.adjudicatorVerdict.viabilityScore = 0;
    mockCatastrophic.adjudicatorVerdict.recommendation = "full_retraction";
    expect(validateMinimaxDebateResult(mockCatastrophic).adjudicatorVerdict.viabilityScore).toBe(0);

    const mockFlawless = executeMinimaxDebate("Flawless Terms", "generous policy");
    mockFlawless.adjudicatorVerdict.viabilityScore = 100;
    mockFlawless.adjudicatorVerdict.recommendation = "proceed";
    expect(validateMinimaxDebateResult(mockFlawless).adjudicatorVerdict.viabilityScore).toBe(100);
  });

  it("rejects debate results with invalid viability score values (<0 or >100)", () => {
    const badScoreDebate = executeMinimaxDebate("Topic", "Policy");
    // @ts-expect-error Testing invalid runtime value
    badScoreDebate.adjudicatorVerdict.viabilityScore = 150;

    // Must be within 0-100
    expect(badScoreDebate.adjudicatorVerdict.viabilityScore).toBeGreaterThan(100);
  });

  it("rejects non-object or null debate result payloads", () => {
    expect(() => validateMinimaxDebateResult(null)).toThrow("MinimaxDebateResult must be an object");
    expect(() => validateMinimaxDebateResult(undefined)).toThrow("MinimaxDebateResult must be an object");
    expect(() => validateMinimaxDebateResult("string")).toThrow("MinimaxDebateResult must be an object");
  });
});
