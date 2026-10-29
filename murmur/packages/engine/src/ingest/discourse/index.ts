/**
 * Discourse Ingestion Subsystem (Feature 4, R1)
 */

export * from "./types.js";
export * from "./reddit.js";
export * from "./hackernews.js";
export * from "./twitter.js";
export * from "./github.js";

import type { DiscourseAdapter } from "./types.js";
import { RedditAdapter } from "./reddit.js";
import { HackerNewsAdapter } from "./hackernews.js";
import { TwitterAdapter } from "./twitter.js";
import { GitHubAdapter } from "./github.js";

export function getDiscourseAdapter(platform: "reddit" | "hackernews" | "twitter" | "github"): DiscourseAdapter {
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
      throw new Error(`Unsupported discourse platform: ${platform}`);
  }
}
