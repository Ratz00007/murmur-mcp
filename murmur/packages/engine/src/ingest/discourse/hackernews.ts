/**
 * Hacker News Discourse Adapter (Algolia API)
 * Hermetic by design: offline-fixture-only, zero egress. This adapter never
 * reads secrets and never touches the network — fetchThread always returns
 * the offline fixture, regardless of the options passed (kept for interface
 * compatibility).
 */

import {
  type AdapterFetchOptions,
  type DiscourseAdapter,
  type DiscoursePost,
  type DiscourseThread,
  validateDiscourseThread,
} from "./types.js";

export const HACKERNEWS_DEFAULT_FIXTURE: DiscourseThread = {
  platform: "hackernews",
  threadId: "hn_39785412",
  title: "Why We Are Forking Redis",
  author: "antirez_fan",
  url: "news.ycombinator.com/item?id=39785412",
  timestamp: "2024-03-22T08:15:00Z",
  metrics: { upvotes: 2150, comments: 842 },
  posts: [
    {
      postId: "hn_root",
      author: "antirez_fan",
      text: "The decision to abandon BSD-3 is a betrayal of the community contributors who spent a decade optimizing Redis internals. We must fork under neutral Linux Foundation stewardship.",
      timestamp: "2024-03-22T08:15:00Z",
      score: 2150,
      aspects: { ethics: -0.9, fork: 0.95 },
    },
    {
      postId: "hn_c1",
      parentId: "hn_root",
      author: "cloud_hacker",
      text: "AWS and Google contributed huge patches. They aren't going to roll over; they will sponsor the fork, maintain it, and the commercial entity will lose its primary pipeline of talent.",
      timestamp: "2024-03-22T08:30:00Z",
      score: 930,
      aspects: { economics: -0.75, competition: 0.8 },
    },
  ],
};

export class HackerNewsAdapter implements DiscourseAdapter {
  readonly platform = "hackernews" as const;

  async fetchThread(
    threadIdOrUrl: string,
    _options: AdapterFetchOptions = {},
  ): Promise<DiscourseThread> {
    // Hermetic: this adapter is offline-fixture-only by design. It never
    // reads secrets and never touches the network, whatever options are passed.
    return this.getOfflineFixture(threadIdOrUrl);
  }

  normalizeThread(raw: unknown): DiscourseThread {
    if (!raw) return this.getOfflineFixture("empty");

    const maybeThread = raw as Partial<DiscourseThread>;
    if (
      maybeThread.platform === "hackernews" &&
      Array.isArray(maybeThread.posts)
    ) {
      return validateDiscourseThread(raw);
    }

    const item = raw as Record<string, unknown>;
    if (item.id || item.title) {
      const threadId = item.id ? `hn_${item.id}` : "hn_story";
      const title = String(item.title || "Hacker News Story");
      const author = String(item.author || "hn_user");
      const url = `news.ycombinator.com/item?id=${item.id || 39785412}`;
      const upvotes = Number(item.points ?? 1);
      const timestamp = item.created_at
        ? String(item.created_at)
        : new Date().toISOString();

      const posts: DiscoursePost[] = [
        {
          postId: `hn_${item.id || "root"}`,
          author,
          text: String(item.text || item.title || ""),
          timestamp,
          score: upvotes,
          aspects: { community: 0.5 },
        },
      ];

      const children = item.children;
      if (Array.isArray(children)) {
        this.extractHnComments(children, posts, posts[0].postId);
      }

      return validateDiscourseThread({
        platform: "hackernews",
        threadId,
        title,
        author,
        url,
        timestamp,
        metrics: { upvotes, comments: posts.length - 1 },
        posts,
      });
    }

    return this.getOfflineFixture("unknown");
  }

  private extractHnComments(
    children: Array<Record<string, unknown>>,
    posts: DiscoursePost[],
    parentId: string,
    depth = 0,
  ): void {
    if (depth > 25) return;
    for (const child of children) {
      if (
        !child?.text ||
        child.text === "[dead]" ||
        child.text === "[deleted]"
      ) {
        continue;
      }
      const cId = `hn_${child.id || String(posts.length + 1)}`;
      const cAuthor = String(child.author || "user");
      const cText = String(child.text).replace(/<[^>]+>/g, " "); // Strip html tags
      const cScore = Number(child.points ?? 1);
      const cTs = child.created_at
        ? String(child.created_at)
        : new Date().toISOString();

      posts.push({
        postId: cId,
        parentId,
        author: cAuthor,
        text: cText.trim(),
        timestamp: cTs,
        score: cScore,
      });

      if (Array.isArray(child.children)) {
        this.extractHnComments(
          child.children as Array<Record<string, unknown>>,
          posts,
          cId,
          depth + 1,
        );
      }
    }
  }

  getOfflineFixture(id = ""): DiscourseThread {
    if (
      id &&
      id !== HACKERNEWS_DEFAULT_FIXTURE.threadId &&
      !id.includes("39785412")
    ) {
      return {
        ...HACKERNEWS_DEFAULT_FIXTURE,
        threadId: id.startsWith("hn_") ? id : `hn_${id}`,
      };
    }
    return HACKERNEWS_DEFAULT_FIXTURE;
  }
}
