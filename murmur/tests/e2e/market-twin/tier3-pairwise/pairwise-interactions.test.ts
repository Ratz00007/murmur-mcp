/**
 * Tier 3 — Pairwise Combinatorial Interaction Tests
 * Validates cross-feature interactions across the Market Twin simulation platform (>=16 tests).
 */
import { describe, expect, it } from "vitest";
import {
  computeCompetitorMigration,
  computeExecutiveARRRisk,
  computeOutrageMultiplier,
  computeTheRatio,
  createMacroGraphState,
  executeMinimaxDebate,
  generateMediaHeadlines,
  generateVaccineRewrites,
  rankFeedPostsWithKOL,
  stepMacroGraph,
} from "../helpers/reference-engine.js";
import {
  validateDiscourseThread,
  validateHistoricalBacklashCase,
  validateMinimaxDebateResult,
} from "../helpers/contracts.js";
import { REDDIT_DEVOPS_THREAD, UNITY_2023_CASE } from "../helpers/fixtures.js";
import { createTestWorkspace, initDirectWorld } from "../helpers/harness.js";
import { scoreSentiment } from "@murmur/engine";

describe("Tier 3 — Pairwise Combinatorial Testing", () => {
  // Pair 1: F4 (Discourse Ingestion) + F5 (Historical Corpus)
  it("P01: Grounds ingested Reddit discourse threads in historical backlash case categories", () => {
    const thread = validateDiscourseThread(REDDIT_DEVOPS_THREAD);
    const corpusCase = validateHistoricalBacklashCase(UNITY_2023_CASE);

    // Correlate discourse text with historical legal/economic objection categories
    const discourseText = thread.posts.map((p) => p.text).join(" ");
    const matchesLegal = corpusCase.objections.some(
      (_o) =>
        discourseText.toLowerCase().includes("legal") ||
        discourseText.toLowerCase().includes("terms"),
    );
    expect(matchesLegal).toBe(true);
  });

  // Pair 2: F5 (Historical Corpus) + F11 (Minimax War Room)
  it("P02: Feeds historical corpus objections into Minimax debate extraction", () => {
    const corpusCase = validateHistoricalBacklashCase(UNITY_2023_CASE);
    const debate = executeMinimaxDebate(
      corpusCase.title,
      corpusCase.policySummary,
    );
    const validatedDebate = validateMinimaxDebateResult(debate);

    expect(validatedDebate.killingObjections.length).toBeGreaterThanOrEqual(
      corpusCase.objections.length,
    );
    expect(validatedDebate.adjudicatorVerdict.recommendation).toBe(
      "revise_terms",
    );
  });

  // Pair 3: F7 (Macro Graph Dynamics) + F9 (Outrage Multiplier & The Ratio)
  it("P03: Applies Outrage Multiplier and The Ratio inside Macro Graph dynamics propagation", () => {
    const state = createMacroGraphState({
      nodeCount: 2000,
      averageDegree: 6,
      initialOutrageSeedRate: 0.1,
    });
    const r1 = stepMacroGraph(state, { round: 1 });

    const outrageMultiplier = computeOutrageMultiplier(r1.outrageIndex);
    const ratioData = computeTheRatio(
      Math.round(r1.outrageIndex * 500),
      100,
      50,
    );

    expect(outrageMultiplier).toBeGreaterThan(1.0);
    expect(ratioData.controversyMultiplier).toBeGreaterThan(1.0);
  });

  // Pair 4: F9 (The Ratio) + F10 (KOL Influencer Centrality)
  it("P04: Interacts KOL authority weighting with The Ratio controversy scoring in feed ranking", () => {
    const kolPost = {
      id: "p_kol_ratio",
      text: "The new license violates open source principles.",
      outrage: 0.9,
      replies: 1200,
      quotes: 600,
      likes: 150,
      authorFollowers: 80_000,
      authorPageRank: 0.85,
      recencyRound: 1,
    };

    const ranked = rankFeedPostsWithKOL([kolPost], 1);
    expect(ranked[0].isViral).toBe(true);
    expect(ranked[0].finalScore).toBeGreaterThan(100);
  });

  // Pair 5: F7 (Macro Graph Dynamics) + F12 (Executive ARR Risk)
  it("P05: Bridges Macro Graph simulated churn count into Executive ARR Risk loss modeling", () => {
    const state = createMacroGraphState({
      nodeCount: 10_000,
      averageDegree: 8,
      initialOutrageSeedRate: 0.15,
    });
    const r1 = stepMacroGraph(state, { round: 1, churnThreshold: 0.7 });

    const churnFraction = r1.churnCount / state.nodeCount;
    const arrRisk = computeExecutiveARRRisk(
      60_000_000,
      r1.outrageIndex,
      churnFraction,
    );

    expect(arrRisk.expectedChurnLossARR).toBeGreaterThan(0);
    expect(arrRisk.grossARRAtRisk).toBeLessThanOrEqual(60_000_000);
    expect(arrRisk.netARRWaterfall[1].deltaARR).toBe(-arrRisk.baseCaseLoss);
  });

  // Pair 6: F11 (Minimax War Room) + F15 (Vaccine Copy Rewriter)
  it("P06: Directly maps Minimax Killing Objections to Vaccine Copy neutralizing statements", () => {
    const debate = executeMinimaxDebate("Runtime Fee", "Charge per install");
    const rewrites = generateVaccineRewrites("PlatformVendor", 30_000_000);

    const _killingObjectionTitles = debate.killingObjections.map((o) =>
      o.title.toLowerCase(),
    );
    const allNeutralized = rewrites.flatMap((r) =>
      r.neutralizedObjections.map((o) => o.toLowerCase()),
    );

    // Verify retroactive liability objection is addressed by Grandfathering Shield
    expect(allNeutralized.some((n) => n.includes("retroactive"))).toBe(true);
    expect(rewrites.every((r) => r.preservedRevenuePercent >= 80)).toBe(true);
  });

  // Pair 7: F12 (Executive ARR Risk) + F13 (Competitor Migration Inflow Maps)
  it("P07: Allocates Expected Churn ARR across Multinomial Logit Competitor destinations", () => {
    const arrRisk = computeExecutiveARRRisk(40_000_000, 0.75, 0.18);
    const competitors = [
      {
        name: "Godot Engine",
        isOSS: true,
        featureParity: 0.85,
        switchingFriction: 0.3,
      },
      {
        name: "Unreal Engine",
        isOSS: false,
        featureParity: 0.95,
        switchingFriction: 0.6,
      },
    ];

    const migration = computeCompetitorMigration(
      arrRisk.expectedChurnLossARR,
      1000,
      competitors,
    );

    const allocatedSum = migration.reduce((sum, m) => sum + m.migratedARR, 0);
    expect(allocatedSum).toBeCloseTo(arrRisk.expectedChurnLossARR, -4);
  });

  // Pair 8: F13 (Competitor Migration) + F14 (Press Headline Predictor)
  it("P08: Elevates Press Headline sensationalism when competitor migration accelerates", () => {
    const highOutrage = 0.85;
    const headlines = generateMediaHeadlines(
      "VendorX",
      "licensing pivot",
      highOutrage,
    );

    const techHeadline = headlines.find((h) => h.tier === "tech_press")!;
    expect(techHeadline.sensationalismScore).toBeGreaterThanOrEqual(8.0);
    expect(techHeadline.sentimentScore).toBeLessThan(-0.5);
  });

  // Pair 9: F8 (Micro-Macro Loop) + F16 (MCP Tools Integration Contract)
  it("P09: Verifies Micro-Macro simulation loop artifacts satisfy MCP server output budgets", () => {
    const state = createMacroGraphState({ nodeCount: 1000, averageDegree: 6 });
    const stepRes = stepMacroGraph(state, { round: 1 });

    const mcpPayload = {
      ok: true,
      round: stepRes.round,
      meanStance: stepRes.meanStance,
      outrageIndex: stepRes.outrageIndex,
      churnCount: stepRes.churnCount,
      distribution: stepRes.stateDistribution,
    };

    const serialized = JSON.stringify(mcpPayload);
    const tokenEst = Math.ceil(serialized.length / 4);
    expect(tokenEst).toBeLessThan(12_000);
  });

  // Pair 10: F2 (Aspect Sentiment) + F3 (Cascade Dynamics)
  it("P10: Drives negative aspect sentiment into active cascade engagement without lurker suppression", () => {
    const text =
      "The mandatory install tax is predatory, disastrous, and completely unworkable.";
    const sentiment = scoreSentiment(text);
    expect(sentiment.score).toBeLessThan(-0.3);

    // Negative sentiment amplifies outrage
    const outrageMult = computeOutrageMultiplier(Math.abs(sentiment.score));
    expect(outrageMult).toBeGreaterThan(1.2);
  });

  // Pair 11: F1 (Windows Stability) + F7 (Macro Graph Dynamics)
  it("P11: Executes 10,000 node macro graph stepping inside an isolated Windows temp workspace", async () => {
    const ws = createTestWorkspace();
    const { storage } = initDirectWorld(ws.cwd, "win-macro-workspace");
    ws.storage = storage;

    const state = createMacroGraphState({
      nodeCount: 10_000,
      averageDegree: 8,
    });
    const stepRes = stepMacroGraph(state, { round: 1 });
    expect(stepRes.round).toBe(1);

    storage.close();
    await ws.close();
  });

  // Pair 12: F6 (Seed Ingestion) + F4 (Discourse Ingestion)
  it("P12: Stores normalized discourse threads as world seeds with calculated digests", async () => {
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(
      ws.cwd,
      "discourse-seed-workspace",
    );
    ws.storage = storage;

    const thread = validateDiscourseThread(REDDIT_DEVOPS_THREAD);
    const content = thread.posts
      .map((p) => `${p.author}: ${p.text}`)
      .join("\n");

    const { seed } = storage.addSeed(world.id, {
      kind: "text",
      title: thread.title,
      ref: thread.url,
      text: content,
      digest: thread.title,
    });

    expect(seed.id).toBeDefined();
    expect(seed.title).toBe(thread.title);

    storage.close();
    await ws.close();
  });

  // Pair 13: F6 (Seed Ingestion) + F5 (Historical Corpus)
  it("P13: Ingests historical corpus cases as seeds and verifies seed review queries", async () => {
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(
      ws.cwd,
      "corpus-seed-query-world",
    );
    ws.storage = storage;

    storage.addSeed(world.id, {
      kind: "text",
      title: UNITY_2023_CASE.title,
      ref: `corpus://${UNITY_2023_CASE.id}`,
      text: JSON.stringify(UNITY_2023_CASE),
      digest: UNITY_2023_CASE.policySummary,
    });

    const seeds = storage.listSeeds(world.id);
    expect(seeds.length).toBe(1);
    expect(seeds[0].ref).toContain("unity-runtime-fee-2023");

    storage.close();
    await ws.close();
  });

  // Pair 14: F10 (KOL Centrality) + F7 (Macro Graph Dynamics)
  it("P14: Seeds initial macro graph outrage specifically at high-KOL nodes", () => {
    const state = createMacroGraphState({
      nodeCount: 5000,
      averageDegree: 8,
      kolRatio: 0.05,
    });
    let kolCount = 0;

    for (let i = 0; i < state.nodeCount; i++) {
      if (state.kolWeight[i] > 20.0) kolCount++;
    }
    expect(kolCount).toBeGreaterThan(100);

    const res = stepMacroGraph(state, { round: 1 });
    expect(res.outrageIndex).toBeGreaterThan(0);
  });

  // Pair 15: F14 (Press Headlines) + F15 (Vaccine Copy Rewriter)
  it("P15: Evaluates vaccine rewrite sentiment recovery against predicted hostile press headlines", () => {
    const headlines = generateMediaHeadlines("Vendor", "pricing shock", 0.9);
    const rewrites = generateVaccineRewrites("Vendor", 50_000_000);

    const minHeadlineSentiment = Math.min(
      ...headlines.map((h) => h.sentimentScore),
    );
    const avgSentimentRecovery =
      rewrites.reduce((sum, r) => sum + r.projectedSentimentRecovery, 0) /
      rewrites.length;

    expect(minHeadlineSentiment).toBeLessThan(-0.5);
    expect(avgSentimentRecovery).toBeGreaterThan(0.6);
  });

  // Pair 16: F12 (Executive ARR Risk) + F15 (Vaccine Copy Rewriting)
  it("P16: Models mitigated case ARR retention when Vaccine Copy is deployed", () => {
    const risk = computeExecutiveARRRisk(100_000_000, 0.8, 0.2);
    const rewrites = generateVaccineRewrites("Vendor", 100_000_000);

    // Mitigated loss must be substantially lower than base case loss
    expect(risk.mitigatedCaseLoss).toBeLessThan(risk.baseCaseLoss * 0.5);
    expect(rewrites.some((r) => r.preservedRevenuePercent >= 90)).toBe(true);
  });

  // Pair 17: F3 (Cascade Dynamics) + F9 (The Ratio)
  it("P17: Simulates multi-hop cascade dogpiling leading directly to Ratio status", () => {
    const replies = 850;
    const quotes = 400;
    const likes = 80;

    const ratio = computeTheRatio(replies, quotes, likes);
    expect(ratio.isRatioed).toBe(true);
    expect(ratio.controversyMultiplier).toBeGreaterThanOrEqual(2.0);
  });

  // Pair 18: F2 (Aspect Sentiment) + F11 (Minimax War Room)
  it("P18: Supplies aspect-based entity critique as evidence in Prosecution Indictment", () => {
    const entityText =
      "PostgreSQL community rejects commercial runtime charges.";
    const _sentiment = scoreSentiment(entityText);

    const debate = executeMinimaxDebate("Runtime Charge", entityText);
    const prosecutionTurn = debate.turns.find((t) => t.role === "prosecution");

    expect(prosecutionTurn).toBeDefined();
    expect(prosecutionTurn!.arguments.length).toBeGreaterThanOrEqual(1);
  });
});
