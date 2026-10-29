/**
 * Tier 1 — Feature 13: Competitor Migration Inflow Maps (R5)
 * Validates multinomial logit destination choice, inflow share distribution,
 * open-source preference bonuses, and switching friction impedance.
 */
import { describe, expect, it } from "vitest";
import { computeCompetitorMigration } from "../helpers/reference-engine.js";

describe("Tier 1 - F13: Competitor Migration Inflow Maps", () => {
  const totalChurnARR = 12_000_000;
  const totalChurnAccounts = 1500;
  const competitors = [
    { name: "Godot Engine", isOSS: true, featureParity: 0.85, switchingFriction: 0.3 },
    { name: "Unreal Engine", isOSS: false, featureParity: 0.95, switchingFriction: 0.6 },
    { name: "Custom Engine", isOSS: true, featureParity: 0.5, switchingFriction: 0.8 },
  ];

  it("calculates multinomial logit destination choice inflow shares", () => {
    const migration = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
    expect(migration.length).toBe(3);

    for (const m of migration) {
      expect(m.inflowSharePercent).toBeGreaterThan(0);
      expect(m.migratedARR).toBeGreaterThan(0);
      expect(m.migratedAccounts).toBeGreaterThan(0);
      expect(m.keyDefectionDrivers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("ensures total inflow share percentages sum to approximately 100%", () => {
    const migration = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
    const totalShare = migration.reduce((sum, m) => sum + m.inflowSharePercent, 0);
    expect(totalShare).toBeCloseTo(100.0, 0);
  });

  it("boosts open-source alternatives with low switching friction to top destination", () => {
    const migration = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
    const godot = migration.find((m) => m.competitor === "Godot Engine");
    const unreal = migration.find((m) => m.competitor === "Unreal Engine");

    expect(godot).toBeDefined();
    expect(unreal).toBeDefined();
    // Godot has high OSS bonus + lower friction, leading inflow
    expect(godot!.inflowSharePercent).toBeGreaterThan(unreal!.inflowSharePercent);
  });

  it("dampens inflow volume for competitors with high switching friction", () => {
    const migration = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
    const custom = migration.find((m) => m.competitor === "Custom Engine");

    expect(custom).toBeDefined();
    expect(custom!.inflowSharePercent).toBeLessThan(20.0);
  });

  it("distributes total churn ARR and account counts proportionally to inflow shares", () => {
    const migration = computeCompetitorMigration(totalChurnARR, totalChurnAccounts, competitors);
    const totalAllocatedARR = migration.reduce((sum, m) => sum + m.migratedARR, 0);
    const totalAllocatedAccounts = migration.reduce((sum, m) => sum + m.migratedAccounts, 0);

    expect(totalAllocatedARR).toBeCloseTo(totalChurnARR, -4);
    expect(totalAllocatedAccounts).toBeCloseTo(totalChurnAccounts, -2);
  });
});
