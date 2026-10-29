/**
 * Tier 1 — Feature 15: Automated "Vaccine" Copy Rewriting (R5)
 * Validates strategic copy generation (Grandfathering Shield, Transparent Unit-Cost,
 * Safe Harbor Free Tier), >=80% revenue preservation, and objection neutralization.
 */
import { describe, expect, it } from "vitest";
import { generateVaccineRewrites } from "../helpers/reference-engine.js";

describe("Tier 1 - F15: Automated 'Vaccine' Copy Rewriter", () => {
  const vendor = "DataEngine Corp";
  const targetARR = 25_000_000;

  it("generates exactly 3 distinct strategic copy alternatives", () => {
    const rewrites = generateVaccineRewrites(vendor, targetARR);
    expect(rewrites.length).toBe(3);

    const strategies = rewrites.map((r) => r.strategy);
    expect(strategies).toEqual([
      "grandfathering_shield",
      "transparent_unit_cost",
      "safe_harbor_free_tier",
    ]);
  });

  it("guarantees >= 80% revenue preservation across all 3 rewrite strategies", () => {
    const rewrites = generateVaccineRewrites(vendor, targetARR);
    for (const r of rewrites) {
      expect(r.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
      expect(r.preservedRevenuePercent).toBeLessThanOrEqual(100);
    }
  });

  it("projects positive sentiment recovery for neutralized messaging", () => {
    const rewrites = generateVaccineRewrites(vendor, targetARR);
    for (const r of rewrites) {
      expect(r.projectedSentimentRecovery).toBeGreaterThan(0.5);
      expect(r.revisedCopy.length).toBeGreaterThan(50);
    }
  });

  it("explicitly neutralizes severe community objections in generated copy", () => {
    const rewrites = generateVaccineRewrites(vendor, targetARR);
    const grandfathering = rewrites.find((r) => r.strategy === "grandfathering_shield")!;
    const unitCost = rewrites.find((r) => r.strategy === "transparent_unit_cost")!;
    const safeHarbor = rewrites.find((r) => r.strategy === "safe_harbor_free_tier")!;

    expect(grandfathering.revisedCopy).toMatch(/grandfathered|legacy terms/i);
    expect(unitCost.revisedCopy).toMatch(/transparent|calculator|telemetry/i);
    expect(safeHarbor.revisedCopy).toMatch(/hobbyists|safe harbor|zero/i);

    expect(grandfathering.neutralizedObjections.length).toBeGreaterThanOrEqual(1);
    expect(unitCost.neutralizedObjections.length).toBeGreaterThanOrEqual(1);
    expect(safeHarbor.neutralizedObjections.length).toBeGreaterThanOrEqual(1);
  });

  it("safely handles multi-million target ARR revenue calibrations", () => {
    const enterpriseRewrites = generateVaccineRewrites("Hyperscale Inc", 100_000_000);
    expect(enterpriseRewrites.every((r) => r.preservedRevenuePercent >= 80)).toBe(true);
  });
});
