/**
 * Reddit Discourse Adapter (r/devops, etc.)
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

export const REDDIT_DEFAULT_FIXTURE: DiscourseThread = {
  platform: "reddit",
  threadId: "reddit_devops_licensing_pivot",
  title:
    "Vendor switches to source-available license. What is your team doing?",
  author: "kube_wizard",
  url: "reddit.com/r/devops/comments/xyz123/vendor_switches_licensing",
  timestamp: "2024-03-21T14:32:00Z",
  metrics: { upvotes: 1420, comments: 385, shares: 120 },
  posts: [
    {
      postId: "p_root",
      author: "kube_wizard",
      text: "With the latest license change, our enterprise legal team is asking for an immediate audit. Are people migrating to forks or paying up?",
      timestamp: "2024-03-21T14:32:00Z",
      score: 1420,
      aspects: { legal: -0.7, migration: 0.8 },
    },
    {
      postId: "p_c1",
      parentId: "p_root",
      author: "infra_lead_99",
      text: "We are freezing all upgrades today. We run over 400 clusters and cannot risk ambiguity around what constitutes a 'competitive offering'. Fork migration is already underway.",
      timestamp: "2024-03-21T14:45:00Z",
      score: 840,
      aspects: { legal: -0.9, risk: -0.85, fork: 0.9 },
    },
    {
      postId: "p_c2",
      parentId: "p_c1",
      author: "corp_architect",
      text: "Same here. Our CTO signed off on the Valkey / OpenTofu transition ticket this morning. Never building on single-vendor open core again.",
      timestamp: "2024-03-21T15:10:00Z",
      score: 610,
      aspects: { migration: 0.95, trust: -0.9 },
    },
  ],
};

export class RedditAdapter implements DiscourseAdapter {
  readonly platform = "reddit" as const;

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

    // Check if already normalized DiscourseThread
    const maybeThread = raw as Partial<DiscourseThread>;
    if (maybeThread.platform === "reddit" && Array.isArray(maybeThread.posts)) {
      return validateDiscourseThread(raw);
    }

    // Parse Reddit JSON listing: [Listing(post), Listing(comments)]
    if (Array.isArray(raw) && raw.length >= 2) {
      const postListing = raw[0]?.data?.children?.[0]?.data;
      if (postListing) {
        const threadId = postListing.id
          ? `reddit_${postListing.id}`
          : "reddit_thread";
        const title = String(postListing.title || "Reddit Thread");
        const author = String(postListing.author || "reddit_user");
        const permalink =
          postListing.permalink ||
          `/r/${postListing.subreddit || "devops"}/comments/${postListing.id}`;
        const url = `reddit.com${permalink}`;
        const upvotes = Number(postListing.ups ?? postListing.score ?? 0);
        const comments = Number(postListing.num_comments ?? 0);
        const timestamp = postListing.created_utc
          ? new Date(postListing.created_utc * 1000).toISOString()
          : new Date().toISOString();

        const posts: DiscoursePost[] = [
          {
            postId: `p_${postListing.id || "root"}`,
            author,
            text: String(postListing.selftext || title),
            timestamp,
            score: upvotes,
            aspects: { general: upvotes >= 0 ? 0.2 : -0.5 },
          },
        ];

        // Traverse comments
        const commentListing = raw[1]?.data?.children;
        if (Array.isArray(commentListing)) {
          this.extractComments(commentListing, posts, posts[0].postId);
        }

        return validateDiscourseThread({
          platform: "reddit",
          threadId,
          title,
          author,
          url,
          timestamp,
          metrics: { upvotes, comments, shares: Math.round(comments * 0.3) },
          posts,
        });
      }
    }

    return this.getOfflineFixture("unknown");
  }

  private extractComments(
    children: Array<{ data?: Record<string, unknown> }>,
    posts: DiscoursePost[],
    parentId: string,
    depth = 0,
  ): void {
    if (depth > 25) return;
    for (const child of children) {
      const data = child.data;
      if (
        !data?.body ||
        data.body === "[deleted]" ||
        data.body === "[removed]"
      ) {
        continue;
      }
      const cId = `p_${data.id || String(posts.length + 1)}`;
      const cAuthor = String(data.author || "user");
      const cText = String(data.body);
      const cScore = Number(data.score ?? data.ups ?? 0);
      const cTs = data.created_utc
        ? new Date(Number(data.created_utc) * 1000).toISOString()
        : new Date().toISOString();

      posts.push({
        postId: cId,
        parentId,
        author: cAuthor,
        text: cText,
        timestamp: cTs,
        score: cScore,
        aspects: {
          legal:
            cText.toLowerCase().includes("legal") ||
            cText.toLowerCase().includes("license")
              ? -0.8
              : 0,
        },
      });

      if (data.replies && typeof data.replies === "object") {
        const replyChildren = (
          data.replies as {
            data?: { children?: Array<{ data?: Record<string, unknown> }> };
          }
        ).data?.children;
        if (Array.isArray(replyChildren)) {
          this.extractComments(replyChildren, posts, cId, depth + 1);
        }
      }
    }
  }

  getOfflineFixture(id = ""): DiscourseThread {
    if (
      id &&
      id !== REDDIT_DEFAULT_FIXTURE.threadId &&
      !id.includes("xyz123")
    ) {
      return {
        ...REDDIT_DEFAULT_FIXTURE,
        threadId: id.startsWith("reddit_") ? id : `reddit_${id}`,
      };
    }
    return REDDIT_DEFAULT_FIXTURE;
  }
}
