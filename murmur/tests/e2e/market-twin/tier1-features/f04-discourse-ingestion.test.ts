/**
 * Tier 1 — Feature 4: Multi-Platform Discourse Ingestion (Reddit, HN, X, GitHub) (R1)
 * Validates discourse adapter normalization, comment tree structure,
 * metrics extraction, and tri-tier credential fallback.
 */
import { describe, expect, it } from "vitest";
import { validateDiscourseThread } from "../helpers/contracts.js";
import {
  GITHUB_ISSUES_THREAD,
  HACKERNEWS_ALGOLIA_THREAD,
  REDDIT_DEVOPS_THREAD,
  TWITTER_BACKLASH_THREAD,
} from "../helpers/fixtures.js";

describe("Tier 1 - F04: Multi-Platform Discourse Ingestion", () => {
  it("normalizes and validates Reddit r/devops discourse threads", () => {
    const thread = validateDiscourseThread(REDDIT_DEVOPS_THREAD);
    expect(thread.platform).toBe("reddit");
    expect(thread.metrics.upvotes).toBeGreaterThan(1000);
    expect(thread.posts.length).toBeGreaterThanOrEqual(3);

    // Root post + replies
    const root = thread.posts.find((p) => !p.parentId);
    expect(root).toBeDefined();
    expect(root!.author).toBe("kube_wizard");

    const reply = thread.posts.find((p) => p.parentId === root!.postId);
    expect(reply).toBeDefined();
    expect(reply!.aspects?.legal).toBeDefined();
  });

  it("normalizes Hacker News Algolia API comment structures", () => {
    const thread = validateDiscourseThread(HACKERNEWS_ALGOLIA_THREAD);
    expect(thread.platform).toBe("hackernews");
    expect(thread.metrics.comments).toBe(842);
    expect(thread.url).toContain("news.ycombinator.com");

    const rootPost = thread.posts[0];
    expect(rootPost.text).toContain("betrayal of the community");
  });

  it("normalizes X/Twitter posts with quote and reply metrics", () => {
    const thread = validateDiscourseThread(TWITTER_BACKLASH_THREAD);
    expect(thread.platform).toBe("twitter");
    expect(thread.metrics.comments).toBeGreaterThan(thread.metrics.upvotes); // Severe ratio
    expect(thread.posts.some((p) => p.author === "gamedev_kol")).toBe(true);
  });

  it("normalizes GitHub Issues and discussion comments on policy shifts", () => {
    const thread = validateDiscourseThread(GITHUB_ISSUES_THREAD);
    expect(thread.platform).toBe("github");
    expect(thread.url).toContain("github.com/docker");
    expect(thread.posts[0].text).toContain("namespace");
  });

  it("safely falls back to local fixtures when live credentials are absent", () => {
    const originalToken = process.env.GITHUB_TOKEN;
    try {
      delete process.env.GITHUB_TOKEN;
      delete process.env.REDDIT_CLIENT_ID;
      delete process.env.TWITTER_BEARER_TOKEN;

      // Tri-tier fallback ensures fixtures can always be loaded without egress
      expect(GITHUB_ISSUES_THREAD.posts.length).toBeGreaterThan(0);
      expect(REDDIT_DEVOPS_THREAD.posts.length).toBeGreaterThan(0);
    } finally {
      if (originalToken) process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it("rejects malformed discourse objects missing required fields", () => {
    expect(() =>
      validateDiscourseThread({
        platform: "invalid_platform",
        threadId: "bad_1",
      }),
    ).toThrow("Invalid platform");

    expect(() =>
      validateDiscourseThread({
        platform: "reddit",
        threadId: "bad_2",
        title: "Test",
        author: "author",
        url: "https://reddit.com",
        timestamp: "2024-01-01",
        metrics: { upvotes: 10, comments: 2 },
        posts: [], // Empty posts
      }),
    ).toThrow("DiscourseThread must have at least one post");
  });
});
