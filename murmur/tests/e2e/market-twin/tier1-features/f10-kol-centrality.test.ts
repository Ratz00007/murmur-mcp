/**
 * Tier 1 — Feature 10: KOL / Influencer Network Centrality (R3)
 * Validates power-law reach scaling, PageRank authority weighting,
 * KOL cascade amplification, and bounded [1.0, 100.0] multiplier ranges.
 */
import { describe, expect, it } from "vitest";
import { calculateKOLWeight, rankFeedPostsWithKOL } from "../helpers/reference-engine.js";

describe("Tier 1 - F10: KOL / Influencer Network Centrality", () => {
  it("calculates power-law KOL weights bounded in [1.0, 100.0]", () => {
    const minWeight = calculateKOLWeight(0, 0.0);
    const midWeight = calculateKOLWeight(1000, 0.2);
    const maxWeight = calculateKOLWeight(1_000_000, 0.95);

    expect(minWeight).toBe(1.0);
    expect(midWeight).toBeGreaterThan(minWeight);
    expect(maxWeight).toBeLessThanOrEqual(100.0);
  });

  it("modulates influence by PageRank authority independently of raw follower count", () => {
    // High followers but zero authority (e.g. spam/bot account)
    const botWeight = calculateKOLWeight(50_000, 0.01);
    // Moderate followers but recognized core maintainer authority
    const coreDevWeight = calculateKOLWeight(5000, 0.9);

    expect(coreDevWeight).toBeGreaterThan(botWeight);
  });

  it("amplifies algorithmic feed scores for industry KOLs during discourse", () => {
    const ordinaryDevPost = {
      id: "p_ord",
      text: "I dislike this license shift.",
      outrage: 0.5,
      replies: 10,
      quotes: 2,
      likes: 25,
      authorFollowers: 120,
      authorPageRank: 0.05,
      recencyRound: 1,
    };

    const kolPost = {
      id: "p_kol",
      text: "This license shift is a direct breach of community covenant. We are forking.",
      outrage: 0.5,
      replies: 10,
      quotes: 2,
      likes: 25,
      authorFollowers: 75_000,
      authorPageRank: 0.85,
      recencyRound: 1,
    };

    const ranked = rankFeedPostsWithKOL([ordinaryDevPost, kolPost], 1);
    expect(ranked[0].id).toBe("p_kol");
    expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore * 2);
  });

  it("ensures monotonic increase of KOL weight with increasing audience reach", () => {
    const weights = [10, 100, 1000, 10_000, 100_000].map((f) =>
      calculateKOLWeight(f, 0.5),
    );

    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThan(weights[i - 1]);
    }
  });

  it("flags KOL posts as viral when combined with elevated outrage and ratio", () => {
    const viralKOLPost = {
      id: "p_viral_kol",
      text: "Boycott announced.",
      outrage: 0.85,
      replies: 1500,
      quotes: 800,
      likes: 300,
      authorFollowers: 150_000,
      authorPageRank: 0.9,
      recencyRound: 1,
    };

    const ranked = rankFeedPostsWithKOL([viralKOLPost], 1);
    expect(ranked[0].isViral).toBe(true);
    expect(ranked[0].finalScore).toBeGreaterThan(100.0);
  });
});
