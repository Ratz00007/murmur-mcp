/**
 * GitHub Issues Discourse Adapter
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

export const GITHUB_DEFAULT_FIXTURE: DiscourseThread = {
  platform: "github",
  threadId: "gh_docker_sunset_issue_4821",
  title: "Free Team organization deletion policy violates repository continuity",
  author: "oss_maintainer_alex",
  url: "github.com/docker/hub-feedback/issues/4821",
  timestamp: "2023-03-15T10:00:00Z",
  metrics: { upvotes: 3400, comments: 280 },
  posts: [
    {
      postId: "gh_root",
      author: "oss_maintainer_alex",
      text: "If you delete our free team org, anyone can claim our namespace and push trojaned images to millions of existing docker pull commands in production.",
      timestamp: "2023-03-15T10:00:00Z",
      score: 3400,
      aspects: { security: -1.0, supply_chain: -0.95 },
    },
  ],
};

export class GitHubAdapter implements DiscourseAdapter {
  readonly platform = "github" as const;

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
    if (maybeThread.platform === "github" && Array.isArray(maybeThread.posts)) {
      return validateDiscourseThread(raw);
    }

    const issue = raw as Record<string, unknown>;
    if (issue.title || issue.number) {
      const threadId = issue.number ? `gh_issue_${issue.number}` : "gh_issue";
      const title = String(issue.title || "GitHub Issue");
      const user = (issue.user as Record<string, unknown>) || {};
      const author = String(user.login || "github_user");
      const url = String(
        issue.html_url || "github.com/docker/hub-feedback/issues/4821",
      );
      const reactions = (issue.reactions as Record<string, unknown>) || {};
      const upvotes = Number(reactions["+1"] ?? issue.comments ?? 1);
      const comments = Number(issue.comments ?? 0);
      const timestamp = issue.created_at ? String(issue.created_at) : new Date().toISOString();

      const posts: DiscoursePost[] = [
        {
          postId: `gh_${issue.id || issue.number || "root"}`,
          author,
          text: String(issue.body || title),
          timestamp,
          score: upvotes,
          aspects: { security: -0.5 },
        },
      ];

      return validateDiscourseThread({
        platform: "github",
        threadId,
        title,
        author,
        url,
        timestamp,
        metrics: { upvotes, comments },
        posts,
      });
    }

    return this.getOfflineFixture("unknown");
  }

  getOfflineFixture(id = ""): DiscourseThread {
    if (id && id !== GITHUB_DEFAULT_FIXTURE.threadId && !id.includes("4821")) {
      return {
        ...GITHUB_DEFAULT_FIXTURE,
        threadId: id.startsWith("gh_") ? id : `gh_${id}`,
      };
    }
    return GITHUB_DEFAULT_FIXTURE;
  }
}
