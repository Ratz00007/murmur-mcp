import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";
import {
  type DiscoursePost,
  type DiscourseThread,
  getDiscourseAdapter,
  GitHubAdapter,
  HackerNewsAdapter,
  RedditAdapter,
  TwitterAdapter,
  validateDiscourseThread,
} from "@murmur/engine";

describe("Discourse Ingestion Adapters (F04)", () => {
  describe("RedditAdapter", () => {
    it("returns offline fixture under Tier 1 without network", async () => {
      const adapter = new RedditAdapter();
      const thread = await adapter.fetchThread("reddit_devops_licensing_pivot", { tier: 1 });
      expect(thread.platform).toBe("reddit");
      expect(thread.metrics.upvotes).toBeGreaterThan(1000);
      expect(thread.posts.length).toBeGreaterThanOrEqual(3);

      const root = thread.posts.find((p) => !p.parentId);
      expect(root).toBeDefined();
      expect(root!.author).toBe("kube_wizard");

      const reply = thread.posts.find((p) => p.parentId === root!.postId);
      expect(reply).toBeDefined();
      expect(reply!.aspects?.legal).toBeDefined();
    });

    it("normalizes raw Reddit JSON listing into DiscourseThread", () => {
      const adapter = new RedditAdapter();
      const rawListing = [
        {
          data: {
            children: [
              {
                data: {
                  id: "abc1234",
                  title: "Reddit Pricing Thread",
                  author: "dev_author",
                  selftext: "Our team is reviewing the new pricing tier.",
                  ups: 520,
                  num_comments: 45,
                  permalink: "/r/devops/comments/abc1234/reddit_pricing_thread",
                  created_utc: 1711000000,
                },
              },
            ],
          },
        },
        {
          data: {
            children: [
              {
                data: {
                  id: "c1",
                  author: "commenter_1",
                  body: "The legal risks are too high.",
                  ups: 150,
                  created_utc: 1711001000,
                  replies: {
                    data: {
                      children: [
                        {
                          data: {
                            id: "c2",
                            author: "commenter_2",
                            body: "Agreed, we are moving to alternatives.",
                            ups: 45,
                            created_utc: 1711002000,
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      ];

      const normalized = adapter.normalizeThread(rawListing);
      expect(normalized.platform).toBe("reddit");
      expect(normalized.threadId).toBe("reddit_abc1234");
      expect(normalized.title).toBe("Reddit Pricing Thread");
      expect(normalized.metrics.upvotes).toBe(520);
      expect(normalized.posts.length).toBe(3);
      expect(normalized.posts[1].parentId).toBe("p_abc1234");
      expect(normalized.posts[2].parentId).toBe("p_c1");
    });
  });

  describe("HackerNewsAdapter", () => {
    it("returns offline fixture under Tier 1 without network", async () => {
      const adapter = new HackerNewsAdapter();
      const thread = await adapter.fetchThread("39785412", { tier: 1 });
      expect(thread.platform).toBe("hackernews");
      expect(thread.metrics.comments).toBe(842);
      expect(thread.url).toContain("news.ycombinator.com");

      const root = thread.posts[0];
      expect(root.text).toContain("betrayal of the community");
    });

    it("normalizes Algolia item tree into DiscourseThread", () => {
      const adapter = new HackerNewsAdapter();
      const algoliaItem = {
        id: 998877,
        title: "Algolia HN Test Story",
        author: "hn_user_1",
        points: 412,
        created_at: "2024-03-22T10:00:00Z",
        text: "Story body explaining fork rationale.",
        children: [
          {
            id: 998878,
            author: "replier_1",
            text: "<p>HTML escaped comment.</p>",
            points: 85,
            created_at: "2024-03-22T10:30:00Z",
            children: [
              {
                id: 998879,
                author: "replier_2",
                text: "Nested reply text.",
                points: 12,
                created_at: "2024-03-22T11:00:00Z",
              },
            ],
          },
        ],
      };

      const normalized = adapter.normalizeThread(algoliaItem);
      expect(normalized.platform).toBe("hackernews");
      expect(normalized.threadId).toBe("hn_998877");
      expect(normalized.posts.length).toBe(3);
      expect(normalized.posts[1].text).toBe("HTML escaped comment.");
      expect(normalized.posts[2].parentId).toBe("hn_998878");
    });
  });

  describe("TwitterAdapter", () => {
    it("returns offline fixture under Tier 1 with severe ratio metrics", async () => {
      const adapter = new TwitterAdapter();
      const thread = await adapter.fetchThread("1701625487", { tier: 1 });
      expect(thread.platform).toBe("twitter");
      expect(thread.metrics.comments).toBeGreaterThan(thread.metrics.upvotes); // Ratio
      expect(thread.posts.some((p) => p.author === "gamedev_kol")).toBe(true);
    });

    it("normalizes raw tweet object cleanly", () => {
      const adapter = new TwitterAdapter();
      const rawTweet = {
        id_str: "1234567890",
        text: "Announcement tweet regarding terms change",
        favorite_count: 50,
        reply_count: 850,
        retweet_count: 120,
        created_at: "Wed Oct 10 20:19:24 +0000 2023",
        user: { screen_name: "corp_official" },
      };

      const normalized = adapter.normalizeThread(rawTweet);
      expect(normalized.platform).toBe("twitter");
      expect(normalized.author).toBe("corp_official");
      expect(normalized.metrics.comments).toBe(850);
      expect(normalized.metrics.upvotes).toBe(50);
      expect(normalized.posts.length).toBe(1);
    });
  });

  describe("GitHubAdapter", () => {
    it("returns offline fixture under Tier 1 without network", async () => {
      const adapter = new GitHubAdapter();
      const thread = await adapter.fetchThread("4821", { tier: 1 });
      expect(thread.platform).toBe("github");
      expect(thread.url).toContain("github.com/docker");
      expect(thread.posts[0].text).toContain("namespace");
    });

    it("normalizes GitHub issue object into DiscourseThread", () => {
      const adapter = new GitHubAdapter();
      const rawIssue = {
        id: 8881,
        number: 42,
        title: "Docker namespace deprecation issue",
        body: "Namespace deletion causes widespread breakage.",
        user: { login: "maintainer_mark" },
        html_url: "https://github.com/org/repo/issues/42",
        comments: 120,
        reactions: { "+1": 450 },
        created_at: "2023-03-15T12:00:00Z",
      };

      const normalized = adapter.normalizeThread(rawIssue);
      expect(normalized.platform).toBe("github");
      expect(normalized.author).toBe("maintainer_mark");
      expect(normalized.metrics.upvotes).toBe(450);
      expect(normalized.metrics.comments).toBe(120);
    });
  });

  describe("getDiscourseAdapter factory", () => {
    it("returns correct adapter instances", () => {
      expect(getDiscourseAdapter("reddit")).toBeInstanceOf(RedditAdapter);
      expect(getDiscourseAdapter("hackernews")).toBeInstanceOf(HackerNewsAdapter);
      expect(getDiscourseAdapter("twitter")).toBeInstanceOf(TwitterAdapter);
      expect(getDiscourseAdapter("github")).toBeInstanceOf(GitHubAdapter);
    });

    it("throws on unsupported platforms", () => {
      expect(() => getDiscourseAdapter("mastodon" as unknown as "reddit")).toThrow(
        "Unsupported discourse platform",
      );
    });
  });

  describe("validateDiscourseThread boundary and error handling", () => {
    it("rejects non-object inputs", () => {
      expect(() => validateDiscourseThread(null)).toThrow("DiscourseThread must be an object");
      expect(() => validateDiscourseThread("string")).toThrow("DiscourseThread must be an object");
    });

    it("rejects invalid platforms", () => {
      expect(() => validateDiscourseThread({ platform: "discord" })).toThrow("Invalid platform");
    });

    it("rejects empty posts arrays", () => {
      expect(() =>
        validateDiscourseThread({
          platform: "reddit",
          threadId: "id1",
          title: "Title",
          author: "Author",
          url: "https://reddit.com",
          timestamp: "2024-01-01",
          metrics: { upvotes: 10, comments: 2 },
          posts: [],
        }),
      ).toThrow("DiscourseThread must have at least one post");
    });

    it("rejects post with invalid author or text", () => {
      expect(() =>
        validateDiscourseThread({
          platform: "reddit",
          threadId: "id1",
          title: "Title",
          author: "Author",
          url: "https://reddit.com",
          timestamp: "2024-01-01",
          metrics: { upvotes: 10, comments: 2 },
          posts: [{ postId: "p1", author: "", text: "valid text", score: 0 }],
        }),
      ).toThrow("Invalid post author");
    });

    it("accepts valid deeply nested threads without error", () => {
      const posts: DiscoursePost[] = [
        { postId: "p0", author: "root", text: "Root", score: 10, timestamp: "2024-01-01" },
      ];
      for (let i = 1; i <= 25; i++) {
        posts.push({
          postId: `p${i}`,
          parentId: `p${i - 1}`,
          author: `user_${i}`,
          text: `Reply depth ${i}`,
          score: 5,
          timestamp: "2024-01-01",
        });
      }
      const thread: DiscourseThread = {
        platform: "reddit",
        threadId: "deep_thread",
        title: "Deep Thread",
        author: "root",
        url: "https://reddit.com",
        timestamp: "2024-01-01",
        metrics: { upvotes: 100, comments: 25 },
        posts,
      };
      const validated = validateDiscourseThread(thread);
      expect(validated.posts.length).toBe(26);
    });
  });

  describe("seed_add MCP Tool Integration (source: 'discourse')", () => {
    it("ingests platform discourse thread via MCP server", async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-discourse-test-"));
      const ctx = new ServerContext(tmpDir);
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({
          name: "world_init",
          arguments: { name: "Discourse World" },
        });

        const res = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "discourse",
            platform: "reddit",
            threadId: "reddit_devops_licensing_pivot",
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        expect(res.isError).toBeFalsy();
        const data = JSON.parse(res.content![0].text!);
        expect(data.ok).toBe(true);
        expect(data.seed.title).toContain("Vendor switches to source-available");
        expect(data.seed.ref).toContain("reddit");
        expect(data.duplicate).toBe(false);

        // Deduplication
        const dupRes = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "discourse",
            platform: "reddit",
            threadId: "reddit_devops_licensing_pivot",
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        const dupData = JSON.parse(dupRes.content![0].text!);
        expect(dupData.duplicate).toBe(true);
      } finally {
        await client.close().catch(() => {});
        ctx.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("ingests custom structured discourse thread payload", async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-discourse-custom-"));
      const ctx = new ServerContext(tmpDir);
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({
          name: "world_init",
          arguments: { name: "Custom Discourse World" },
        });

        const customThread: DiscourseThread = {
          platform: "twitter",
          threadId: "tw_custom_100",
          title: "Custom Ratio Tweet",
          author: "tech_critic",
          url: "https://twitter.com/tech_critic/status/100",
          timestamp: "2024-01-01T12:00:00Z",
          metrics: { upvotes: 10, comments: 200, shares: 80 },
          posts: [
            {
              postId: "p_100",
              author: "tech_critic",
              text: "This price hike makes zero sense.",
              timestamp: "2024-01-01T12:00:00Z",
              score: 10,
            },
          ],
        };

        const res = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "discourse",
            thread: customThread,
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        expect(res.isError).toBeFalsy();
        const data = JSON.parse(res.content![0].text!);
        expect(data.ok).toBe(true);
        expect(data.seed.title).toBe("Custom Ratio Tweet");
        expect(data.seed.ref).toBe("https://twitter.com/tech_critic/status/100");
      } finally {
        await client.close().catch(() => {});
        ctx.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects discourse seed missing platform or thread data", async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-discourse-err-"));
      const ctx = new ServerContext(tmpDir);
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({
          name: "world_init",
          arguments: { name: "Err World" },
        });

        const res = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "discourse",
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        expect(res.isError).toBe(true);
        expect(res.content![0].text).toContain("requires platform + threadId");
      } finally {
        await client.close().catch(() => {});
        ctx.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
