/**
 * Tier 2 — Boundary 5: Canonical Historical Backlash Corpus Boundaries (R1)
 * Tests severity bounds [0, 10], sentiment bounds [-1, 1], extreme 100% churn,
 * and invalid schemas.
 */
import { describe, expect, it } from "vitest";
import { validateHistoricalBacklashCase } from "../helpers/contracts.js";
import type { HistoricalBacklashCase } from "../helpers/contracts.js";

describe("Tier 2 - B05: Canonical Historical Backlash Corpus Boundaries", () => {
  it("accepts cases with severity at exact bounds 0.0 and 10.0", () => {
    const boundaryCase: HistoricalBacklashCase = {
      id: "boundary-case-1",
      title: "Boundary Case",
      vendor: "Vendor Corp",
      announcementDate: "2024-01-01",
      policySummary: "Summary",
      objections: [
        { category: "trivial", severity: 0, claim: "Negligible issue" },
        { category: "catastrophic", severity: 10, claim: "Complete model collapse" },
      ],
      timeline: [
        { stage: "announcement", daysAfterT0: 0, headline: "H1", sentimentScore: -1.0 },
        { stage: "aftermath", daysAfterT0: 365, headline: "H2", sentimentScore: 1.0 },
      ],
      churnImpact: {
        estimatedARRChurnPercent: 100.0, // Total collapse
        primaryMigrationDestinations: [{ competitor: "Competitor A", inflowShare: 1.0 }],
      },
    };

    const validated = validateHistoricalBacklashCase(boundaryCase);
    expect(validated.objections[0].severity).toBe(0);
    expect(validated.objections[1].severity).toBe(10);
    expect(validated.timeline[0].sentimentScore).toBe(-1.0);
    expect(validated.timeline[1].sentimentScore).toBe(1.0);
  });

  it("rejects severity scores exceeding 10.0 or below 0.0", () => {
    expect(() =>
      validateHistoricalBacklashCase({
        id: "bad_severity",
        title: "Bad Severity",
        vendor: "V",
        announcementDate: "2024-01-01",
        policySummary: "P",
        objections: [{ category: "c", severity: 11, claim: "Too high" }],
        timeline: [{ stage: "announcement", daysAfterT0: 0, headline: "H", sentimentScore: 0 }],
        churnImpact: { estimatedARRChurnPercent: 5, primaryMigrationDestinations: [] },
      }),
    ).toThrow("Invalid severity: 11");
  });

  it("rejects sentiment scores outside [-1.0, 1.0]", () => {
    expect(() =>
      validateHistoricalBacklashCase({
        id: "bad_sentiment",
        title: "Bad Sentiment",
        vendor: "V",
        announcementDate: "2024-01-01",
        policySummary: "P",
        objections: [{ category: "c", severity: 5, claim: "C" }],
        timeline: [{ stage: "announcement", daysAfterT0: 0, headline: "H", sentimentScore: -1.5 }],
        churnImpact: { estimatedARRChurnPercent: 5, primaryMigrationDestinations: [] },
      }),
    ).toThrow("Invalid sentimentScore: -1.5");
  });

  it("rejects unrecognized timeline stage identifiers", () => {
    expect(() =>
      validateHistoricalBacklashCase({
        id: "bad_stage",
        title: "Bad Stage",
        vendor: "V",
        announcementDate: "2024-01-01",
        policySummary: "P",
        objections: [{ category: "c", severity: 5, claim: "C" }],
        timeline: [
          // @ts-expect-error Testing invalid runtime stage enum
          { stage: "panic_attack", daysAfterT0: 0, headline: "H", sentimentScore: 0 },
        ],
        churnImpact: { estimatedARRChurnPercent: 5, primaryMigrationDestinations: [] },
      }),
    ).toThrow("Invalid stage: panic_attack");
  });

  it("handles long-tail timeline horizons spanning over 5 years (>1800 days)", () => {
    const multiYearCase: HistoricalBacklashCase = {
      id: "multi-year-case",
      title: "Five Year Case",
      vendor: "Legacy Inc",
      announcementDate: "2019-01-01",
      policySummary: "Gradual license sunsetting",
      objections: [{ category: "sunset", severity: 6, claim: "Long term migration" }],
      timeline: [
        { stage: "announcement", daysAfterT0: 0, headline: "Initial Notice", sentimentScore: -0.2 },
        { stage: "outrage", daysAfterT0: 30, headline: "Protests", sentimentScore: -0.6 },
        { stage: "aftermath", daysAfterT0: 1825, headline: "Final decommissioning", sentimentScore: -0.1 },
      ],
      churnImpact: { estimatedARRChurnPercent: 35, primaryMigrationDestinations: [] },
    };

    const validated = validateHistoricalBacklashCase(multiYearCase);
    expect(validated.timeline[2].daysAfterT0).toBe(1825);
  });
});
