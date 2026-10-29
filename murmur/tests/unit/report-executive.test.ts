/**
 * Unit Tests for Executive Decision Intelligence Engine (Milestone M5, Features 12-15).
 *
 * Verifies:
 * - Feature 12: Executive Churn ARR Risk Projections (Logistic Hazard Model & Net Waterfall)
 * - Feature 13: Competitor Migration Inflow Maps (Multinomial Logit Choice Model)
 * - Feature 14: Media & Press Headline Predictor (4-Tier Press Lifecycle Simulator)
 * - Feature 15: Automated "Vaccine" Copy Rewriter (3 Strategic Counter-Proposals, >=80% revenue preserved)
 * - Complete Executive Decision Report Builder + Cleanroom HTML Dashboard with inline SVG
 */

import { describe, expect, it } from "vitest";
import {
  computeExecutiveARRRisk,
  computeCompetitorMigration,
  generateMediaHeadlines,
  generateVaccineRewrites,
  buildCompleteExecutiveReport,
  type ExecutiveDecisionReport,
  type ExecutiveARRRisk,
  type CompetitorMigrationItem,
  type MediaHeadlineItem,
  type VaccineRewriteItem,
} from "@murmur/engine";

describe("Unit: Executive Decision Intelligence (Features 12-15)", () => {
  // -------------------------------------------------------------------------
  // Feature 12: Executive Churn ARR Risk Projections
  // -------------------------------------------------------------------------
  describe("Feature 12: computeExecutiveARRRisk", () => {
    const totalARR = 50_000_000; // $50M

    it("calculates logistic hazard churn scaling with macro outrage and churn fraction", () => {
      const calm = computeExecutiveARRRisk(totalARR, 0.1, 0.02);
      const crisis = computeExecutiveARRRisk(totalARR, 0.9, 0.25);

      expect(crisis.expectedChurnLossARR).toBeGreaterThan(calm.expectedChurnLossARR * 3);
      expect(crisis.grossARRAtRisk).toBeGreaterThan(calm.grossARRAtRisk);
      expect(crisis.grossARRAtRisk).toBeLessThanOrEqual(totalARR);
      expect(calm.grossARRAtRisk).toBeLessThanOrEqual(totalARR);
    });

    it("generates Base, P90, and Mitigated loss scenarios with proper relations", () => {
      const risk: ExecutiveARRRisk = computeExecutiveARRRisk(totalARR, 0.75, 0.15);

      expect(risk.baseCaseLoss).toBe(risk.expectedChurnLossARR);
      expect(risk.p90CaseLoss).toBeGreaterThan(risk.baseCaseLoss);
      expect(risk.mitigatedCaseLoss).toBeLessThan(risk.baseCaseLoss);
      expect(risk.mitigatedCaseLoss).toBeGreaterThan(0);
    });

    it("verifies Net ARR Waterfall arithmetic balance consistency across all stages", () => {
      const risk = computeExecutiveARRRisk(totalARR, 0.8, 0.2);
      const waterfall = risk.netARRWaterfall;

      expect(waterfall.length).toBeGreaterThanOrEqual(4);
      expect(waterfall[0].stage).toBe("Starting ARR");
      expect(waterfall[0].balance).toBe(totalARR);

      let running = waterfall[0].balance;
      for (let i = 1; i < waterfall.length; i++) {
        running += waterfall[i].deltaARR;
        expect(waterfall[i].balance).toBe(running);
      }

      // Final balance must remain positive for enterprise going concern
      expect(waterfall[waterfall.length - 1].balance).toBeGreaterThan(0);
    });

    it("handles pre-revenue $0 ARR safely with zeroed metrics", () => {
      const zero = computeExecutiveARRRisk(0, 0.9, 0.5);
      expect(zero.totalARR).toBe(0);
      expect(zero.grossARRAtRisk).toBe(0);
      expect(zero.expectedChurnLossARR).toBe(0);
      expect(zero.baseCaseLoss).toBe(0);
      expect(zero.p90CaseLoss).toBe(0);
      expect(zero.mitigatedCaseLoss).toBe(0);
    });

    it("handles massive enterprise ARR ($10 Billion) without float overflow", () => {
      const tenBillion = 10_000_000_000;
      const res = computeExecutiveARRRisk(tenBillion, 0.65, 0.12);

      expect(res.totalARR).toBe(tenBillion);
      expect(Number.isSafeInteger(res.grossARRAtRisk)).toBe(true);
      expect(Number.isSafeInteger(res.expectedChurnLossARR)).toBe(true);
      expect(res.grossARRAtRisk).toBeLessThanOrEqual(tenBillion);
    });

    it("evaluates continuous bounded output for out-of-range outrage inputs (<0 or >1)", () => {
      const lower = computeExecutiveARRRisk(totalARR, -0.5, 0.0);
      const upper = computeExecutiveARRRisk(totalARR, 1.5, 1.0);

      expect(Number.isFinite(lower.expectedChurnLossARR)).toBe(true);
      expect(Number.isFinite(upper.expectedChurnLossARR)).toBe(true);
      expect(lower.expectedChurnLossARR).toBeLessThanOrEqual(totalARR);
      expect(upper.expectedChurnLossARR).toBeLessThanOrEqual(totalARR);
    });
  });

  // -------------------------------------------------------------------------
  // Feature 13: Competitor Migration Inflow Maps
  // -------------------------------------------------------------------------
  describe("Feature 13: computeCompetitorMigration", () => {
    const totalChurnARR = 12_000_000;
    const totalChurnAccounts = 1500;
    const competitors = [
      { name: "Godot Engine", isOSS: true, featureParity: 0.85, switchingFriction: 0.3 },
      { name: "Unreal Engine", isOSS: false, featureParity: 0.95, switchingFriction: 0.6 },
      { name: "Custom In-House", isOSS: true, featureParity: 0.5, switchingFriction: 0.8 },
    ];

    it("distributes inflow shares via multinomial logit summing to ~100%", () => {
      const migration: CompetitorMigrationItem[] = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
      expect(migration).toHaveLength(3);

      const totalShare = migration.reduce((sum, m) => sum + m.inflowSharePercent, 0);
      expect(totalShare).toBeCloseTo(100.0, 0);

      for (const m of migration) {
        expect(m.inflowSharePercent).toBeGreaterThan(0);
        expect(m.migratedARR).toBeGreaterThan(0);
        expect(m.migratedAccounts).toBeGreaterThan(0);
        expect(m.keyDefectionDrivers.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("favors open source alternative with lower switching friction as top inflow destination", () => {
      const migration = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
      const godot = migration.find((m) => m.competitor === "Godot Engine")!;
      const unreal = migration.find((m) => m.competitor === "Unreal Engine")!;

      expect(godot.inflowSharePercent).toBeGreaterThan(unreal.inflowSharePercent);
    });

    it("allocates exactly 100% of churn to a single monopoly alternative", () => {
      const monopoly = [{ name: "Monopoly Alternative", isOSS: true, featureParity: 0.9, switchingFriction: 0.2 }];
      const res = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, monopoly);

      expect(res).toHaveLength(1);
      expect(res[0].inflowSharePercent).toBe(100.0);
      expect(res[0].migratedARR).toBe(totalChurnARR);
      expect(res[0].migratedAccounts).toBe(totalChurnAccounts);
    });

    it("splits shares evenly among identical competitor alternatives", () => {
      const identical = [
        { name: "Mirror A", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
        { name: "Mirror B", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
        { name: "Mirror C", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
        { name: "Mirror D", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
      ];
      const res = computeCompetitorMigration(4_000_000, 400, identical);

      for (const m of res) {
        expect(m.inflowSharePercent).toBe(25.0);
        expect(m.migratedARR).toBe(1_000_000);
        expect(m.migratedAccounts).toBe(100);
      }
    });

    it("handles empty competitors array safely by returning empty list", () => {
      const empty = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, []);
      expect(empty).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Feature 14: Media & Press Headline Predictor
  // -------------------------------------------------------------------------
  describe("Feature 14: generateMediaHeadlines", () => {
    const vendor = "InfraScale";
    const topic = "mandatory minimum compute charges";

    it("generates headlines across all 4 mandatory press tiers", () => {
      const headlines: MediaHeadlineItem[] = generateMediaHeadlines(vendor, topic, 0.7);
      expect(headlines).toHaveLength(4);

      const tiers = headlines.map((h) => h.tier);
      expect(tiers).toEqual(["aggregators", "dev_press", "tech_press", "financial_press"]);
    });

    it("scales sensationalism and sentiment scores according to outrage severity", () => {
      const calm = generateMediaHeadlines(vendor, topic, 0.1);
      const crisis = generateMediaHeadlines(vendor, topic, 0.9);

      for (let i = 0; i < 4; i++) {
        expect(crisis[i].sensationalismScore).toBeGreaterThan(calm[i].sensationalismScore);
        expect(crisis[i].sentimentScore).toBeLessThan(calm[i].sentimentScore);
      }
    });

    it("includes journalistic vocabulary per tier during crisis", () => {
      const crisis = generateMediaHeadlines(vendor, topic, 0.9);
      const agg = crisis.find((h) => h.tier === "aggregators")!;
      const dev = crisis.find((h) => h.tier === "dev_press")!;
      const tech = crisis.find((h) => h.tier === "tech_press")!;
      const fin = crisis.find((h) => h.tier === "financial_press")!;

      expect(agg.predictedHeadline).toMatch(/fury|controversial/i);
      expect(dev.predictedHeadline).toMatch(/engineers|abandoning/i);
      expect(tech.predictedHeadline).toMatch(/revolt|boycott/i);
      expect(fin.predictedHeadline).toMatch(/stock|antitrust|margins/i);
    });

    it("respects mathematical bounds [0, 10] for sensationalism and [-1, 1] for sentiment", () => {
      const extreme = generateMediaHeadlines(vendor, topic, 1.0);
      for (const h of extreme) {
        expect(h.sensationalismScore).toBeGreaterThanOrEqual(0);
        expect(h.sensationalismScore).toBeLessThanOrEqual(10);
        expect(h.sentimentScore).toBeGreaterThanOrEqual(-1.0);
        expect(h.sentimentScore).toBeLessThanOrEqual(1.0);
      }
    });

    it("handles vendor names with quotes, HTML tags, and punctuation safely", () => {
      const complexVendor = 'Acme & "Co." <script>alert(1)</script>';
      const headlines = generateMediaHeadlines(complexVendor, "pricing", 0.75);
      expect(headlines[0].predictedHeadline).toContain(complexVendor);
    });
  });

  // -------------------------------------------------------------------------
  // Feature 15: Automated "Vaccine" Copy Rewriter
  // -------------------------------------------------------------------------
  describe("Feature 15: generateVaccineRewrites", () => {
    const vendor = "DataCloud Inc";
    const targetARR = 30_000_000;

    it("generates exactly 3 distinct strategic counter-proposals", () => {
      const rewrites: VaccineRewriteItem[] = generateVaccineRewrites(vendor, targetARR);
      expect(rewrites).toHaveLength(3);

      const strategies = rewrites.map((r) => r.strategy);
      expect(strategies).toEqual([
        "grandfathering_shield",
        "transparent_unit_cost",
        "safe_harbor_free_tier",
      ]);
    });

    it("preserves >= 80% target revenue across all strategies", () => {
      const rewrites = generateVaccineRewrites(vendor, targetARR);
      for (const r of rewrites) {
        expect(r.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
        expect(r.preservedRevenuePercent).toBeLessThanOrEqual(100);
      }
    });

    it("delivers positive sentiment recovery and substantial revised copy", () => {
      const rewrites = generateVaccineRewrites(vendor, targetARR);
      for (const r of rewrites) {
        expect(r.projectedSentimentRecovery).toBeGreaterThan(0.5);
        expect(r.projectedSentimentRecovery).toBeLessThanOrEqual(1.0);
        expect(r.revisedCopy.length).toBeGreaterThan(50);
        expect(r.neutralizedObjections.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("neutralizes severe objections via keyword guarantees", () => {
      const rewrites = generateVaccineRewrites(vendor, targetARR);
      const grandfathering = rewrites.find((r) => r.strategy === "grandfathering_shield")!;
      const unitCost = rewrites.find((r) => r.strategy === "transparent_unit_cost")!;
      const safeHarbor = rewrites.find((r) => r.strategy === "safe_harbor_free_tier")!;

      expect(grandfathering.revisedCopy).toMatch(/grandfathered|legacy terms/i);
      expect(unitCost.revisedCopy).toMatch(/transparent|calculator|telemetry/i);
      expect(safeHarbor.revisedCopy).toMatch(/hobbyists|safe harbor|zero/i);
    });

    it("handles $0 target revenue safely without divide-by-zero", () => {
      const rewrites = generateVaccineRewrites("EarlyStage", 0);
      expect(rewrites).toHaveLength(3);
      for (const r of rewrites) {
        expect(r.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Complete Executive Decision Report & Dashboard
  // -------------------------------------------------------------------------
  describe("buildCompleteExecutiveReport", () => {
    it("assembles complete report with cleanroom self-contained HTML dashboard and inline SVG", () => {
      const report: ExecutiveDecisionReport = buildCompleteExecutiveReport({
        vendor: "NexusEngine",
        topic: "seat to consumption pricing transition",
        totalARR: 45_000_000,
        macroOutrage: 0.72,
        churnFraction: 0.16,
        competitors: [
          { name: "OpenNexus", isOSS: true, featureParity: 0.8, switchingFriction: 0.35 },
          { name: "LegacyInc", isOSS: false, featureParity: 0.9, switchingFriction: 0.7 },
        ],
      });

      expect(report.arrRisk.totalARR).toBe(45_000_000);
      expect(report.arrRisk.expectedChurnLossARR).toBeGreaterThan(0);
      expect(report.competitorMigration).toHaveLength(2);
      expect(report.mediaHeadlines).toHaveLength(4);
      expect(report.vaccineRewrites).toHaveLength(3);

      const html = report.renderedHtmlDashboard;
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("<svg");
      expect(html).toContain('id="arr-risk"');
      expect(html).toContain('id="migration-map"');
      expect(html).toContain('id="vaccine-rewrites"');

      // Cleanroom check: zero external HTTP/HTTPS resources
      expect(html).not.toMatch(/https?:\/\//);
    });
  });
});
