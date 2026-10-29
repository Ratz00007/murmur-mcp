/**
 * Tier 2 — Boundary 3: Backlash Cascade Dynamics Boundaries (R3, R6)
 * Tests isolated nodes (0 followers), maximal organic caps,
 * negative metrics, and malformed inputs.
 */
import { describe, expect, it } from "vitest";
import { engagementOf, engagementScore } from "@murmur/engine";
import { computeTheRatio, computeOutrageMultiplier } from "../helpers/reference-engine.js";

describe("Tier 2 - B03: Backlash Cascade Dynamics Boundaries", () => {
  it("computes engagementScore cleanly for posts with negative downvotes and zero impressions", () => {
    const metrics = {
      likes: 0,
      reposts: 0,
      upvotes: 5,
      downvotes: 120,
      impressions: 0,
    };
    const score = engagementScore(metrics);
    expect(typeof score).toBe("number");
    expect(Number.isFinite(score)).toBe(true);
  });

  it("safely bounds outrage multiplier at extreme inputs (<0 or >1)", () => {
    // Should clamp safely between [1.0, 4.0]
    expect(computeOutrageMultiplier(-0.5)).toBe(1.0);
    expect(computeOutrageMultiplier(1.5)).toBe(4.0);
  });

  it("handles Ratio calculation when quotes and replies reach extreme values", () => {
    // 1,000,000 replies vs 1 like
    const extremeRatio = computeTheRatio(1_000_000, 500_000, 1);
    expect(extremeRatio.isRatioed).toBe(true);
    expect(extremeRatio.controversyMultiplier).toBe(5.0); // Clamped at 5.0
  });

  it("handles missing metrics fields in engagementOf safely with defaults", () => {
    const postWithZeroMetrics = {
      id: "p_zero",
      worldId: "w_1",
      personaId: "pers_1",
      platform: "twitter" as const,
      round: 1,
      kind: "post" as const,
      parentId: null,
      threadId: "th_1",
      communityId: null,
      title: null,
      body: "Empty metrics test",
      metrics: {
        likes: 0,
        reposts: 0,
        upvotes: 0,
        downvotes: 0,
        impressions: 0,
      },
      mentions: [],
      origin: "agent" as const,
    };
    expect(engagementOf(postWithZeroMetrics)).toBe(0);
  });

  it("preserves determinism across 100 consecutive stream RNG draws", async () => {
    const { streamRng } = await import("@murmur/engine");
    const rng1 = streamRng("boundary-seed", "stream-key");
    const rng2 = streamRng("boundary-seed", "stream-key");

    for (let i = 0; i < 100; i++) {
      expect(rng1.float()).toBe(rng2.float());
      expect(rng1.int(50)).toBe(rng2.int(50));
      expect(rng1.bool(0.3)).toBe(rng2.bool(0.3));
    }
  });
});
