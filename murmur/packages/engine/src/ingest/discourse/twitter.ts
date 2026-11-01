/**
 * X / Twitter Discourse Adapter
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

export const TWITTER_DEFAULT_FIXTURE: DiscourseThread = {
  platform: "twitter",
  threadId: "tw_1701625487",
  title: "Runtime Fee Announcement Post",
  author: "UnityOfficial",
  url: "twitter.com/UnityOfficial/status/1701625487",
  timestamp: "2023-09-12T13:00:00Z",
  metrics: { upvotes: 2100, comments: 14500, shares: 9800 },
  posts: [
    {
      postId: "tw_root",
      author: "UnityOfficial",
      text: "We are introducing the Unity Runtime Fee. Games meeting revenue and install metrics will pay a small fee per install starting Jan 2024.",
      timestamp: "2023-09-12T13:00:00Z",
      score: -0.6,
      aspects: { pricing: -0.8 },
    },
    {
      postId: "tw_ratio_quote",
      parentId: "tw_root",
      author: "gamedev_kol",
      text: "Getting ratio'd into oblivion. A per-install fee is mathematically catastrophic for indie developers and impossible to track cleanly. Migrating our next title to Godot immediately. #BoycottUnity",
      timestamp: "2023-09-12T13:15:00Z",
      score: -0.95,
      aspects: { ratio: 0.95, migration: 0.9, trust: -1.0 },
    },
  ],
};

export class TwitterAdapter implements DiscourseAdapter {
  readonly platform = "twitter" as const;

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
    if (maybeThread.platform === "twitter" && Array.isArray(maybeThread.posts)) {
      return validateDiscourseThread(raw);
    }

    const tweet = raw as Record<string, unknown>;
    if (tweet.id_str || tweet.id || tweet.text) {
      const threadId = tweet.id_str ? `tw_${tweet.id_str}` : `tw_${tweet.id || "tweet"}`;
      const user = (tweet.user as Record<string, unknown>) || {};
      const author = String(user.screen_name || tweet.username || "twitter_user");
      const title = String(tweet.text || "Tweet").slice(0, 80);
      const url = `twitter.com/${author}/status/${tweet.id_str || tweet.id || "0"}`;
      const upvotes = Number(tweet.favorite_count ?? tweet.likes ?? 0);
      const comments = Number(tweet.reply_count ?? tweet.replies ?? 0);
      const shares = Number(tweet.retweet_count ?? tweet.retweets ?? 0);
      const timestamp = tweet.created_at ? new Date(String(tweet.created_at)).toISOString() : new Date().toISOString();

      const posts: DiscoursePost[] = [
        {
          postId: `tw_${tweet.id_str || tweet.id || "root"}`,
          author,
          text: String(tweet.text || ""),
          timestamp,
          score: upvotes,
        },
      ];

      return validateDiscourseThread({
        platform: "twitter",
        threadId,
        title,
        author,
        url,
        timestamp,
        metrics: { upvotes, comments, shares },
        posts,
      });
    }

    return this.getOfflineFixture("unknown");
  }

  getOfflineFixture(id = ""): DiscourseThread {
    if (id && id !== TWITTER_DEFAULT_FIXTURE.threadId && !id.includes("1701625487")) {
      return {
        ...TWITTER_DEFAULT_FIXTURE,
        threadId: id.startsWith("tw_") ? id : `tw_${id}`,
      };
    }
    return TWITTER_DEFAULT_FIXTURE;
  }
}
