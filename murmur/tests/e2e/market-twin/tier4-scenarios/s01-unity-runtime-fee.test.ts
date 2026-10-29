/**
 * Tier 4 — Scenario 1: Unity 2023 Runtime Fee Backlash Replay
 * Features: F4, F5, F7, F9, F10, F11, F12, F13, F14, F15
 * Replays 20c install fee backlash:
 * - Ingests historical corpus grounding & Twitter/Reddit discourse
 * - Runs macro SEICR graph simulation over 10,000 developer nodes
 * - Executes Minimax debate extracting retroactive install-fraud killing objections
 * - Predicts >15% ARR churn risk ($45M on $250M ARR)
 * - Simulates competitor migration inflow (>60% Godot share)
 * - Predicts viral press headlines across aggregators, dev press, tech press, financial press
 * - Generates and evaluates Safe Harbor / Grandfathering Vaccine copy rewrites
 */
import { describe, expect, it } from "vitest";
import {
  computeCompetitorMigration,
  computeExecutiveARRRisk,
  createMacroGraphState,
  executeMinimaxDebate,
  generateMediaHeadlines,
  generateVaccineRewrites,
  stepMacroGraph,
} from "../helpers/reference-engine.js";
import {
  validateDiscourseThread,
  validateExecutiveDecisionReport,
  validateHistoricalBacklashCase,
  validateMinimaxDebateResult,
} from "../helpers/contracts.js";
import { TWITTER_BACKLASH_THREAD, UNITY_2023_CASE } from "../helpers/fixtures.js";

describe("Tier 4 - Scenario 1: Unity 2023 Runtime Fee Backlash Replay", () => {
  const totalARR = 250_000_000; // $250M Unity Engine ARR

  it("executes end-to-end replay of Unity 2023 Runtime Fee policy backlash", () => {
    // 1. Corpus & Discourse Grounding
    const historicalCase = validateHistoricalBacklashCase(UNITY_2023_CASE);
    const discourse = validateDiscourseThread(TWITTER_BACKLASH_THREAD);
    expect(historicalCase.vendor).toBe("Unity Technologies");
    expect(discourse.metrics.comments).toBeGreaterThan(discourse.metrics.upvotes); // Ratio'd

    // 2. Macro Graph Propagation (10,000 game dev studios)
    const macroState = createMacroGraphState({
      nodeCount: 10_000,
      averageDegree: 10,
      initialOutrageSeedRate: 0.18,
      kolRatio: 0.05,
    });
    const round1 = stepMacroGraph(macroState, { round: 1, contagionBeta: 0.6, churnThreshold: 0.75 });
    const round2 = stepMacroGraph(macroState, { round: 2, contagionBeta: 0.6, churnThreshold: 0.75 });

    expect(round2.outrageIndex).toBeGreaterThan(0.25);
    const churnFraction = (round2.churnCount + round2.stateDistribution.contagious) / macroState.nodeCount;
    expect(churnFraction).toBeGreaterThan(0.1);

    // 3. Minimax Dialectic War Room
    const debate = executeMinimaxDebate(
      "Unity 20c Runtime Fee",
      historicalCase.policySummary,
    );
    const validatedDebate = validateMinimaxDebateResult(debate);
    expect(validatedDebate.killingObjections[0].title).toContain("Attribution");
    expect(validatedDebate.adjudicatorVerdict.recommendation).toBe("revise_terms");

    // 4. Executive ARR Risk Projections (>15% ARR churn expected)
    const arrRisk = computeExecutiveARRRisk(totalARR, round2.outrageIndex, churnFraction);
    expect(arrRisk.expectedChurnLossARR).toBeGreaterThan(totalARR * 0.15); // >$37.5M loss
    expect(arrRisk.p90CaseLoss).toBeGreaterThan(arrRisk.baseCaseLoss);
    expect(arrRisk.netARRWaterfall[0].balance).toBe(totalARR);

    // 5. Competitor Migration Inflows (>60% Godot share)
    const competitors = [
      { name: "Godot Engine", isOSS: true, featureParity: 0.85, switchingFriction: 0.3 },
      { name: "Unreal Engine", isOSS: false, featureParity: 0.98, switchingFriction: 0.7 },
      { name: "In-House C++ Engine", isOSS: true, featureParity: 0.6, switchingFriction: 0.9 },
    ];
    const migration = computeCompetitorMigration(
      arrRisk.expectedChurnLossARR,
      Math.round(macroState.nodeCount * churnFraction),
      competitors,
    );
    const godot = migration.find((m) => m.competitor === "Godot Engine")!;
    expect(godot.inflowSharePercent).toBeGreaterThanOrEqual(60.0);
    expect(godot.migratedARR).toBeGreaterThan(arrRisk.expectedChurnLossARR * 0.5);

    // 6. Press Headline Predictor
    const headlines = generateMediaHeadlines("Unity", "runtime fee", 0.85);
    expect(headlines.length).toBe(4);
    const techPress = headlines.find((h) => h.tier === "tech_press")!;
    expect(techPress.sensationalismScore).toBeGreaterThanOrEqual(8.0);
    expect(techPress.predictedHeadline).toMatch(/revolt|boycott|threaten/i);

    // 7. Vaccine Copy Rewrites (Guarantees >=80% revenue preserved)
    const rewrites = generateVaccineRewrites("Unity", totalARR);
    expect(rewrites.length).toBe(3);
    const safeHarbor = rewrites.find((r) => r.strategy === "safe_harbor_free_tier")!;
    expect(safeHarbor.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
    expect(safeHarbor.revisedCopy).toMatch(/hobbyists|safe harbor|zero/i);
    expect(safeHarbor.projectedSentimentRecovery).toBeGreaterThan(0.7);

    // 8. Overall Report Integrity Check
    const fullReport = {
      arrRisk,
      competitorMigration: migration,
      mediaHeadlines: headlines,
      vaccineRewrites: rewrites,
      renderedHtmlDashboard: `<html><body><h1>Unity Backlash Replay</h1></body></html>`,
    };
    expect(validateExecutiveDecisionReport(fullReport).arrRisk.totalARR).toBe(totalARR);
  });
});
