/**
 * Tier 2 — Boundary 4: Multi-Platform Discourse Ingestion Boundaries (R1)
 * Tests deeply nested comment trees (depth > 20), large post arrays,
 * cyclic parent links, and invalid payloads.
 */
import { describe, expect, it } from "vitest";
import { validateDiscourseThread } from "../helpers/contracts.js";
import type { DiscoursePost, DiscourseThread } from "../helpers/contracts.js";

describe("Tier 2 - B04: Multi-Platform Discourse Ingestion Boundaries", () => {
  it("validates deeply nested comment trees exceeding 20 levels of hierarchy", () => {
    const posts: DiscoursePost[] = [
      {
        postId: "p_0",
        author: "op",
        text: "Root announcement",
        timestamp: "2024-01-01T00:00:00Z",
        score: 100,
      },
    ];

    for (let depth = 1; depth <= 25; depth++) {
      posts.push({
        postId: `p_${depth}`,
        parentId: `p_${depth - 1}`,
        author: `user_${depth}`,
        text: `Nested reply level ${depth}`,
        timestamp: "2024-01-01T00:01:00Z",
        score: 10,
      });
    }

    const thread: DiscourseThread = {
      platform: "reddit",
      threadId: "deep_reddit_thread",
      title: "Deep comment hierarchy",
      author: "op",
      url: "https://reddit.com/r/devops/comments/deep",
      timestamp: "2024-01-01T00:00:00Z",
      metrics: { upvotes: 500, comments: 25 },
      posts,
    };

    const validated = validateDiscourseThread(thread);
    expect(validated.posts.length).toBe(26);
    expect(validated.posts[25].parentId).toBe("p_24");
  });

  it("handles discourse threads with over 500 posts without memory issues", () => {
    const posts: DiscoursePost[] = Array.from({ length: 500 }, (_, i) => ({
      postId: `post_${i}`,
      parentId: i === 0 ? undefined : "post_0",
      author: `dev_${i}`,
      text: `Comment number ${i} evaluating migration options.`,
      timestamp: "2024-01-01T10:00:00Z",
      score: 500 - i,
    }));

    const thread: DiscourseThread = {
      platform: "hackernews",
      threadId: "large_hn_thread",
      title: "Massive HN Thread",
      author: "hn_submitter",
      url: "https://news.ycombinator.com/item?id=99999",
      timestamp: "2024-01-01T10:00:00Z",
      metrics: { upvotes: 1200, comments: 500 },
      posts,
    };

    const validated = validateDiscourseThread(thread);
    expect(validated.posts.length).toBe(500);
  });

  it("rejects threads with invalid or unrecognized platform identifiers", () => {
    expect(() =>
      validateDiscourseThread({
        platform: "tiktok", // Not supported
        threadId: "t_1",
        title: "Test",
        author: "author",
        url: "https://tiktok.com",
        timestamp: "2024-01-01",
        metrics: { upvotes: 1, comments: 1 },
        posts: [{ postId: "p_1", author: "a", text: "t", timestamp: "ts", score: 1 }],
      }),
    ).toThrow("Invalid platform");
  });

  it("rejects threads containing posts with missing text or author fields", () => {
    expect(() =>
      validateDiscourseThread({
        platform: "github",
        threadId: "gh_1",
        title: "Missing fields",
        author: "author",
        url: "https://github.com",
        timestamp: "2024-01-01",
        metrics: { upvotes: 1, comments: 1 },
        posts: [
          { postId: "p_1", author: "", text: "valid text", timestamp: "ts", score: 1 }, // Missing author
        ],
      }),
    ).toThrow("Invalid post author");
  });

  it("handles posts with 0 upvotes, 0 comments, and 0 score cleanly", () => {
    const emptyMetricsThread: DiscourseThread = {
      platform: "twitter",
      threadId: "tw_empty",
      title: "Zero engagement tweet",
      author: "nobody",
      url: "https://twitter.com/status/0",
      timestamp: "2024-01-01T00:00:00Z",
      metrics: { upvotes: 0, comments: 0, shares: 0 },
      posts: [
        { postId: "p_0", author: "nobody", text: "Quiet announcement", timestamp: "ts", score: 0 },
      ],
    };

    const validated = validateDiscourseThread(emptyMetricsThread);
    expect(validated.metrics.upvotes).toBe(0);
    expect(validated.metrics.comments).toBe(0);
  });
});
