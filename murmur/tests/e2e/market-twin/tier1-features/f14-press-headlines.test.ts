/**
 * Tier 1 — Feature 14: Media & Press Headline Predictor (R5)
 * Validates 4-tier press lifecycle simulation, sensationalism scaling,
 * sentiment score dynamics, and coverage categorization.
 */
import { describe, expect, it } from "vitest";
import { generateMediaHeadlines } from "../helpers/reference-engine.js";

describe("Tier 1 - F14: Media & Press Headline Predictor", () => {
  const vendor = "CloudScale";
  const topic = "mandatory minimum compute charges";

  it("simulates headlines across all 4 mandatory press tiers", () => {
    const headlines = generateMediaHeadlines(vendor, topic, 0.7);
    expect(headlines.length).toBe(4);

    const tiers = new Set(headlines.map((h) => h.tier));
    expect(tiers).toEqual(
      new Set(["aggregators", "dev_press", "tech_press", "financial_press"]),
    );
  });

  it("scales sensationalism and hostility scores with market outrage", () => {
    const calmHeadlines = generateMediaHeadlines(vendor, topic, 0.1);
    const crisisHeadlines = generateMediaHeadlines(vendor, topic, 0.85);

    for (let i = 0; i < 4; i++) {
      expect(crisisHeadlines[i].sensationalismScore).toBeGreaterThan(
        calmHeadlines[i].sensationalismScore,
      );
      expect(crisisHeadlines[i].sentimentScore).toBeLessThan(
        calmHeadlines[i].sentimentScore,
      );
    }
  });

  it("includes tier-specific journalistic angles and vocabulary", () => {
    const crisisHeadlines = generateMediaHeadlines(vendor, topic, 0.9);
    const agg = crisisHeadlines.find((h) => h.tier === "aggregators")!;
    const dev = crisisHeadlines.find((h) => h.tier === "dev_press")!;
    const tech = crisisHeadlines.find((h) => h.tier === "tech_press")!;
    const fin = crisisHeadlines.find((h) => h.tier === "financial_press")!;

    expect(agg.predictedHeadline).toMatch(/fury|controversial/i);
    expect(dev.predictedHeadline).toMatch(/engineers|abandoning/i);
    expect(tech.predictedHeadline).toMatch(/revolt|boycott/i);
    expect(fin.predictedHeadline).toMatch(/stock|antitrust|margins/i);
  });

  it("ensures sentiment scores strictly respect the [-1.0, 1.0] mathematical range", () => {
    const headlines = generateMediaHeadlines(vendor, topic, 0.95);
    for (const h of headlines) {
      expect(h.sentimentScore).toBeGreaterThanOrEqual(-1.0);
      expect(h.sentimentScore).toBeLessThanOrEqual(1.0);
      expect(h.sensationalismScore).toBeGreaterThanOrEqual(0);
      expect(h.sensationalismScore).toBeLessThanOrEqual(10);
    }
  });

  it("dampens financial and tech panic when market reaction is moderate", () => {
    const moderate = generateMediaHeadlines(vendor, topic, 0.2);
    const fin = moderate.find((h) => h.tier === "financial_press")!;
    expect(fin.sentimentScore).toBeGreaterThanOrEqual(0.0);
    expect(fin.sensationalismScore).toBeLessThanOrEqual(5.0);
  });
});
