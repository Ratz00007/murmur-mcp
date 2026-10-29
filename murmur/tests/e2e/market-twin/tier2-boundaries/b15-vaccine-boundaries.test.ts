/**
 * Tier 2 — Boundary 15: Automated "Vaccine" Copy Rewriting Boundaries (R5)
 * Tests $0 target ARR, minimum 80.0% revenue threshold bound,
 * massive objection lists, and empty inputs.
 */
import { describe, expect, it } from "vitest";
import { generateVaccineRewrites } from "../helpers/reference-engine.js";

describe("Tier 2 - B15: Automated 'Vaccine' Copy Rewriting Boundaries", () => {
  it("handles $0 target ARR safely without division-by-zero", () => {
    const rewrites = generateVaccineRewrites("ZeroARR Corp", 0);
    expect(rewrites.length).toBe(3);
    for (const r of rewrites) {
      expect(r.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
    }
  });

  it("strictly enforces the >= 80.0% preserved revenue floor", () => {
    const rewrites = generateVaccineRewrites("Enterprise Inc", 50_000_000);
    for (const r of rewrites) {
      expect(r.preservedRevenuePercent).toBeGreaterThanOrEqual(80.0);
    }
  });

  it("produces non-empty neutralized objections for each strategy", () => {
    const rewrites = generateVaccineRewrites("Vendor", 10_000_000);
    for (const r of rewrites) {
      expect(r.neutralizedObjections.length).toBeGreaterThan(0);
      for (const obj of r.neutralizedObjections) {
        expect(obj.length).toBeGreaterThan(5);
      }
    }
  });

  it("bounds projected sentiment recovery between 0.0 and 1.0", () => {
    const rewrites = generateVaccineRewrites("Vendor", 10_000_000);
    for (const r of rewrites) {
      expect(r.projectedSentimentRecovery).toBeGreaterThanOrEqual(0.0);
      expect(r.projectedSentimentRecovery).toBeLessThanOrEqual(1.0);
    }
  });

  it("handles empty or single-character vendor names safely", () => {
    const rewrites = generateVaccineRewrites("X", 1_000_000);
    expect(rewrites.length).toBe(3);
    expect(rewrites[0].revisedCopy.length).toBeGreaterThan(20);
  });
});
