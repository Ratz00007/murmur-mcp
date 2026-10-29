/**
 * Unit Tests for Milestone M4: Algorithmic Feed Dynamics & Controversy Amplification (Features 9 & 10).
 *
 * Verifies:
 * - Quadratic Outrage Amplification function M_outrage(o) = 1.0 + 3.0 * o^2
 * - "The Ratio" metric, boundary toggle at 2.0, division-by-zero protection, and controversy capping
 * - Power-law Key Opinion Leader (KOL) network centrality weighting in [1.0, 100.0]
 * - Algorithmic feed ranking combining recency, engagement, ratio, KOL reach, and outrage
 * - Deterministic tie-breaking and virality classification
 * - End-to-end buildFeed() integration with controversy & outrage multiplier cascades
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  calculateKOLWeight,
  computeOutrageMultiplier,
  computeTheRatio,
  rankFeedPostsWithKOL,
  buildFeed,
  openDatabase,
  Storage,
  DEFAULT_CONFIG,
  type Post,
  type Entity,
} from "@murmur/engine";

describe("Milestone M4: Algorithmic Feed Dynamics (Features 9 & 10)", () => {
  describe("computeOutrageMultiplier", () => {
    it("computes exact quadratic outrage amplification M_outrage(o)", () => {
      expect(computeOutrageMultiplier(0.0)).toBe(1.0);
      expect(computeOutrageMultiplier(0.5)).toBeCloseTo(1.75, 4);
      expect(computeOutrageMultiplier(1.0)).toBe(4.0);
    });

    it("verifies quadratic curve intermediate points", () => {
      // 0.25 -> 1.0 + 3.0 * (0.0625) = 1.1875
      expect(computeOutrageMultiplier(0.25)).toBeCloseTo(1.1875, 4);
      // 0.75 -> 1.0 + 3.0 * (0.5625) = 2.6875
      expect(computeOutrageMultiplier(0.75)).toBeCloseTo(2.6875, 4);
    });

    it("clamps negative outrage inputs to 0.0 returning baseline 1.0", () => {
      expect(computeOutrageMultiplier(-0.01)).toBe(1.0);
      expect(computeOutrageMultiplier(-0.5)).toBe(1.0);
      expect(computeOutrageMultiplier(-100)).toBe(1.0);
    });

    it("clamps excessive outrage inputs to 1.0 returning maximum 4.0", () => {
      expect(computeOutrageMultiplier(1.01)).toBe(4.0);
      expect(computeOutrageMultiplier(2.5)).toBe(4.0);
      expect(computeOutrageMultiplier(999.0)).toBe(4.0);
    });

    it("exhibits strict monotonicity over the valid [0.0, 1.0] interval", () => {
      const steps = [0.0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
      for (let i = 1; i < steps.length; i++) {
        expect(computeOutrageMultiplier(steps[i])).toBeGreaterThan(
          computeOutrageMultiplier(steps[i - 1]),
        );
      }
    });

    it("safely handles non-finite numbers without throwing", () => {
      expect(computeOutrageMultiplier(Number.NaN)).toBe(1.0);
      expect(computeOutrageMultiplier(Number.POSITIVE_INFINITY)).toBe(4.0);
      expect(computeOutrageMultiplier(Number.NEGATIVE_INFINITY)).toBe(1.0);
    });
  });

  describe("computeTheRatio", () => {
    it("evaluates baseline when engagement is completely zero", () => {
      const res = computeTheRatio(0, 0, 0);
      expect(res.ratioScore).toBe(0);
      expect(res.isRatioed).toBe(false);
      expect(res.controversyMultiplier).toBe(1.0);
    });

    it("identifies healthy engagement ratios with high likes", () => {
      // 10,000 likes, 100 replies, 50 quotes -> (100 + 75) / 10,000 = 0.0175 -> 0.02
      const res = computeTheRatio(100, 50, 10_000);
      expect(res.ratioScore).toBe(0.02);
      expect(res.isRatioed).toBe(false);
      expect(res.controversyMultiplier).toBe(1.0);
    });

    it("prevents division-by-zero error when post has zero likes", () => {
      const res = computeTheRatio(150, 40, 0);
      // safeLikes = 1 -> ratioScore = (150 + 60) / 1 = 210
      expect(res.ratioScore).toBe(210);
      expect(res.isRatioed).toBe(true);
      expect(Number.isFinite(res.ratioScore)).toBe(true);
      expect(res.controversyMultiplier).toBeGreaterThan(3.0);
    });

    it("toggles isRatioed precisely at the 2.0 boundary", () => {
      // 200 replies vs 100 likes -> ratio 2.0 exactly
      const atBoundary = computeTheRatio(200, 0, 100);
      expect(atBoundary.ratioScore).toBe(2.0);
      expect(atBoundary.isRatioed).toBe(true);

      // 199 replies vs 100 likes -> ratio 1.99
      const belowBoundary = computeTheRatio(199, 0, 100);
      expect(belowBoundary.ratioScore).toBe(1.99);
      expect(belowBoundary.isRatioed).toBe(false);
    });

    it("weights quote-tweets with 1.5x multiplier in ratio computation", () => {
      // 100 quotes vs 100 likes -> (100 * 1.5) / 100 = 1.50
      const quoteOnly = computeTheRatio(0, 100, 100);
      expect(quoteOnly.ratioScore).toBe(1.5);
      expect(quoteOnly.isRatioed).toBe(false);

      // 134 quotes vs 100 likes -> (134 * 1.5) / 100 = 2.01
      const quoteRatioed = computeTheRatio(0, 134, 100);
      expect(quoteRatioed.ratioScore).toBe(2.01);
      expect(quoteRatioed.isRatioed).toBe(true);
    });

    it("caps controversyMultiplier at 5.0 under astronomical ratios", () => {
      const astronomical = computeTheRatio(10_000_000, 5_000_000, 1);
      expect(astronomical.controversyMultiplier).toBe(5.0);
    });

    it("clamps negative engagement counts to zero safely", () => {
      const sanitized = computeTheRatio(-50, -20, -10);
      expect(sanitized.ratioScore).toBe(0);
      expect(sanitized.isRatioed).toBe(false);
      expect(sanitized.controversyMultiplier).toBe(1.0);
    });

    it("ensures monotonic increase of controversy multiplier with rising ratio", () => {
      const ratios = [
        computeTheRatio(10, 0, 100), // 0.1
        computeTheRatio(100, 0, 100), // 1.0
        computeTheRatio(1000, 0, 100), // 10.0
        computeTheRatio(10_000, 0, 100), // 100.0
        computeTheRatio(100_000, 0, 100), // 1000.0
      ];
      for (let i = 2; i < ratios.length; i++) {
        expect(ratios[i].controversyMultiplier).toBeGreaterThan(
          ratios[i - 1].controversyMultiplier,
        );
      }
    });

    it("handles non-finite parameters safely", () => {
      const safe = computeTheRatio(Number.NaN, Number.NaN, Number.NaN);
      expect(safe.ratioScore).toBe(0);
      expect(safe.isRatioed).toBe(false);
      expect(safe.controversyMultiplier).toBe(1.0);
    });
  });

  describe("calculateKOLWeight", () => {
    it("evaluates lower bound at 0 followers and 0 authority", () => {
      expect(calculateKOLWeight(0, 0.0)).toBe(1.0);
    });

    it("strictly caps upper bound at 100.0 for mega-influencers", () => {
      expect(calculateKOLWeight(100_000_000, 1.0)).toBe(100.0);
      expect(calculateKOLWeight(1_000_000_000, 1.0)).toBe(100.0);
    });

    it("ensures monotonic increase with audience scale across orders of magnitude", () => {
      const followers = [10, 100, 1000, 10_000, 100_000, 1_000_000];
      const weights = followers.map((f) => calculateKOLWeight(f, 0.5));
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]);
      }
    });

    it("modulates influence by PageRank authority independently of follower count", () => {
      // 50,000 followers, 0.01 authority (e.g. spam/bot account)
      const botWeight = calculateKOLWeight(50_000, 0.01);
      // 5,000 followers, 0.90 authority (e.g. recognized core maintainer)
      const maintainerWeight = calculateKOLWeight(5000, 0.9);
      expect(maintainerWeight).toBeGreaterThan(botWeight);
    });

    it("clamps negative followers and authority values without throwing", () => {
      expect(calculateKOLWeight(-500, -0.5)).toBe(1.0);
    });

    it("clamps authority values greater than 1.0 to 1.0", () => {
      const normalMax = calculateKOLWeight(10_000, 1.0);
      const excessive = calculateKOLWeight(10_000, 5.0);
      expect(excessive).toBe(normalMax);
    });

    it("handles non-finite values safely", () => {
      expect(calculateKOLWeight(Number.NaN, Number.NaN)).toBe(1.0);
    });
  });

  describe("rankFeedPostsWithKOL", () => {
    it("ranks high-outrage, ratioed posts higher than neutral posts of equal age", () => {
      const posts = [
        {
          id: "p_routine",
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
          text: "Retroactively charging $0.20 per install starting next month.",
          outrage: 0.95,
          replies: 5000,
          quotes: 2500,
          likes: 200,
          authorFollowers: 10_000,
          authorPageRank: 0.8,
          recencyRound: 1,
        },
      ];

      const ranked = rankFeedPostsWithKOL(posts, 1);
      expect(ranked[0].id).toBe("p_backlash");
      expect(ranked[0].isViral).toBe(true);
      expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore * 10);
    });

    it("amplifies algorithmic feed score for industry KOLs", () => {
      const regularUserPost = {
        id: "p_reg",
        outrage: 0.5,
        replies: 10,
        quotes: 2,
        likes: 25,
        authorFollowers: 120,
        authorPageRank: 0.05,
        recencyRound: 1,
      };

      const kolUserPost = {
        id: "p_kol",
        outrage: 0.5,
        replies: 10,
        quotes: 2,
        likes: 25,
        authorFollowers: 75_000,
        authorPageRank: 0.85,
        recencyRound: 1,
      };

      const ranked = rankFeedPostsWithKOL([regularUserPost, kolUserPost], 1);
      expect(ranked[0].id).toBe("p_kol");
      expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore * 2);
    });

    it("flags posts as viral when ratioed even if raw finalScore is under 50", () => {
      const lowVolumeRatioedPost = {
        id: "p_ratioed_small",
        outrage: 0.1,
        replies: 10,
        quotes: 5,
        likes: 2, // ratio = (10 + 7.5)/2 = 8.75 >= 2.0
        authorFollowers: 50,
        authorPageRank: 0.05,
        recencyRound: 1,
      };

      const ranked = rankFeedPostsWithKOL([lowVolumeRatioedPost], 1);
      expect(ranked[0].isViral).toBe(true);
    });

    it("maintains deterministic tie-breaking stability regardless of input ordering", () => {
      const postA = {
        id: "p_alpha",
        outrage: 0.5,
        replies: 20,
        quotes: 10,
        likes: 40,
        authorFollowers: 1000,
        authorPageRank: 0.3,
        recencyRound: 2,
      };
      const postB = {
        id: "p_beta",
        outrage: 0.5,
        replies: 20,
        quotes: 10,
        likes: 40,
        authorFollowers: 1000,
        authorPageRank: 0.3,
        recencyRound: 2,
      };

      const order1 = rankFeedPostsWithKOL([postA, postB], 2);
      const order2 = rankFeedPostsWithKOL([postB, postA], 2);

      expect(order1.map((p) => p.id)).toEqual(order2.map((p) => p.id));
      expect(order1[0].id).toBe("p_alpha");
      expect(order1[1].id).toBe("p_beta");
    });

    it("decays ancient posts exponentially as round delta grows", () => {
      const post = {
        id: "p_ancient",
        outrage: 0.2,
        replies: 5,
        quotes: 1,
        likes: 10,
        authorFollowers: 500,
        authorPageRank: 0.1,
        recencyRound: 1,
      };

      const fresh = rankFeedPostsWithKOL([post], 1);
      const stale = rankFeedPostsWithKOL([post], 50);

      expect(fresh[0].finalScore).toBeGreaterThan(stale[0].finalScore * 5);
      expect(stale[0].finalScore).toBeLessThan(1.0);
    });

    it("handles empty post list gracefully", () => {
      expect(rankFeedPostsWithKOL([], 1)).toEqual([]);
    });
  });

  describe("buildFeed Dynamic Integration", () => {
    const tmpDir = () =>
      fs.mkdtempSync(path.join(os.tmpdir(), "murmur-feed-test-"));

    it("amplifies controversial high-outrage posts in simulated feed synthesis", () => {
      const dir = tmpDir();
      const dbPath = path.join(dir, "test.db");
      const storage = new Storage(openDatabase(dbPath));

      const world = storage.createWorld({
        name: "Feed Test World",
        seed: "feed-seed",
      });

      const testTraits = {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        emotionalStability: 0.5,
      };

      const [vendorPersona, viewerPersona, commenterPersona] =
        storage.insertPersonas(world.id, [
          {
            name: "Vendor",
            handle: "tech_vendor",
            platform: "twitter",
            bio: "Platform vendor",
            archetype: "pragmatist",
            traits: testTraits,
            stances: {},
            communityIds: [],
            follows: [],
            activity: 1.0,
          },
          {
            name: "Observer",
            handle: "observer",
            platform: "twitter",
            bio: "Senior engineer",
            archetype: "pragmatist",
            traits: testTraits,
            stances: {},
            communityIds: [],
            follows: [],
            activity: 1.0,
          },
          {
            name: "Commenter",
            handle: "angry_dev",
            platform: "twitter",
            bio: "Frustrated developer",
            archetype: "adversary",
            traits: testTraits,
            stances: {},
            communityIds: [],
            follows: [],
            activity: 1.0,
          },
        ]);

      // Viewer follows vendor
      viewerPersona.follows = [vendorPersona.id];

      // Neutral post
      const neutralPost: Post = {
        id: "post_neutral",
        worldId: world.id,
        round: 1,
        personaId: vendorPersona.id,
        platform: "twitter",
        kind: "post",
        parentId: null,
        threadId: "post_neutral",
        communityId: null,
        title: null,
        body: "Released version 2.4 with performance improvements and bug fixes.",
        metrics: {
          likes: 10,
          reposts: 2,
          upvotes: 0,
          downvotes: 0,
          impressions: 100,
        },
        mentions: [],
        origin: "organic",
      };
      storage.insertPost(neutralPost);

      // Controversial high-outrage post
      const outragePost: Post = {
        id: "post_outrage",
        worldId: world.id,
        round: 1,
        personaId: vendorPersona.id,
        platform: "twitter",
        kind: "post",
        parentId: null,
        threadId: "post_outrage",
        communityId: null,
        title: null,
        body: "Disastrous breaking changes, terrible prices, and greedy paywall backlash.",
        metrics: {
          likes: 5,
          reposts: 50,
          upvotes: 0,
          downvotes: 0,
          impressions: 500,
        },
        mentions: [],
        origin: "organic",
      };
      storage.insertPost(outragePost);

      // Add dissenting replies to outragePost to build a ratio
      for (let i = 1; i <= 20; i++) {
        const reply: Post = {
          id: `reply_outrage_${i}`,
          worldId: world.id,
          round: 1,
          personaId: commenterPersona.id,
          platform: "twitter",
          kind: "reply",
          parentId: outragePost.id,
          threadId: outragePost.id,
          communityId: null,
          title: null,
          body: `Unacceptable betrayal and ripoff! #${i}`,
          metrics: {
            likes: 1,
            reposts: 0,
            upvotes: 0,
            downvotes: 0,
            impressions: 10,
          },
          mentions: [],
          origin: "organic",
        };
        storage.insertPost(reply);
      }

      const handles = new Map([
        [vendorPersona.id, "tech_vendor"],
        [viewerPersona.id, "observer"],
        [commenterPersona.id, "angry_dev"],
      ]);
      const entities: Entity[] = [];

      const feedItems = buildFeed(
        storage,
        world,
        viewerPersona,
        2,
        DEFAULT_CONFIG,
        entities,
        handles,
      );

      // The controversial outrage post with ratioed replies must rank #1
      expect(feedItems.length).toBeGreaterThanOrEqual(2);
      expect(feedItems[0].id).toBe("post_outrage");
      expect(feedItems[1].id).toBe("post_neutral");

      storage.db.close();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore lingering Windows locks
      }
    });
  });
});
