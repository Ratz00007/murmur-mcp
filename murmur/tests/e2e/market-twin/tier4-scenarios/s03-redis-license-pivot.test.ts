/**
 * Tier 4 — Scenario 3: Redis 2024 RSALv2 / SSPL License Pivot
 * Features: F4, F5, F8, F9, F10, F11, F13, F14
 * Replays Redis licensing pivot away from BSD-3:
 * - Ingests Hacker News Algolia discourse & historical corpus
 * - Simulates fork momentum (Valkey) under neutral Linux Foundation governance
 * - Models cloud vendor sponsorship (AWS, Google, Microsoft)
 * - Evaluates Minimax debate adjudicator recommendation
 * - Projects tech press headlines & PR sentiment erosion
 */
import { describe, expect, it } from "vitest";
import {
  computeCompetitorMigration,
  executeMinimaxDebate,
  generateMediaHeadlines,
} from "../helpers/reference-engine.js";
import {
  validateDiscourseThread,
  validateHistoricalBacklashCase,
  validateMinimaxDebateResult,
} from "../helpers/contracts.js";
import { HACKERNEWS_ALGOLIA_THREAD, REDIS_2024_CASE } from "../helpers/fixtures.js";

describe("Tier 4 - Scenario 3: Redis 2024 RSALv2 / SSPL License Pivot", () => {
  const totalRedisARR = 110_000_000; // $110M Redis Enterprise ARR

  it("simulates ecosystem fork momentum and commercial defection to Valkey", () => {
    // 1. Discourse & Historical Grounding
    const hnThread = validateDiscourseThread(HACKERNEWS_ALGOLIA_THREAD);
    const corpusCase = validateHistoricalBacklashCase(REDIS_2024_CASE);

    expect(hnThread.metrics.upvotes).toBeGreaterThan(2000);
    expect(corpusCase.policySummary).toContain("RSALv2");

    // 2. Minimax Adversarial War Room
    const debate = executeMinimaxDebate(corpusCase.title, corpusCase.policySummary);
    const validatedDebate = validateMinimaxDebateResult(debate);

    const forkObjection = validatedDebate.killingObjections.find((o) =>
      o.title.toLowerCase().includes("fork"),
    );
    expect(forkObjection).toBeDefined();
    expect(forkObjection!.severityScore).toBeGreaterThanOrEqual(9.0);

    // 3. Competitor Migration Choice (Valkey dominance > 70% share)
    const competitors = [
      { name: "Valkey (Linux Foundation fork)", isOSS: true, featureParity: 0.99, switchingFriction: 0.1 },
      { name: "KeyDB", isOSS: true, featureParity: 0.85, switchingFriction: 0.4 },
      { name: "Dragonfly", isOSS: false, featureParity: 0.8, switchingFriction: 0.6 },
    ];

    const churnVolumeARR = totalRedisARR * 0.22; // 22% expected ARR churn
    const migration = computeCompetitorMigration(churnVolumeARR, 2400, competitors);

    const valkey = migration.find((m) => m.competitor.includes("Valkey"))!;
    expect(valkey.inflowSharePercent).toBeGreaterThanOrEqual(60.0);
    expect(valkey.migratedARR).toBeGreaterThan(15_000_000);

    // 4. Press Headline Prediction across Tiers
    const headlines = generateMediaHeadlines("Redis", "dual RSALv2/SSPL licensing", 0.85);
    const devPress = headlines.find((h) => h.tier === "dev_press")!;
    const finPress = headlines.find((h) => h.tier === "financial_press")!;

    expect(devPress.predictedHeadline).toMatch(/abandoning|rebellion|engineers/i);
    expect(devPress.sentimentScore).toBeLessThan(-0.6);
    expect(finPress.sensationalismScore).toBeGreaterThan(7.0);
  });
});
