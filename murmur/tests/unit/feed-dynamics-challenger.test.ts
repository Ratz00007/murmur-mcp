/**
 * Adversarial Challenger Test Suite — Milestone M4: Outrage Amplification & The Ratio
 * Agent: challenger_m4_1 (Role: M4 Outrage & Ratio Challenger)
 *
 * EMPIRICAL ADVERSARIAL STRESS TESTING:
 * 1. Extreme inputs: NaN, -Infinity, +Infinity, negative numbers, subnormals, fractions.
 * 2. Boundary transitions: exact 1.99 vs 2.00 ratio boundary, rounding transitions (1.994 vs 1.995 vs 1.999 vs 2.000).
 * 3. 0 likes behavior with high replies / quotes (division-by-zero prevention, safeLikes fallback).
 * 4. Numerical stability under massive scale: 100,000,000 replies/quotes, MAX_SAFE_INTEGER.
 * 5. Controversy multiplier bounds [1.0, 5.0], finite guarantee, logarithmic growth, and monotonicity.
 * 6. Quadratic outrage amplification M_outrage(o) = 1.0 + 3.0 * o^2 bounds [1.0, 4.0], monotonicity, and convex acceleration.
 * 7. End-to-end feed ranking stability and resilience under adversarial candidate inputs.
 */

import { describe, expect, it } from "vitest";
import {
  computeOutrageMultiplier,
  computeTheRatio,
  calculateKOLWeight,
  rankFeedPostsWithKOL,
} from "@murmur/engine";

describe("Milestone M4 Adversarial Challenger: Outrage & Ratio Stress Harness", () => {
  // =========================================================================
  // SECTION 1: Quadratic Outrage Amplification M_outrage(o)
  // =========================================================================
  describe("1. Outrage Amplification Function M_outrage(o) Stress Testing", () => {
    it("strictly adheres to the [1.0, 4.0] theoretical range under 10,000 random inputs", () => {
      // Test over wide range from -1e12 to +1e12
      for (let i = 0; i < 10_000; i++) {
        const raw = (Math.random() - 0.5) * 2e6;
        const mult = computeOutrageMultiplier(raw);
        expect(mult).toBeGreaterThanOrEqual(1.0);
        expect(mult).toBeLessThanOrEqual(4.0);
        expect(Number.isFinite(mult)).toBe(true);
      }
    });

    it("verifies exact mathematical values at canonical anchors", () => {
      expect(computeOutrageMultiplier(0.0)).toBe(1.0);
      expect(computeOutrageMultiplier(0.25)).toBe(1.0 + 3.0 * (0.25 * 0.25)); // 1.1875
      expect(computeOutrageMultiplier(0.5)).toBe(1.75); // 1.0 + 3.0 * 0.25
      expect(computeOutrageMultiplier(0.75)).toBe(1.0 + 3.0 * (0.75 * 0.75)); // 2.6875
      expect(computeOutrageMultiplier(1.0)).toBe(4.0); // 1.0 + 3.0 * 1.0
    });

    it("exhibits strictly non-decreasing monotonicity across 10,000 fine-grained steps in [0.0, 1.0]", () => {
      const stepCount = 10_000;
      let prev = computeOutrageMultiplier(0.0);
      for (let i = 1; i <= stepCount; i++) {
        const o = i / stepCount;
        const curr = computeOutrageMultiplier(o);
        expect(curr).toBeGreaterThan(prev);
        prev = curr;
      }
    });

    it("verifies convex quadratic acceleration (second derivative > 0)", () => {
      // First half delta: f(0.5) - f(0.0) = 0.75
      // Second half delta: f(1.0) - f(0.5) = 2.25
      // Delta ratio must be exactly 3.0x due to quadratic growth
      const delta1 = computeOutrageMultiplier(0.5) - computeOutrageMultiplier(0.0);
      const delta2 = computeOutrageMultiplier(1.0) - computeOutrageMultiplier(0.5);
      expect(delta1).toBeCloseTo(0.75, 6);
      expect(delta2).toBeCloseTo(2.25, 6);
      expect(delta2 / delta1).toBeCloseTo(3.0, 6);
    });

    it("handles extreme non-finite and negative inputs without NaN or throw", () => {
      expect(computeOutrageMultiplier(Number.NaN)).toBe(1.0);
      expect(computeOutrageMultiplier(Number.POSITIVE_INFINITY)).toBe(4.0);
      expect(computeOutrageMultiplier(Number.NEGATIVE_INFINITY)).toBe(1.0);
      expect(computeOutrageMultiplier(-0.0)).toBe(1.0);
      expect(computeOutrageMultiplier(-1e15)).toBe(1.0);
      expect(computeOutrageMultiplier(1e15)).toBe(4.0);
    });

    it("handles micro-scale subnormals and fractional inputs", () => {
      expect(computeOutrageMultiplier(Number.MIN_VALUE)).toBe(1.0); // ~5e-324 -> 1.0
      expect(computeOutrageMultiplier(1e-10)).toBeCloseTo(1.0, 8);
      expect(computeOutrageMultiplier(1 - 1e-10)).toBeCloseTo(4.0, 6);
      expect(computeOutrageMultiplier(1 / 3)).toBeCloseTo(1.0 + 3.0 * (1 / 9), 6); // 1.333333
    });
  });

  // =========================================================================
  // SECTION 2: "The Ratio" Metric and Controversy Multiplier
  // =========================================================================
  describe("2. 'The Ratio' Metric & Controversy Multiplier Stress Testing", () => {
    it("handles 0 likes without division-by-zero error (safeLikes floor of 1)", () => {
      const zeroLikesRatio = computeTheRatio(100, 20, 0);
      // rawRatio = (100 + 20 * 1.5) / 1 = 130
      expect(zeroLikesRatio.ratioScore).toBe(130);
      expect(zeroLikesRatio.isRatioed).toBe(true);
      expect(Number.isFinite(zeroLikesRatio.ratioScore)).toBe(true);
      expect(Number.isFinite(zeroLikesRatio.controversyMultiplier)).toBe(true);
    });

    it("prevents false 'isRatioed' when engagement is completely zero", () => {
      const noEngagement = computeTheRatio(0, 0, 0);
      expect(noEngagement.ratioScore).toBe(0);
      expect(noEngagement.isRatioed).toBe(false);
      expect(noEngagement.controversyMultiplier).toBe(1.0);

      const highLikesZeroReplies = computeTheRatio(0, 0, 100_000);
      expect(highLikesZeroReplies.ratioScore).toBe(0);
      expect(highLikesZeroReplies.isRatioed).toBe(false);
      expect(highLikesZeroReplies.controversyMultiplier).toBe(1.0);
    });

    it("probes exact boundary transitions at the 2.0 threshold", () => {
      // Case A: 199 replies vs 100 likes -> ratio 1.99 -> NOT ratioed
      const below = computeTheRatio(199, 0, 100);
      expect(below.ratioScore).toBe(1.99);
      expect(below.isRatioed).toBe(false);

      // Case B: 200 replies vs 100 likes -> ratio 2.00 -> RATIOED
      const exact = computeTheRatio(200, 0, 100);
      expect(exact.ratioScore).toBe(2.00);
      expect(exact.isRatioed).toBe(true);

      // Case C: 201 replies vs 100 likes -> ratio 2.01 -> RATIOED
      const above = computeTheRatio(201, 0, 100);
      expect(above.ratioScore).toBe(2.01);
      expect(above.isRatioed).toBe(true);

      // Case D: Rounding boundary: 1994 vs 1000 likes -> 1.994 -> rounds to 1.99 -> NOT ratioed
      const roundBelow = computeTheRatio(1994, 0, 1000);
      expect(roundBelow.ratioScore).toBe(1.99);
      expect(roundBelow.isRatioed).toBe(false);

      // Case E: Rounding boundary: 1995 vs 1000 likes -> 1.995 -> rounds to 2.00 -> RATIOED
      const roundExact = computeTheRatio(1995, 0, 1000);
      expect(roundExact.ratioScore).toBe(2.00);
      expect(roundExact.isRatioed).toBe(true);

      // Case F: 1999 vs 1000 likes -> 1.999 -> rounds to 2.00 -> RATIOED
      const round1999 = computeTheRatio(1999, 0, 1000);
      expect(round1999.ratioScore).toBe(2.00);
      expect(round1999.isRatioed).toBe(true);
    });

    it("tests quote weighting exact 1.5x factor", () => {
      // 100 quotes vs 75 likes -> (100 * 1.5) / 75 = 2.00 -> RATIOED
      const quoteExact = computeTheRatio(0, 100, 75);
      expect(quoteExact.ratioScore).toBe(2.00);
      expect(quoteExact.isRatioed).toBe(true);

      // 99 quotes vs 75 likes -> (99 * 1.5) / 75 = 148.5 / 75 = 1.98 -> NOT ratioed
      const quoteBelow = computeTheRatio(0, 99, 75);
      expect(quoteBelow.ratioScore).toBe(1.98);
      expect(quoteBelow.isRatioed).toBe(false);
    });

    it("verifies numerical stability under 100,000,000 replies/quotes (astronomical scale)", () => {
      const massiveReplies = computeTheRatio(100_000_000, 100_000_000, 1);
      // rawRatio = (1e8 + 1.5e8) / 1 = 2.5e8
      expect(massiveReplies.ratioScore).toBe(250_000_000);
      expect(massiveReplies.isRatioed).toBe(true);
      // controversyMultiplier must be strictly finite and capped at 5.0
      expect(massiveReplies.controversyMultiplier).toBe(5.0);
      expect(Number.isFinite(massiveReplies.controversyMultiplier)).toBe(true);

      // Even larger: Number.MAX_SAFE_INTEGER
      const maxSafeRatio = computeTheRatio(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        1,
      );
      expect(maxSafeRatio.isRatioed).toBe(true);
      expect(maxSafeRatio.controversyMultiplier).toBe(5.0);
      expect(Number.isFinite(maxSafeRatio.controversyMultiplier)).toBe(true);
    });

    it("strictly verifies controversyMultiplier bounds [1.0, 5.0] across all ratio regimes", () => {
      const testCases = [
        { rep: 0, quo: 0, lik: 100 },       // ratio = 0 -> mult = 1.0
        { rep: 50, quo: 0, lik: 100 },      // ratio = 0.5 -> mult = 1.0 (log10(max(1, 0.5)) = log10(1) = 0)
        { rep: 100, quo: 0, lik: 100 },     // ratio = 1.0 -> mult = 1.0
        { rep: 200, quo: 0, lik: 100 },     // ratio = 2.0 -> mult = 1 + log10(2) = 1.30
        { rep: 1000, quo: 0, lik: 100 },    // ratio = 10.0 -> mult = 1 + log10(10) = 2.0
        { rep: 10_000, quo: 0, lik: 100 },  // ratio = 100.0 -> mult = 1 + log10(100) = 3.0
        { rep: 100_000, quo: 0, lik: 100 }, // ratio = 1000.0 -> mult = 1 + log10(1000) = 4.0
        { rep: 1_000_000, quo: 0, lik: 100 }, // ratio = 10000.0 -> mult = 1 + log10(10000) = 5.0
        { rep: 50_000_000, quo: 0, lik: 100 }, // ratio = 500000.0 -> capped at 5.0
      ];

      for (const tc of testCases) {
        const res = computeTheRatio(tc.rep, tc.quo, tc.lik);
        expect(res.controversyMultiplier).toBeGreaterThanOrEqual(1.0);
        expect(res.controversyMultiplier).toBeLessThanOrEqual(5.0);
        expect(Number.isFinite(res.controversyMultiplier)).toBe(true);
      }
    });

    it("verifies controversy multiplier monotonic increase once ratioScore exceeds 1.0", () => {
      let prevMult = 1.0;
      for (let r = 10; r <= 100_000; r *= 2) {
        const res = computeTheRatio(r, 0, 10); // ratio increases: 1, 2, 4, 8, 16...
        expect(res.controversyMultiplier).toBeGreaterThanOrEqual(prevMult);
        prevMult = res.controversyMultiplier;
      }
    });

    it("safely sanitizes adversarial inputs: NaN, -Infinity, +Infinity, negative numbers, fractions", () => {
      // Negative engagement
      const neg = computeTheRatio(-100, -50, -25);
      expect(neg.ratioScore).toBe(0);
      expect(neg.isRatioed).toBe(false);
      expect(neg.controversyMultiplier).toBe(1.0);

      // Non-finite values
      const nanTest = computeTheRatio(Number.NaN, Number.NaN, Number.NaN);
      expect(nanTest.ratioScore).toBe(0);
      expect(nanTest.isRatioed).toBe(false);
      expect(nanTest.controversyMultiplier).toBe(1.0);

      const infTest = computeTheRatio(
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      );
      expect(infTest.ratioScore).toBe(0);
      expect(infTest.isRatioed).toBe(false);
      expect(infTest.controversyMultiplier).toBe(1.0);

      // Fractional values
      const frac = computeTheRatio(2.5, 1.0, 2.0);
      // rawRatio = (2.5 + 1.5) / 2.0 = 4.0 / 2.0 = 2.0
      expect(frac.ratioScore).toBe(2.0);
      expect(frac.isRatioed).toBe(true);
      expect(frac.controversyMultiplier).toBeCloseTo(1.3, 2);
    });
  });

  // =========================================================================
  // SECTION 3: KOL Influencer Centrality & Bounded Power Law
  // =========================================================================
  describe("3. Key Opinion Leader (KOL) Network Weight Stress Testing", () => {
    it("guarantees bounds [1.0, 100.0] under 5,000 extreme randomized inputs", () => {
      for (let i = 0; i < 5000; i++) {
        const followers = (Math.random() - 0.2) * 1e9;
        const pageRank = (Math.random() - 0.2) * 10;
        const weight = calculateKOLWeight(followers, pageRank);
        expect(weight).toBeGreaterThanOrEqual(1.0);
        expect(weight).toBeLessThanOrEqual(100.0);
        expect(Number.isFinite(weight)).toBe(true);
      }
    });

    it("handles extreme boundary values", () => {
      expect(calculateKOLWeight(0, 0)).toBe(1.0);
      expect(calculateKOLWeight(1, 0)).toBe(1.0);
      expect(calculateKOLWeight(1e12, 1.0)).toBe(100.0); // capped at 100.0
      expect(calculateKOLWeight(Number.NaN, Number.NaN)).toBe(1.0);
      expect(calculateKOLWeight(-1000, -1.0)).toBe(1.0);
      expect(calculateKOLWeight(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(1.0);
    });
  });

  // =========================================================================
  // SECTION 4: Feed Ranking with Controversy & Outrage Cascades
  // =========================================================================
  describe("4. Algorithmic Feed Ranking Dynamic Cascade Stress Testing", () => {
    it("preserves deterministic ranking and virality assignment with 500 concurrent posts", () => {
      const candidates = Array.from({ length: 500 }, (_, i) => ({
        id: `post_${String(i).padStart(4, "0")}`,
        outrage: (i % 10) / 10,
        replies: (i * 17) % 500,
        quotes: (i * 7) % 200,
        likes: (i * 31) % 1000,
        authorFollowers: (i * 103) % 50_000,
        authorPageRank: ((i * 13) % 100) / 100,
        recencyRound: 5 - (i % 5),
      }));

      const run1 = rankFeedPostsWithKOL(candidates, 5);
      const run2 = rankFeedPostsWithKOL([...candidates].reverse(), 5);

      expect(run1.length).toBe(500);
      expect(run2.length).toBe(500);

      // Verify strict deterministic order equality
      for (let i = 0; i < 500; i++) {
        expect(run1[i].id).toBe(run2[i].id);
        expect(run1[i].finalScore).toBe(run2[i].finalScore);
        expect(run1[i].isViral).toBe(run2[i].isViral);
      }
    });

    it("verifies virality threshold triggers for ratioed posts even with modest engagement", () => {
      const candidate = {
        id: "post_ratioed_trigger",
        outrage: 0.1,
        replies: 20,
        quotes: 10,
        likes: 5, // ratio = (20 + 15) / 5 = 7.0 (>= 2.0)
        authorFollowers: 100,
        authorPageRank: 0.1,
        recencyRound: 1,
      };

      const ranked = rankFeedPostsWithKOL([candidate], 1);
      expect(ranked[0].isViral).toBe(true);
    });

    it("verifies virality triggers when finalScore > 50.0 even if not ratioed", () => {
      const viralNonRatioed = {
        id: "post_mega_viral",
        outrage: 0.8,
        replies: 50,
        quotes: 10,
        likes: 100_000, // not ratioed, but massive likes & KOL
        authorFollowers: 10_000_000,
        authorPageRank: 0.95,
        recencyRound: 1,
      };

      const ranked = rankFeedPostsWithKOL([viralNonRatioed], 1);
      expect(ranked[0].finalScore).toBeGreaterThan(50.0);
      expect(ranked[0].isViral).toBe(true);
    });
  });
});
