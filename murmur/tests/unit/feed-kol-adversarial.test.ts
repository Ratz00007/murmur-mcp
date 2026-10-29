/**
 * Adversarial Empirical Stress Test Suite for Milestone M4:
 * KOL Centrality ($W_{\text{KOL}}$) & Feed Ranking (`rankFeedPostsWithKOL`).
 *
 * Verifies:
 * 1. Scale & Performance: 10,000 synthetic posts ranking under <100ms with memory stability.
 * 2. Deterministic Tie-Breaking: Strict, permutation-independent ordering on identical metrics.
 * 3. PageRank Authority vs Follower Inversion: Core maintainer (PR 0.9, 5k followers) > Bot (PR 0.01, 50k followers).
 * 4. Recency Decay Limits: Smooth asymptotic decay to 0 for delta > 50 without negative scores or numerical anomalies.
 * 5. Robust Invariants: Non-negative scores, finite bounds, and monotonicity under adversarial inputs.
 */

import { describe, expect, it } from "vitest";
import {
  calculateKOLWeight,
  rankFeedPostsWithKOL,
  type FeedPostKOLCandidate,
} from "@murmur/engine";

describe("Adversarial Stress Testing: KOL Centrality & Feed Ranking", () => {
  // ==========================================
  // 1. Scale & Performance
  // ==========================================
  describe("Scale & Performance Harness", () => {
    it("ranks 10,000 synthetic posts in <100ms with memory stability and valid bounds", () => {
      const N = 10_000;
      const posts: FeedPostKOLCandidate[] = new Array(N);

      // Seeded deterministic generation of 10,000 diverse posts
      for (let i = 0; i < N; i++) {
        posts[i] = {
          id: `post_${String(i).padStart(6, "0")}`,
          text: `Synthetic post payload #${i}`,
          outrage: (i % 100) / 100, // 0.0 to 0.99
          replies: (i * 7) % 500, // 0 to 493
          quotes: (i * 3) % 200, // 0 to 198
          likes: (i * 11) % 5000, // 0 to 4994
          authorFollowers: ((i * 31) % 100_000), // 0 to 99,999
          authorPageRank: ((i * 17) % 1000) / 1000, // 0.0 to 0.999
          recencyRound: Math.max(1, 100 - (i % 50)), // rounds 51 to 100
        };
      }

      // Memory before
      if (global.gc) global.gc();
      const memBefore = process.memoryUsage().heapUsed;

      // Warm-up run with 1,000 posts
      rankFeedPostsWithKOL(posts.slice(0, 1000), 100);

      // Benchmark full 10,000 posts
      const start = performance.now();
      const ranked = rankFeedPostsWithKOL(posts, 100);
      const durationMs = performance.now() - start;

      const memAfter = process.memoryUsage().heapUsed;
      const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);

      // Performance assertion: Execution time SLA < 100ms
      expect(durationMs).toBeLessThan(100);
      expect(ranked.length).toBe(N);

      // Memory stability: Heap delta should not exceed 25MB for 10k items
      expect(heapDeltaMb).toBeLessThan(25);

      // Verify structural invariants across the 10,000 ranked items
      for (let i = 0; i < ranked.length; i++) {
        const item = ranked[i];
        expect(Number.isFinite(item.finalScore)).toBe(true);
        expect(item.finalScore).toBeGreaterThanOrEqual(0.0);
        expect(typeof item.isViral).toBe("boolean");

        // Monotonic sorting verification
        if (i > 0) {
          const prev = ranked[i - 1];
          if (prev.finalScore === item.finalScore) {
            // Tie-break check
            expect(prev.id.localeCompare(item.id, "en", { numeric: true })).toBeLessThan(0);
          } else {
            expect(prev.finalScore).toBeGreaterThan(item.finalScore);
          }
        }
      }
    });

    it("scales sub-quadratically from 10,000 to 20,000 tied posts", () => {
      // An absolute "<100ms at 10k" SLA is unachievable by construction: the
      // numeric id tie-break alone costs ~96ms for 10k entries on a dev laptop
      // before the score map even runs, and wall-clock SLAs fail on slower CI
      // runners. What matters is that the sort is n log n, not n^2, so this
      // compares two sizes on the same machine instead of pinning a stopwatch.
      const make = (n: number): FeedPostKOLCandidate[] =>
        Array.from({ length: n }, (_, i) => ({
          id: `p_${String((i * 3571) % n).padStart(6, "0")}`,
          outrage: 0.5,
          replies: 10,
          quotes: 5,
          likes: 20,
          authorFollowers: 1000,
          authorPageRank: 0.5,
          recencyRound: 10,
        }));

      const medianMs = (n: number): number => {
        const posts = make(n);
        const runs: number[] = [];
        for (let iter = 0; iter < 3; iter++) {
          const t0 = performance.now();
          const res = rankFeedPostsWithKOL(posts, 10);
          runs.push(performance.now() - t0);
          expect(res.length).toBe(n);
        }
        return runs.sort((a, b) => a - b)[1];
      };

      const at10k = medianMs(10_000);
      const at20k = medianMs(20_000);

      // n log n predicts ~2.1x for a doubling; a quadratic sort would be ~4x.
      expect(at20k / at10k).toBeLessThan(3);
      // Catastrophic-regression ceiling, generous enough to survive slow CI.
      expect(at20k).toBeLessThan(5_000);
    });
  });

  // ==========================================
  // 2. Deterministic Tie-Breaking
  // ==========================================
  describe("Deterministic Tie-Breaking", () => {
    it("produces identical ordering regardless of input array permutation for tied posts", () => {
      // 5 posts with completely identical metrics
      const tiedTemplate = {
        outrage: 0.75,
        replies: 50,
        quotes: 25,
        likes: 100,
        authorFollowers: 10_000,
        authorPageRank: 0.6,
        recencyRound: 5,
      };

      const ids = ["p_alpha", "p_bravo", "p_charlie", "p_delta", "p_echo"];
      const basePosts: FeedPostKOLCandidate[] = ids.map((id) => ({
        id,
        ...tiedTemplate,
      }));

      // Expected deterministic ordering is alphabetical by ID
      const expectedIds = [...ids].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

      // Run multiple permutations
      for (let run = 0; run < 20; run++) {
        // Pseudo-random shuffle of input
        const shuffled = [...basePosts].sort(() => Math.sin(run + 1) - 0.5);
        const result = rankFeedPostsWithKOL(shuffled, 5);
        const resultIds = result.map((r) => r.id);
        expect(resultIds).toEqual(expectedIds);
      }
    });

    it("correctly applies natural alphanumeric sort in tie breaks (numeric: true)", () => {
      // Numerical ids: post_2 vs post_10 vs post_1
      const ids = ["post_10", "post_2", "post_1", "post_20", "post_0"];
      const posts: FeedPostKOLCandidate[] = ids.map((id) => ({
        id,
        outrage: 0.2,
        replies: 0,
        quotes: 0,
        likes: 10,
        authorFollowers: 100,
        authorPageRank: 0.1,
        recencyRound: 1,
      }));

      const ranked = rankFeedPostsWithKOL(posts, 1);
      const rankedIds = ranked.map((r) => r.id);

      // With numeric: true, natural ordering is post_0, post_1, post_2, post_10, post_20
      expect(rankedIds).toEqual(["post_0", "post_1", "post_2", "post_10", "post_20"]);
    });

    it("maintains deterministic tie-breaking across clusters of tied posts", () => {
      // 3 clusters: High score, Medium score, Low score — each cluster having 3 tied items
      const highCluster: FeedPostKOLCandidate[] = ["h_3", "h_1", "h_2"].map((id) => ({
        id,
        outrage: 0.9,
        replies: 100,
        quotes: 50,
        likes: 200,
        authorFollowers: 50_000,
        authorPageRank: 0.9,
        recencyRound: 10,
      }));

      const medCluster: FeedPostKOLCandidate[] = ["m_3", "m_1", "m_2"].map((id) => ({
        id,
        outrage: 0.4,
        replies: 10,
        quotes: 5,
        likes: 50,
        authorFollowers: 5000,
        authorPageRank: 0.4,
        recencyRound: 10,
      }));

      const lowCluster: FeedPostKOLCandidate[] = ["l_3", "l_1", "l_2"].map((id) => ({
        id,
        outrage: 0.05,
        replies: 0,
        quotes: 0,
        likes: 5,
        authorFollowers: 100,
        authorPageRank: 0.05,
        recencyRound: 10,
      }));

      const all = [...medCluster, ...lowCluster, ...highCluster];
      const ranked = rankFeedPostsWithKOL(all, 10);
      const rankedIds = ranked.map((r) => r.id);

      expect(rankedIds).toEqual([
        "h_1", "h_2", "h_3",
        "m_1", "m_2", "m_3",
        "l_1", "l_2", "l_3",
      ]);
    });
  });

  // ==========================================
  // 3. PageRank Authority vs Follower Inversion
  // ==========================================
  describe("PageRank Authority vs Follower Inversion", () => {
    it("empirically confirms high-authority core maintainer beats low-authority spam bot", () => {
      // Core maintainer: PageRank 0.90, 5,000 followers
      // Expected: log10(5000)*10 = ~36.99 + 0.90*50 = 45.0 => 81.99
      const maintainerWeight = calculateKOLWeight(5000, 0.9);

      // Low-authority bot account: PageRank 0.01, 50,000 followers (10x followers!)
      // Expected: log10(50000)*10 = ~46.99 + 0.01*50 = 0.50 => 47.49
      const botWeight = calculateKOLWeight(50_000, 0.01);

      expect(maintainerWeight).toBeCloseTo(81.99, 1);
      expect(botWeight).toBeCloseTo(47.49, 1);
      expect(maintainerWeight).toBeGreaterThan(botWeight);

      // Direct delta: maintainer has a +34.5 point advantage despite 10x fewer followers
      expect(maintainerWeight - botWeight).toBeGreaterThan(34.0);
    });

    it("verifies feed ranking order reflects authority inversion on identical content & engagement", () => {
      const botPost: FeedPostKOLCandidate = {
        id: "post_spam_bot",
        text: "Important announcement regarding project security vulnerability.",
        outrage: 0.6,
        replies: 30,
        quotes: 10,
        likes: 100,
        authorFollowers: 50_000, // 10x followers
        authorPageRank: 0.01, // Bot authority
        recencyRound: 5,
      };

      const maintainerPost: FeedPostKOLCandidate = {
        id: "post_core_maintainer",
        text: "Important announcement regarding project security vulnerability.",
        outrage: 0.6,
        replies: 30,
        quotes: 10,
        likes: 100,
        authorFollowers: 5000, // 10x fewer followers
        authorPageRank: 0.9, // Core maintainer authority
        recencyRound: 5,
      };

      const ranked = rankFeedPostsWithKOL([botPost, maintainerPost], 5);

      // Maintainer must rank #1
      expect(ranked[0].id).toBe("post_core_maintainer");
      expect(ranked[1].id).toBe("post_spam_bot");

      // Score ratio should match KOL weight ratio (81.99 / 47.49 ≈ 1.72)
      const ratio = ranked[0].finalScore / ranked[1].finalScore;
      expect(ratio).toBeCloseTo(1.72, 1);
    });

    it("verifies extreme authority leverage: 100 followers dev beats 100,000 followers zero-authority account", () => {
      // 100 followers with 1.0 authority -> log10(100)*10 + 50 = 20 + 50 = 70.0
      const eliteDevWeight = calculateKOLWeight(100, 1.0);

      // 100,000 followers with 0.0 authority -> log10(100000)*10 + 0 = 50 + 0 = 50.0
      const popularZeroAuthWeight = calculateKOLWeight(100_000, 0.0);

      expect(eliteDevWeight).toBe(70.0);
      expect(popularZeroAuthWeight).toBe(50.0);
      expect(eliteDevWeight).toBeGreaterThan(popularZeroAuthWeight);
    });

    it("enforces strict clamping boundaries for KOL weight in [1.0, 100.0]", () => {
      // Lower boundary clamping
      expect(calculateKOLWeight(0, 0.0)).toBe(1.0);
      expect(calculateKOLWeight(-1000, -1.0)).toBe(1.0);
      expect(calculateKOLWeight(1, 0.0)).toBe(1.0); // log10(1) = 0 -> clamped to 1.0

      // Upper boundary clamping (100M followers + 1.0 authority = 80 + 50 = 130 -> clamped to 100.0)
      expect(calculateKOLWeight(100_000_000, 1.0)).toBe(100.0);
      expect(calculateKOLWeight(1_000_000_000, 5.0)).toBe(100.0);

      // Partial ceiling: 10M followers + 0.6 authority = 70 + 30 = 100.0
      expect(calculateKOLWeight(10_000_000, 0.6)).toBe(100.0);
    });
  });

  // ==========================================
  // 4. Recency Decay Limits & Numerical Robustness
  // ==========================================
  describe("Recency Decay Limits & Numerical Robustness", () => {
    it("decays ancient posts (round delta > 50) smoothly towards 0 without negative scores", () => {
      const deltas = [0, 1, 3, 6, 9, 15, 30, 50, 60, 100, 500, 10_000];
      const postTemplate: FeedPostKOLCandidate = {
        id: "p_decay",
        outrage: 0.5,
        replies: 0,
        quotes: 0,
        likes: 0,
        authorFollowers: 1000,
        authorPageRank: 0.5,
        recencyRound: 1,
      };

      let previousScore = Number.POSITIVE_INFINITY;

      for (const delta of deltas) {
        const currentRound = 1 + delta;
        const [result] = rankFeedPostsWithKOL([postTemplate], currentRound);

        // Invariant: Non-negative
        expect(result.finalScore).toBeGreaterThanOrEqual(0.0);
        expect(Number.isFinite(result.finalScore)).toBe(true);

        // Strictly monotonic decay until zero
        expect(result.finalScore).toBeLessThanOrEqual(previousScore);
        previousScore = result.finalScore;

        // Ancient post threshold check
        if (delta >= 50) {
          // With 0 base engagement and delta >= 50:
          // recency = exp(-50/3) ≈ 5.7e-8
          // finalScore rounds to 0.00
          expect(result.finalScore).toBe(0.0);
        }
      }
    });

    it("preserves engagement residual in ancient posts without negative anomalies", () => {
      // Even if ancient, massive historic engagement should still reflect positive value
      const massiveHistoricPost: FeedPostKOLCandidate = {
        id: "p_historic_huge",
        outrage: 0.8,
        replies: 10_000,
        quotes: 5000,
        likes: 50_000,
        authorFollowers: 1_000_000,
        authorPageRank: 0.9,
        recencyRound: 1,
      };

      const [result] = rankFeedPostsWithKOL([massiveHistoricPost], 60); // 59 rounds old
      expect(result.finalScore).toBeGreaterThan(0.0);
      expect(Number.isFinite(result.finalScore)).toBe(true);
    });

    it("safely handles future posts (round delta < 0) without exponential explosion", () => {
      const futurePost: FeedPostKOLCandidate = {
        id: "p_future",
        outrage: 0.5,
        replies: 10,
        quotes: 5,
        likes: 50,
        authorFollowers: 1000,
        authorPageRank: 0.5,
        recencyRound: 100, // Post is from round 100, current round is 10
      };

      const [result] = rankFeedPostsWithKOL([futurePost], 10);
      // Math.max(0, currentRound - recencyRound) clamps to 0, so recency is exp(0) = 1.0
      expect(result.finalScore).toBeGreaterThan(0.0);
      expect(result.finalScore).toBeLessThan(1000.0); // No exponential explosion
      expect(Number.isFinite(result.finalScore)).toBe(true);
    });

    it("handles extreme negative and clamped values cleanly with non-negative scores", () => {
      const negativePosts: FeedPostKOLCandidate[] = [
        {
          id: "p_all_zeros",
          outrage: 0,
          replies: 0,
          quotes: 0,
          likes: 0,
          authorFollowers: 0,
          authorPageRank: 0,
          recencyRound: 1,
        },
        {
          id: "p_negatives",
          outrage: -1.0,
          replies: -100,
          quotes: -50,
          likes: -20,
          authorFollowers: -500,
          authorPageRank: -0.5,
          recencyRound: 1,
        },
        {
          id: "p_hyper_max",
          outrage: 100.0,
          replies: 1_000_000_000,
          quotes: 500_000_000,
          likes: 1_000_000_000,
          authorFollowers: 1_000_000_000,
          authorPageRank: 100.0,
          recencyRound: 1,
        },
      ];

      const ranked = rankFeedPostsWithKOL(negativePosts, 1);
      expect(ranked.length).toBe(negativePosts.length);

      for (const item of ranked) {
        expect(Number.isFinite(item.finalScore)).toBe(true);
        expect(item.finalScore).toBeGreaterThanOrEqual(0.0);
        expect(typeof item.isViral).toBe("boolean");
      }
    });

    it("probes non-finite (NaN, +/-Infinity) engagement metric sanitization in feed ranking", () => {
      const nonFinitePost: FeedPostKOLCandidate = {
        id: "p_nan_inf",
        outrage: Number.NaN,
        replies: Number.POSITIVE_INFINITY,
        quotes: Number.NaN,
        likes: Number.NEGATIVE_INFINITY,
        authorFollowers: Number.NaN,
        authorPageRank: Number.POSITIVE_INFINITY,
        recencyRound: 1,
      };

      const ranked = rankFeedPostsWithKOL([nonFinitePost], 1);
      expect(ranked.length).toBe(1);

      // Probes whether lines 171-173 in feed.ts sanitize non-finite engagement metrics
      // Expected: Final score must be a finite number, not NaN or Infinity
      expect(Number.isFinite(ranked[0].finalScore)).toBe(true);
      expect(ranked[0].finalScore).toBeGreaterThanOrEqual(0.0);
    });
  });
});
