/**
 * Tier 2 — Boundary 10: KOL Centrality Boundaries (R3)
 * Tests 0 followers, 100M followers ceiling, tie-breaking stability,
 * and recency decay extremes.
 */
import { describe, expect, it } from "vitest";
import { calculateKOLWeight, rankFeedPostsWithKOL } from "../helpers/reference-engine.js";

describe("Tier 2 - B10: KOL Centrality Boundaries", () => {
  it("evaluates lower bound at 0 followers and 0 authority", () => {
    const minWeight = calculateKOLWeight(0, 0);
    expect(minWeight).toBe(1.0);
  });

  it("strictly caps upper bound at 100.0 for hyper-influencers with 100M+ followers", () => {
    const maxWeight = calculateKOLWeight(100_000_000, 1.0);
    expect(maxWeight).toBe(100.0);
  });

  it("maintains deterministic tie-breaking for posts with identical feed scores", () => {
    const post1 = {
      id: "p_tie_1",
      text: "Tie post A",
      outrage: 0.5,
      replies: 10,
      quotes: 5,
      likes: 20,
      authorFollowers: 1000,
      authorPageRank: 0.2,
      recencyRound: 1,
    };
    const post2 = {
      id: "p_tie_2",
      text: "Tie post B",
      outrage: 0.5,
      replies: 10,
      quotes: 5,
      likes: 20,
      authorFollowers: 1000,
      authorPageRank: 0.2,
      recencyRound: 1,
    };

    const run1 = rankFeedPostsWithKOL([post1, post2], 1);
    const run2 = rankFeedPostsWithKOL([post1, post2], 1);
    expect(run1.map((p) => p.id)).toEqual(run2.map((p) => p.id));
  });

  it("decays ancient posts (round delta > 50) close to zero in feed recency", () => {
    const ancientPost = {
      id: "p_ancient",
      text: "Old announcement",
      outrage: 0.1,
      replies: 1,
      quotes: 0,
      likes: 1,
      authorFollowers: 100,
      authorPageRank: 0.01,
      recencyRound: 1,
    };

    const ranked = rankFeedPostsWithKOL([ancientPost], 60); // 59 rounds old
    expect(ranked[0].finalScore).toBeLessThan(1.0);
  });

  it("handles empty post arrays without throwing", () => {
    const emptyRanked = rankFeedPostsWithKOL([], 1);
    expect(emptyRanked).toEqual([]);
  });
});
