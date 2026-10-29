/**
 * Tier 2 — Boundary 13: Competitor Migration Inflow Maps Boundaries (R5)
 * Tests single monopoly competitor, $0 churn volume, extreme friction,
 * and equal utility distributions.
 */
import { describe, expect, it } from "vitest";
import { computeCompetitorMigration } from "../helpers/reference-engine.js";

describe("Tier 2 - B13: Competitor Migration Inflow Maps Boundaries", () => {
  it("allocates exactly 100% of churn to a single monopoly alternative", () => {
    const singleCompetitor = [{ name: "Sole Competitor", isOSS: true, featureParity: 1.0, switchingFriction: 0.2 }];
    const res = computeCompetitorMigration(10_000_000, 500, singleCompetitor);

    expect(res.length).toBe(1);
    expect(res[0].inflowSharePercent).toBe(100.0);
    expect(res[0].migratedARR).toBe(10_000_000);
    expect(res[0].migratedAccounts).toBe(500);
  });

  it("handles $0 churn ARR and 0 migrated accounts cleanly", () => {
    const competitors = [
      { name: "Comp A", isOSS: true, featureParity: 0.8, switchingFriction: 0.2 },
      { name: "Comp B", isOSS: false, featureParity: 0.7, switchingFriction: 0.5 },
    ];
    const res = computeCompetitorMigration(0, 0, competitors);

    expect(res.every((m) => m.migratedARR === 0)).toBe(true);
    expect(res.every((m) => m.migratedAccounts === 0)).toBe(true);
  });

  it("allocates near-zero share (<0.1%) to competitors with prohibitive switching friction", () => {
    const competitors = [
      { name: "Frictionless OSS", isOSS: true, featureParity: 0.9, switchingFriction: 0.1 },
      { name: "Impossible Migration", isOSS: false, featureParity: 0.2, switchingFriction: 10.0 }, // Prohibitive
    ];

    const res = computeCompetitorMigration(5_000_000, 200, competitors);
    const impossible = res.find((m) => m.competitor === "Impossible Migration")!;
    expect(impossible.inflowSharePercent).toBeLessThan(0.1);
  });

  it("splits shares identically across competitors with identical utility parameters", () => {
    const identicalCompetitors = [
      { name: "Clone A", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
      { name: "Clone B", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
      { name: "Clone C", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
      { name: "Clone D", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
    ];

    const res = computeCompetitorMigration(4_000_000, 400, identicalCompetitors);
    for (const m of res) {
      expect(m.inflowSharePercent).toBe(25.0);
      expect(m.migratedARR).toBe(1_000_000);
      expect(m.migratedAccounts).toBe(100);
    }
  });

  it("handles empty competitors array safely without crashing", () => {
    const emptyRes = computeCompetitorMigration(1_000_000, 100, []);
    expect(emptyRes).toEqual([]);
  });
});
