/**
 * Tier 4 — Scenario 2: Docker Hub 2023 Free Team Deprecation
 * Features: F4, F5, F9, F11, F12, F13, F15
 * Replays Docker Hub Free Team deletion notice backlash:
 * - Detects OSS maintainer outrage on GitHub Issues & Reddit
 * - Identifies namespace squatting & supply chain malware killing objections
 * - Models migration inflow to GitHub Packages (ghcr.io > 50%)
 * - Evaluates Grandfathering & Safe Harbor Vaccine copy rewrites
 */
import { describe, expect, it } from "vitest";
import {
  computeCompetitorMigration,
  computeExecutiveARRRisk,
  executeMinimaxDebate,
  generateVaccineRewrites,
} from "../helpers/reference-engine.js";
import {
  validateDiscourseThread,
  validateHistoricalBacklashCase,
  validateMinimaxDebateResult,
} from "../helpers/contracts.js";
import { DOCKER_HUB_2023_CASE, GITHUB_ISSUES_THREAD } from "../helpers/fixtures.js";

describe("Tier 4 - Scenario 2: Docker Hub 2023 Free Team Deprecation", () => {
  const totalARR = 75_000_000; // $75M Docker ARR

  it("simulates open-source maintainer outrage and container registry defection", () => {
    // 1. Ingestion of GitHub Issues Thread & Historical Case
    const discourse = validateDiscourseThread(GITHUB_ISSUES_THREAD);
    const corpusCase = validateHistoricalBacklashCase(DOCKER_HUB_2023_CASE);

    expect(discourse.posts[0].text).toContain("trojaned images");
    expect(corpusCase.objections.some((o) => o.category === "security_namespace_squatting")).toBe(true);

    // 2. Minimax Adversarial Debate
    const debate = executeMinimaxDebate(corpusCase.title, corpusCase.policySummary);
    const validatedDebate = validateMinimaxDebateResult(debate);

    expect(validatedDebate.killingObjections.some((o) => o.severityScore >= 9.0)).toBe(true);
    expect(validatedDebate.adjudicatorVerdict.recommendation).toBe("revise_terms");

    // 3. Churn ARR Risk Calculation
    const outrageLevel = 0.92;
    const churnFraction = 0.12; // 12% projected churn
    const arrRisk = computeExecutiveARRRisk(totalARR, outrageLevel, churnFraction);

    expect(arrRisk.expectedChurnLossARR).toBeGreaterThanOrEqual(9_000_000); // ~$9M churn loss
    expect(arrRisk.grossARRAtRisk).toBeGreaterThan(15_000_000);

    // 4. Competitor Migration Inflows (GitHub Packages ghcr.io > 50% inflow)
    const competitors = [
      { name: "GitHub Packages (ghcr.io)", isOSS: true, featureParity: 0.9, switchingFriction: 0.2 },
      { name: "Quay.io", isOSS: true, featureParity: 0.8, switchingFriction: 0.5 },
      { name: "AWS ECR Public", isOSS: false, featureParity: 0.85, switchingFriction: 0.6 },
    ];
    const migration = computeCompetitorMigration(
      arrRisk.expectedChurnLossARR,
      3500, // 3500 affected organizations
      competitors,
    );

    const ghcr = migration.find((m) => m.competitor.includes("GitHub Packages"))!;
    expect(ghcr.inflowSharePercent).toBeGreaterThanOrEqual(50.0);
    expect(ghcr.migratedAccounts).toBeGreaterThan(1700);

    // 5. Strategic Vaccine Copy Generation (Grandfathering Shield)
    const rewrites = generateVaccineRewrites("Docker", totalARR);
    const grandfathering = rewrites.find((r) => r.strategy === "grandfathering_shield")!;

    expect(grandfathering.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
    expect(grandfathering.revisedCopy).toMatch(/permanently grandfathered|legacy terms/i);
    expect(grandfathering.projectedSentimentRecovery).toBeGreaterThan(0.6);
  });
});
