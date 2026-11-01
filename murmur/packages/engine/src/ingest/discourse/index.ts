/**
 * Discourse Ingestion Subsystem (Feature 4, R1)
 */

export * from "./types.js";
export * from "./reddit.js";
export * from "./hackernews.js";
export * from "./twitter.js";
export * from "./github.js";

import type { DiscourseAdapter, DiscoursePlatform } from "./types.js";
import { RedditAdapter } from "./reddit.js";
import { HackerNewsAdapter } from "./hackernews.js";
import { TwitterAdapter } from "./twitter.js";
import { GitHubAdapter } from "./github.js";

export function getDiscourseAdapter(platform: DiscoursePlatform): DiscourseAdapter {
  switch (platform) {
    case "reddit":
      return new RedditAdapter();
    case "hackernews":
      return new HackerNewsAdapter();
    case "twitter":
      return new TwitterAdapter();
    case "github":
      return new GitHubAdapter();
    default:
      throw new Error(
        `No live adapter for platform '${platform}' — collect it with tools/collector and ingest the structured thread via seed_add({source:'discourse', thread})`,
      );
  }
}
