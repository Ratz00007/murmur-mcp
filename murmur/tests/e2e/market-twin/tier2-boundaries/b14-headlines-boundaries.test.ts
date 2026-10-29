/**
 * Tier 2 — Boundary 14: Press Headline Predictor Boundaries (R5)
 * Tests outrage boundaries (0.0 vs 1.0), vendor name escaping,
 * massive topic strings, and contract validation.
 */
import { describe, expect, it } from "vitest";
import { generateMediaHeadlines } from "../helpers/reference-engine.js";

describe("Tier 2 - B14: Press Headline Predictor Boundaries", () => {
  it("evaluates headlines at exact lower outrage bound 0.0", () => {
    const calm = generateMediaHeadlines("Vendor", "update", 0.0);
    expect(calm.length).toBe(4);
    for (const h of calm) {
      expect(h.sensationalismScore).toBeLessThanOrEqual(5.0);
      expect(h.sentimentScore).toBeGreaterThanOrEqual(-0.25);
    }
  });

  it("evaluates headlines at exact upper outrage bound 1.0", () => {
    const crisis = generateMediaHeadlines("Vendor", "update", 1.0);
    expect(crisis.length).toBe(4);
    for (const h of crisis) {
      expect(h.sensationalismScore).toBeGreaterThanOrEqual(7.0);
      expect(h.sentimentScore).toBeLessThan(-0.5);
    }
  });

  it("safely handles vendor names containing punctuation, quotes, and HTML-like tags", () => {
    const safeVendor = "Vendor & Co. <script>alert(1)</script> 'Corp'";
    const headlines = generateMediaHeadlines(safeVendor, "pricing", 0.8);
    expect(headlines[0].predictedHeadline).toContain(safeVendor);
  });

  it("handles extremely long topic strings (>500 characters) safely", () => {
    const longTopic = "mandatory telemetry fee ".repeat(30);
    const headlines = generateMediaHeadlines("Vendor", longTopic, 0.7);
    expect(headlines.length).toBe(4);
    expect(typeof headlines[0].predictedHeadline).toBe("string");
  });

  it("preserves unique tier categorization across all generated headlines", () => {
    const headlines = generateMediaHeadlines("Vendor", "topic", 0.5);
    const tiers = headlines.map((h) => h.tier);
    const uniqueTiers = new Set(tiers);
    expect(uniqueTiers.size).toBe(4);
  });
});
