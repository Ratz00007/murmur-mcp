/**
 * Tier 1 — Feature 11: Adversarial Minimax War Room (4 Turns) (R4)
 * Validates 4-turn dialectic debate structure, Killing Objections extraction,
 * Fragile Assumptions identification, and Adjudicator Verdict recommendations.
 */
import { describe, expect, it } from "vitest";
import { validateMinimaxDebateResult } from "../helpers/contracts.js";
import { executeMinimaxDebate } from "../helpers/reference-engine.js";

describe("Tier 1 - F11: Adversarial Minimax War Room", () => {
  const topic = "20c per-install runtime fee on shipped games";
  const policyText = "Beginning Jan 1, games passing $200k in revenue and 200k lifetime installs will pay $0.20 per install.";

  it("executes full 4-turn dialectic debate (Prosecution -> Defense -> Cross-Exam -> Adjudication)", () => {
    const debate = executeMinimaxDebate(topic, policyText);
    const validated = validateMinimaxDebateResult(debate);

    expect(validated.turns.length).toBe(4);
    expect(validated.turns[0].role).toBe("prosecution");
    expect(validated.turns[1].role).toBe("defense");
    expect(validated.turns[2].role).toBe("prosecution");
    expect(validated.turns[3].role).toBe("adjudicator");
  });

  it("extracts ranked Killing Objections with severe economic and legal mechanisms", () => {
    const debate = executeMinimaxDebate(topic, policyText);
    expect(debate.killingObjections.length).toBeGreaterThanOrEqual(3);

    const topObjection = debate.killingObjections[0];
    expect(topObjection.rank).toBe(1);
    expect(topObjection.severityScore).toBeGreaterThanOrEqual(9.0);
    expect(topObjection.economicOrLegalMechanism).toBeDefined();
    expect(topObjection.unrebuttableFact).toBeDefined();
  });

  it("surfaces Fragile Assumptions with explicit failure probabilities", () => {
    const debate = executeMinimaxDebate(topic, policyText);
    expect(debate.fragileAssumptions.length).toBeGreaterThanOrEqual(2);

    for (const assumption of debate.fragileAssumptions) {
      expect(assumption.assumption.length).toBeGreaterThan(10);
      expect(assumption.failureCondition.length).toBeGreaterThan(10);
      expect(assumption.probabilityOfFailure).toBeGreaterThan(0.5);
    }
  });

  it("adjudicator verdict delivers viability score (0-100) and actionable policy recommendation", () => {
    const debate = executeMinimaxDebate(topic, policyText);
    const verdict = debate.adjudicatorVerdict;

    expect(verdict.viabilityScore).toBeGreaterThanOrEqual(0);
    expect(verdict.viabilityScore).toBeLessThanOrEqual(100);
    expect(["proceed", "revise_terms", "full_retraction"]).toContain(verdict.recommendation);
    expect(verdict.summary.length).toBeGreaterThan(20);
  });

  it("rejects malformed debate results missing mandatory roles or killing objections", () => {
    expect(() =>
      validateMinimaxDebateResult({
        topic: "Incomplete debate",
        turns: [
          { role: "prosecution", turnIndex: 1, claim: "C", arguments: [], evidence: [] },
          { role: "defense", turnIndex: 2, claim: "C", arguments: [], evidence: [] },
          // Missing cross-exam and adjudicator
        ],
        killingObjections: [],
        fragileAssumptions: [],
        adjudicatorVerdict: { summary: "S", viabilityScore: 50, recommendation: "proceed" },
      }),
    ).toThrow();
  });
});
