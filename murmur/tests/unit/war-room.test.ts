/**
 * Unit Tests for Adversarial Minimax War Room (Milestone M5, Feature 11).
 *
 * Verifies:
 * - 4-turn dialectic debate structure (Prosecution -> Defense -> Cross-Exam -> Adjudication)
 * - Ranked Killing Objections with economic and legal mechanisms
 * - Fragile Assumptions surfacing with probability of failure
 * - Adjudicator viability scoring and recommendations (proceed, revise_terms, full_retraction)
 * - Boundary conditions (empty strings, massive texts >50k chars, viability bounds)
 */

import { describe, expect, it } from "vitest";
import {
  executeMinimaxDebate,
  type MinimaxDebateResult,
  type MinimaxDebateTurn,
  type KillingObjection,
  type FragileAssumption,
  type MinimaxDebateVerdict,
} from "@murmur/engine";

describe("Unit: Minimax War Room (Feature 11)", () => {
  const sampleTopic = "Runtime fee on distributed client engines";
  const samplePolicy =
    "Starting next quarter, all shipped titles exceeding $200k in lifetime revenue and 200k installations will remit $0.20 per install.";

  it("produces exactly 4 structured dialectic turns with required roles", () => {
    const debate: MinimaxDebateResult = executeMinimaxDebate(sampleTopic, samplePolicy);

    expect(debate.topic).toBe(sampleTopic);
    expect(debate.turns).toHaveLength(4);

    const [turn1, turn2, turn3, turn4]: MinimaxDebateTurn[] = debate.turns;

    expect(turn1.role).toBe("prosecution");
    expect(turn1.turnIndex).toBe(1);
    expect(turn1.claim.length).toBeGreaterThan(15);
    expect(turn1.arguments.length).toBeGreaterThanOrEqual(2);
    expect(turn1.evidence.length).toBeGreaterThanOrEqual(1);

    expect(turn2.role).toBe("defense");
    expect(turn2.turnIndex).toBe(2);
    expect(turn2.claim.length).toBeGreaterThan(15);
    expect(turn2.arguments.length).toBeGreaterThanOrEqual(2);

    expect(turn3.role).toBe("prosecution");
    expect(turn3.turnIndex).toBe(3);
    expect(turn3.claim.length).toBeGreaterThan(15);

    expect(turn4.role).toBe("adjudicator");
    expect(turn4.turnIndex).toBe(4);
    expect(turn4.claim.length).toBeGreaterThan(15);
  });

  it("extracts ranked Killing Objections with high-severity economic and legal mechanisms", () => {
    const debate: MinimaxDebateResult = executeMinimaxDebate(sampleTopic, samplePolicy);

    expect(debate.killingObjections.length).toBeGreaterThanOrEqual(3);

    // Verify ordering by rank
    for (let i = 0; i < debate.killingObjections.length; i++) {
      expect(debate.killingObjections[i].rank).toBe(i + 1);
    }

    const topObjection: KillingObjection = debate.killingObjections[0];
    expect(topObjection.severityScore).toBeGreaterThanOrEqual(9.0);
    expect(topObjection.severityScore).toBeLessThanOrEqual(10.0);
    expect(topObjection.title.length).toBeGreaterThan(5);
    expect(topObjection.economicOrLegalMechanism.length).toBeGreaterThan(15);
    expect(topObjection.unrebuttableFact.length).toBeGreaterThan(15);
  });

  it("surfaces Fragile Assumptions with failure conditions and high failure probabilities", () => {
    const debate: MinimaxDebateResult = executeMinimaxDebate(sampleTopic, samplePolicy);

    expect(debate.fragileAssumptions.length).toBeGreaterThanOrEqual(2);

    for (const fa of debate.fragileAssumptions) {
      const assumptionItem: FragileAssumption = fa;
      expect(assumptionItem.assumption.length).toBeGreaterThan(10);
      expect(assumptionItem.failureCondition.length).toBeGreaterThan(10);
      expect(assumptionItem.probabilityOfFailure).toBeGreaterThan(0.5);
      expect(assumptionItem.probabilityOfFailure).toBeLessThanOrEqual(1.0);
    }
  });

  it("adjudicator provides coherent verdict, viability score (0-100), and valid recommendation", () => {
    const debate: MinimaxDebateResult = executeMinimaxDebate(sampleTopic, samplePolicy);
    const verdict: MinimaxDebateVerdict = debate.adjudicatorVerdict;

    expect(verdict.summary.length).toBeGreaterThan(20);
    expect(verdict.viabilityScore).toBeGreaterThanOrEqual(0);
    expect(verdict.viabilityScore).toBeLessThanOrEqual(100);
    expect(["proceed", "revise_terms", "full_retraction"]).toContain(verdict.recommendation);
  });

  describe("Boundary and Edge Cases", () => {
    it("handles empty policy text without throwing exceptions", () => {
      const debate = executeMinimaxDebate("Default Topic", "");
      expect(debate.topic).toBe("Default Topic");
      expect(debate.turns).toHaveLength(4);
      expect(debate.killingObjections.length).toBeGreaterThanOrEqual(3);
      expect(debate.turns[0].evidence[0].length).toBeLessThanOrEqual(200);
    });

    it("handles whitespace-only topic and null-ish policy text safely", () => {
      // @ts-expect-error Testing runtime resilience
      const debate = executeMinimaxDebate("   ", null);
      expect(debate.topic.length).toBeGreaterThan(0);
      expect(debate.turns).toHaveLength(4);
    });

    it("properly excerpts massive policy texts exceeding 50,000 characters", () => {
      const massivePolicy = "Sub-clause: 0.20 per install fee applies to all binaries. ".repeat(1200);
      expect(massivePolicy.length).toBeGreaterThan(50_000);

      const debate = executeMinimaxDebate("Massive Policy Stress Test", massivePolicy);
      expect(debate.turns[0].evidence[0].length).toBeLessThanOrEqual(200);
    });

    it("detects benign/low-risk policy and adjusts viability score accordingly", () => {
      const benignTopic = "Optional voluntary opt-in developer telemetry program";
      const benignPolicy = "Developers may optionally enable anonymous bug report telemetry with zero fees.";
      const debate = executeMinimaxDebate(benignTopic, benignPolicy);

      expect(debate.adjudicatorVerdict.viabilityScore).toBeGreaterThanOrEqual(50);
      expect(debate.adjudicatorVerdict.recommendation).toBe("proceed");
    });
  });
});
