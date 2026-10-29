/**
 * Tier 1 — Feature 9: Outrage Amplification & The Ratio (R3)
 * Validates quadratic outrage amplification, "The Ratio" threshold detection,
 * controversy multipliers, and feed ranking prioritization.
 */
import { describe, expect, it } from "vitest";
import {
  computeOutrageMultiplier,
  computeTheRatio,
  rankFeedPostsWithKOL,
} from "../helpers/reference-engine.js";

describe("Tier 1 - F09: Outrage Amplification & The Ratio", () => {
  it("computes quadratic outrage amplification M_outrage(o)", () => {
    expect(computeOutrageMultiplier(0.0)).toBe(1.0);
    expect(computeOutrageMultiplier(0.5)).toBeCloseTo(1.75, 2);
    expect(computeOutrageMultiplier(1.0)).toBe(4.0);
  });

  it("detects 'The Ratio' when replies and quotes significantly exceed likes", () => {
    // 2500 replies, 1200 quotes vs 400 likes => ratio ~ 10.75
    const ratioData = computeTheRatio(2500, 1200, 400);
    expect(ratioData.isRatioed).toBe(true);
    expect(ratioData.ratioScore).toBeGreaterThan(10.0);
    expect(ratioData.controversyMultiplier).toBeGreaterThan(2.0);
  });

  it("handles posts with zero likes without division by zero error", () => {
    const zeroLikes = computeTheRatio(150, 40, 0);
    expect(zeroLikes.isRatioed).toBe(true);
    expect(zeroLikes.ratioScore).toBeGreaterThanOrEqual(150);
    expect(Number.isFinite(zeroLikes.ratioScore)).toBe(true);
  });

  it("distinguishes positive virality from hostile backlash ratios", () => {
    // Post A: 10,000 likes, 100 replies, 50 quotes (Celebrated release)
    const postA = computeTheRatio(100, 50, 10_000);
    // Post B: 500 likes, 4,000 replies, 2,500 quotes (Backlash announcement)
    const postB = computeTheRatio(4000, 2500, 500);

    expect(postA.isRatioed).toBe(false);
    expect(postB.isRatioed).toBe(true);
    expect(postB.ratioScore).toBeGreaterThan(postA.ratioScore * 100);
  });

  it("ranks high-outrage, ratioed posts at top of algorithmic controversy feeds", () => {
    const samplePosts = [
      {
        id: "p_neutral",
        text: "Routine maintenance completed.",
        outrage: 0.05,
        replies: 2,
        quotes: 0,
        likes: 50,
        authorFollowers: 500,
        authorPageRank: 0.1,
        recencyRound: 1,
      },
      {
        id: "p_backlash",
        text: "We are retroactively billing $0.20 per install starting January.",
        outrage: 0.95,
        replies: 5000,
        quotes: 2500,
        likes: 200,
        authorFollowers: 10_000,
        authorPageRank: 0.8,
        recencyRound: 1,
      },
    ];

    const ranked = rankFeedPostsWithKOL(samplePosts, 1);
    expect(ranked[0].id).toBe("p_backlash");
    expect(ranked[0].isViral).toBe(true);
    expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore * 10);
  });
});
