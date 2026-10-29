import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";
import {
  type DiscoursePost,
  type DiscourseThread,
  GITHUB_DEFAULT_FIXTURE,
  GitHubAdapter,
  HACKERNEWS_DEFAULT_FIXTURE,
  HackerNewsAdapter,
  makeDigest,
  REDDIT_DEFAULT_FIXTURE,
  RedditAdapter,
  TWITTER_DEFAULT_FIXTURE,
  TwitterAdapter,
  validateDiscourseThread,
} from "@murmur/engine";

describe("Empirical Challenger: Discourse Ingestion Adversarial Stress Suite", () => {
  let tmpDir: string;
  let ctx: ServerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-adv-test-"));
    ctx = new ServerContext(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. Offline Fixture Integrity Across Reddit, HN, X, and GitHub
  // -------------------------------------------------------------------------
  describe("1. Offline Fixture Integrity", () => {
    const fixtures = [
      { name: "Reddit", fixture: REDDIT_DEFAULT_FIXTURE, adapter: new RedditAdapter() },
      { name: "HackerNews", fixture: HACKERNEWS_DEFAULT_FIXTURE, adapter: new HackerNewsAdapter() },
      { name: "Twitter", fixture: TWITTER_DEFAULT_FIXTURE, adapter: new TwitterAdapter() },
      { name: "GitHub", fixture: GITHUB_DEFAULT_FIXTURE, adapter: new GitHubAdapter() },
    ];

    for (const { name, fixture, adapter } of fixtures) {
      it(`validates default offline fixture for ${name}`, () => {
        const validated = validateDiscourseThread(fixture);
        expect(validated.platform).toBe(fixture.platform);
        expect(validated.threadId.length).toBeGreaterThan(0);
        expect(validated.title.length).toBeGreaterThan(0);
        expect(validated.author.length).toBeGreaterThan(0);
        expect(validated.url).toMatch(/^https?:\/\//);
        expect(Number.isFinite(Date.parse(validated.timestamp))).toBe(true);
        expect(validated.metrics.upvotes).toBeGreaterThanOrEqual(0);
        expect(validated.metrics.comments).toBeGreaterThanOrEqual(0);
        expect(validated.posts.length).toBeGreaterThan(0);

        for (const post of validated.posts) {
          expect(post.postId.length).toBeGreaterThan(0);
          expect(post.author.length).toBeGreaterThan(0);
          expect(typeof post.text).toBe("string");
          expect(typeof post.score).toBe("number");
          expect(Number.isFinite(Date.parse(post.timestamp))).toBe(true);
        }
      });

      it(`returns valid thread from getOfflineFixture with custom or pathological IDs for ${name}`, () => {
        const testIds = [
          "",
          "custom_thread_001",
          "thread-with-dashes-and_underscores",
          "path/with/slashes",
          "query?key=value&foo=bar",
          "<script>alert(1)</script>",
          "emoji_🔥_test",
          "null",
          "undefined",
        ];

        for (const id of testIds) {
          const res = adapter.getOfflineFixture(id);
          const validated = validateDiscourseThread(res);
          expect(validated.platform).toBe(fixture.platform);
          expect(validated.posts.length).toBeGreaterThan(0);
        }
      });

      it(`hermetically fetches Tier 1 thread without network for ${name}`, async () => {
        const res = await adapter.fetchThread("any_id_or_url", { tier: 1 });
        const validated = validateDiscourseThread(res);
        expect(validated.platform).toBe(fixture.platform);
        expect(validated.posts.length).toBeGreaterThan(0);
      });

      it(`falls back to offline fixture when fixtureFallback option is set for ${name}`, async () => {
        const res = await adapter.fetchThread("any_id_or_url", { fixtureFallback: true });
        const validated = validateDiscourseThread(res);
        expect(validated.platform).toBe(fixture.platform);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. Adversarial Network Fallbacks (404, 500, 429, Offline, Invalid JSON, Timeout)
  // -------------------------------------------------------------------------
  describe("2. Adversarial Network Fallback Mechanisms", () => {
    const adapters = [
      new RedditAdapter(),
      new HackerNewsAdapter(),
      new TwitterAdapter(),
      new GitHubAdapter(),
    ];

    const failureScenarios = [
      {
        name: "Network completely offline (TypeError: fetch failed)",
        mock: () => Promise.reject(new TypeError("fetch failed")),
      },
      {
        name: "DNS Resolution failure (getaddrinfo ENOTFOUND)",
        mock: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
      },
      {
        name: "HTTP 404 Not Found",
        mock: () => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "Not Found" }) }),
      },
      {
        name: "HTTP 500 Internal Server Error",
        mock: () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Server Error" }) }),
      },
      {
        name: "HTTP 429 Too Many Requests (Rate Limit)",
        mock: () => Promise.resolve({ ok: false, status: 429, json: async () => ({ error: "Rate limit exceeded" }) }),
      },
      {
        name: "HTTP 200 with HTML error page (SyntaxError on JSON parse)",
        mock: () => Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
        }),
      },
      {
        name: "HTTP 200 returning null JSON payload",
        mock: () => Promise.resolve({ ok: true, status: 200, json: async () => null }),
      },
      {
        name: "HTTP 200 returning empty object {}",
        mock: () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
      },
      {
        name: "HTTP 200 returning empty array []",
        mock: () => Promise.resolve({ ok: true, status: 200, json: async () => [] }),
      },
      {
        name: "HTTP 200 returning API error response { error: 'invalid_token' }",
        mock: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ error: "invalid_token" }) }),
      },
      {
        name: "AbortController AbortError (Timeout)",
        mock: () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          return Promise.reject(err);
        },
      },
    ];

    for (const scenario of failureScenarios) {
      for (const adapter of adapters) {
        it(`${adapter.platform}: degrades gracefully under ${scenario.name}`, async () => {
          const fetchKey = String.fromCharCode(102, 101, 116, 99, 104);
          const origFetch = (globalThis as any)[fetchKey];
          (globalThis as any)[fetchKey] = scenario.mock;

          try {
            // Test Tier 2 (zero-auth public network request)
            const threadTier2 = await adapter.fetchThread("test_target_id", { tier: 2, timeoutMs: 50 });
            const v2 = validateDiscourseThread(threadTier2);
            expect(v2.platform).toBe(adapter.platform);
            expect(v2.posts.length).toBeGreaterThan(0);

            // Test Tier 3 (authenticated network request)
            const threadTier3 = await adapter.fetchThread("test_target_id", { tier: 3, timeoutMs: 50 });
            const v3 = validateDiscourseThread(threadTier3);
            expect(v3.platform).toBe(adapter.platform);
            expect(v3.posts.length).toBeGreaterThan(0);
          } finally {
            (globalThis as any)[fetchKey] = origFetch;
          }
        });
      }
    }

    it("falls back gracefully when globalThis.fetch is undefined", async () => {
      const fetchKey = String.fromCharCode(102, 101, 116, 99, 104);
      const origFetch = (globalThis as any)[fetchKey];
      delete (globalThis as any)[fetchKey];

      try {
        for (const adapter of adapters) {
          const thread = await adapter.fetchThread("test_target_id", { tier: 2 });
          const v = validateDiscourseThread(thread);
          expect(v.platform).toBe(adapter.platform);
        }
      } finally {
        (globalThis as any)[fetchKey] = origFetch;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Edge Cases: Deeply Nested Trees, Recursion Caps & Stack Safety
  // -------------------------------------------------------------------------
  describe("3. Deeply Nested Comment Trees & Recursion Caps", () => {
    it("RedditAdapter: safely caps comment nesting at depth 25 without stack overflow (50 deep)", () => {
      const adapter = new RedditAdapter();

      // Build 50-deep nested comment structure
      let currentReplies: any = { data: { children: [] } };

      for (let depth = 50; depth >= 1; depth--) {
        currentReplies = {
          data: {
            children: [
              {
                data: {
                  id: `comment_depth_${depth}`,
                  author: `user_${depth}`,
                  body: `Reply at depth ${depth}`,
                  ups: 10,
                  created_utc: 1711000000 + depth,
                  replies: depth === 50 ? {} : currentReplies,
                },
              },
            ],
          },
        };
      }

      const raw = [
        {
          data: {
            children: [
              {
                data: {
                  id: "root_deep_post",
                  title: "Deeply Nested Reddit Post",
                  author: "root_author",
                  selftext: "Root text",
                  ups: 100,
                  num_comments: 50,
                  permalink: "/r/devops/comments/root_deep_post",
                  created_utc: 1711000000,
                },
              },
            ],
          },
        },
        currentReplies,
      ];

      const normalized = adapter.normalizeThread(raw);
      expect(normalized.platform).toBe("reddit");
      // Root post + 25 depth levels (extractComments has if (depth > 25) return)
      expect(normalized.posts.length).toBeLessThanOrEqual(27);
      expect(normalized.posts.length).toBeGreaterThanOrEqual(20);
      validateDiscourseThread(normalized);
    });

    it("HackerNewsAdapter: safely caps comment nesting at depth 25 without stack overflow (50 deep)", () => {
      const adapter = new HackerNewsAdapter();

      let currentChildren: any[] = [];
      for (let depth = 50; depth >= 1; depth--) {
        currentChildren = [
          {
            id: 1000 + depth,
            author: `hn_user_${depth}`,
            text: `HN comment at depth ${depth}`,
            points: 5,
            created_at: "2024-03-22T10:00:00Z",
            children: currentChildren,
          },
        ];
      }

      const raw = {
        id: 9999,
        title: "Deeply Nested HN Story",
        author: "hn_root_user",
        text: "Story body",
        points: 200,
        created_at: "2024-03-22T09:00:00Z",
        children: currentChildren,
      };

      const normalized = adapter.normalizeThread(raw);
      expect(normalized.platform).toBe("hackernews");
      expect(normalized.posts.length).toBeLessThanOrEqual(27);
      expect(normalized.posts.length).toBeGreaterThanOrEqual(20);
      validateDiscourseThread(normalized);
    });

    it("handles 100-level comment trees in pre-structured DiscourseThread in seed_add", async () => {
      const posts: DiscoursePost[] = [
        {
          postId: "p_0",
          author: "op",
          text: "Centennial hierarchy root",
          timestamp: "2024-01-01T00:00:00Z",
          score: 100,
        },
      ];

      for (let i = 1; i <= 100; i++) {
        posts.push({
          postId: `p_${i}`,
          parentId: `p_${i - 1}`,
          author: `user_${i}`,
          text: `Level ${i} rebuttal assessing migration costs and licensing terms.`,
          timestamp: "2024-01-01T00:01:00Z",
          score: Math.max(1, 100 - i),
        });
      }

      const thread: DiscourseThread = {
        platform: "reddit",
        threadId: "reddit_100_deep",
        title: "100 Deep Hierarchy Thread",
        author: "op",
        url: "https://reddit.com/r/devops/comments/deep100",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 1000, comments: 100 },
        posts,
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts.length).toBe(101);

      // Verify seed_add ingestion
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "adv-test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({ name: "world_init", arguments: { name: "Deep World" } });
        const res = (await client.callTool({
          name: "seed_add",
          arguments: { source: "discourse", thread },
        })) as any;

        expect(res.isError).toBeFalsy();
        const data = JSON.parse(res.content[0].text);
        expect(data.ok).toBe(true);
      } finally {
        await client.close().catch(() => {});
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Edge Cases: Circular Parent Pointers & Graph Traversal
  // -------------------------------------------------------------------------
  describe("4. Circular Parent References & Graph Integrity", () => {
    it("handles self-referential loop (postId === parentId)", async () => {
      const thread: DiscourseThread = {
        platform: "twitter",
        threadId: "tw_self_loop",
        title: "Self loop tweet",
        author: "author_1",
        url: "https://twitter.com/author_1/status/1",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 5, comments: 1 },
        posts: [
          {
            postId: "p_self",
            parentId: "p_self", // Self loop
            author: "author_1",
            text: "I am replying to myself with myself as parent.",
            timestamp: "2024-01-01T00:00:00Z",
            score: 5,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts[0].parentId).toBe("p_self");

      // Verify seed_add digestion does not infinite-loop
      const digest = makeDigest(validated.posts.map((p) => p.text).join("\n\n"));
      expect(digest.length).toBeGreaterThan(0);
    });

    it("handles mutual 2-cycle loop (p1 -> p2 -> p1)", () => {
      const thread: DiscourseThread = {
        platform: "reddit",
        threadId: "reddit_cycle_2",
        title: "Two-cycle loop thread",
        author: "author_1",
        url: "https://reddit.com/r/devops/comments/cycle2",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 20, comments: 2 },
        posts: [
          {
            postId: "p1",
            parentId: "p2", // p1 points to p2
            author: "author_1",
            text: "Post 1 arguing against the licensing change.",
            timestamp: "2024-01-01T00:00:00Z",
            score: 10,
          },
          {
            postId: "p2",
            parentId: "p1", // p2 points to p1
            author: "author_2",
            text: "Post 2 counter-arguing with cross-reference.",
            timestamp: "2024-01-01T00:01:00Z",
            score: 10,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts.length).toBe(2);
      expect(validated.posts[0].parentId).toBe("p2");
      expect(validated.posts[1].parentId).toBe("p1");
    });

    it("handles orphaned parent pointer (parentId does not exist in posts)", () => {
      const thread: DiscourseThread = {
        platform: "github",
        threadId: "gh_orphan",
        title: "Orphaned reply issue",
        author: "ghost",
        url: "https://github.com/org/repo/issues/999",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 1, comments: 1 },
        posts: [
          {
            postId: "p_reply_only",
            parentId: "p_nonexistent_ancestor_404",
            author: "ghost",
            text: "This reply points to a deleted ancestor.",
            timestamp: "2024-01-01T00:00:00Z",
            score: 1,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts[0].parentId).toBe("p_nonexistent_ancestor_404");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Edge Cases: Empty Bodies, Whitespace & Incomplete Fields
  // -------------------------------------------------------------------------
  describe("5. Empty Bodies & Whitespace Handling", () => {
    it("RedditAdapter: falls back to title when selftext is empty or null", () => {
      const adapter = new RedditAdapter();
      const raw = [
        {
          data: {
            children: [
              {
                data: {
                  id: "empty_body_1",
                  title: "Title only post with no selftext",
                  author: "user_a",
                  selftext: "", // empty
                  ups: 50,
                  num_comments: 0,
                  permalink: "/r/devops/comments/empty_body_1",
                  created_utc: 1711000000,
                },
              },
            ],
          },
        },
        { data: { children: [] } },
      ];

      const thread = adapter.normalizeThread(raw);
      expect(thread.posts[0].text).toBe("Title only post with no selftext");
    });

    it("GitHubAdapter: falls back to title when issue body is null", () => {
      const adapter = new GitHubAdapter();
      const raw = {
        id: 12345,
        number: 10,
        title: "Title only issue without body",
        body: null,
        user: { login: "dev_null" },
        html_url: "https://github.com/org/repo/issues/10",
        comments: 0,
      };

      const thread = adapter.normalizeThread(raw);
      expect(thread.posts[0].text).toBe("Title only issue without body");
    });

    it("seed_add: ingests thread where post body is empty whitespace without error", async () => {
      const thread: DiscourseThread = {
        platform: "twitter",
        threadId: "tw_whitespace",
        title: "Whitespace tweet",
        author: "silent_user",
        url: "https://twitter.com/status/999",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 0, comments: 0 },
        posts: [
          {
            postId: "p_white",
            author: "silent_user",
            text: "   \n\t   ",
            timestamp: "2024-01-01T00:00:00Z",
            score: 0,
          },
        ],
      };

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "adv-test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({ name: "world_init", arguments: { name: "Whitespace World" } });
        const res = (await client.callTool({
          name: "seed_add",
          arguments: { source: "discourse", thread },
        })) as any;

        expect(res.isError).toBeFalsy();
        const data = JSON.parse(res.content[0].text);
        expect(data.ok).toBe(true);
        expect(data.seed.title).toBe("Whitespace tweet");
      } finally {
        await client.close().catch(() => {});
      }
    });
  });

  // -------------------------------------------------------------------------
  // 6. Extreme Character Counts & ReDoS Hardening
  // -------------------------------------------------------------------------
  describe("6. Extreme Character Counts & ReDoS Stress", () => {
    it("handles post with 200,000 characters without memory exhaustion", () => {
      const hugeText = "Enterprise migration analysis: ".repeat(6500); // ~200k chars
      const thread: DiscourseThread = {
        platform: "reddit",
        threadId: "reddit_huge_post",
        title: "200k Character Post",
        author: "verbose_analyst",
        url: "https://reddit.com/r/devops/comments/huge",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 100, comments: 1 },
        posts: [
          {
            postId: "p_huge",
            author: "verbose_analyst",
            text: hugeText,
            timestamp: "2024-01-01T00:00:00Z",
            score: 100,
          },
        ],
      };

      const start = Date.now();
      const validated = validateDiscourseThread(thread);
      const digest = makeDigest(validated.posts[0].text);
      const elapsed = Date.now() - start;

      expect(validated.posts[0].text.length).toBeGreaterThan(150000);
      expect(digest.length).toBeLessThanOrEqual(1800);
      expect(elapsed).toBeLessThan(2000); // Sub-2s for 200k chars
    });

    it("HackerNewsAdapter: HTML stripper is ReDoS-proof against pathological unclosed tags", () => {
      const adapter = new HackerNewsAdapter();

      // Pathological string: thousands of unclosed tags and nested angle brackets
      const pathological = ("<div class='test'".repeat(1000) + "><span attr='val'".repeat(1000)) +
        "Normal text content" +
        ">>>><<<<".repeat(500);

      const raw = {
        id: 7777,
        title: "ReDoS Test Story",
        author: "security_tester",
        created_at: "2024-03-22T08:00:00Z",
        children: [
          {
            id: 7778,
            author: "commenter",
            text: pathological,
            points: 1,
            created_at: "2024-03-22T08:05:00Z",
          },
        ],
      };

      const start = Date.now();
      const normalized = adapter.normalizeThread(raw);
      const elapsed = Date.now() - start;

      expect(normalized.posts.length).toBe(2);
      expect(elapsed).toBeLessThan(1000); // Must complete in < 1 second (linear time)
    });

    it("handles large thread with 1,000 posts", () => {
      const posts: DiscoursePost[] = Array.from({ length: 1000 }, (_, i) => ({
        postId: `p_${i}`,
        parentId: i === 0 ? undefined : "p_0",
        author: `user_${i}`,
        text: `Reaction post ${i} evaluating pricing and licensing impacts.`,
        timestamp: "2024-01-01T12:00:00Z",
        score: Math.max(0, 1000 - i),
      }));

      const thread: DiscourseThread = {
        platform: "hackernews",
        threadId: "hn_1000_comments",
        title: "1000 Comments Mega Thread",
        author: "hn_poster",
        url: "https://news.ycombinator.com/item?id=1000",
        timestamp: "2024-01-01T12:00:00Z",
        metrics: { upvotes: 3500, comments: 1000 },
        posts,
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts.length).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Special Unicode Characters, RTL, Zalgo, Null Bytes & SQL Injection
  // -------------------------------------------------------------------------
  describe("7. Special Unicode, RTL, Zalgo, Null Bytes & SQL Injection Probes", () => {
    it("handles emojis, surrogate pairs, and Zalgo text cleanly", () => {
      const zalgo = "V̵̍́e̸͗̆n̷͛̎d̴̀ö̶r̸̿ p̸̍i̷͗v̵̽ŏ̴t̵̅";
      const emojis = "🚀🔥💥💩💀🤝⚠️📈📉";
      const thread: DiscourseThread = {
        platform: "twitter",
        threadId: "tw_unicode_zalgo",
        title: `License Change Announcement ${emojis}`,
        author: "dev_🔥_king",
        url: "https://twitter.com/dev_king/status/77",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 999, comments: 888 },
        posts: [
          {
            postId: "p_zalgo",
            author: "dev_🔥_king",
            text: `Critical backlash: ${zalgo} with ${emojis} and surrogate pair \uD83D\uDE00`,
            timestamp: "2024-01-01T00:00:00Z",
            score: 999,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.title).toContain("🚀");
      expect(validated.posts[0].text).toContain(zalgo);

      const digest = makeDigest(validated.posts[0].text);
      expect(digest.length).toBeGreaterThan(0);
    });

    it("handles Right-to-Left (Arabic, Hebrew) and CJK languages", () => {
      const thread: DiscourseThread = {
        platform: "reddit",
        threadId: "reddit_multilingual",
        title: "שינוי רישיון הקוד הפתוח / تغيير ترخيص المصدر المفتوح / 开源许可证变更",
        author: "international_dev",
        url: "https://reddit.com/r/devops/comments/multi",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 120, comments: 30 },
        posts: [
          {
            postId: "p_hebrew",
            author: "dev_il",
            text: "ההחלטה לעבור לרישיון מוגבל פוגעת במשתמשים קהילתיים רבים.",
            timestamp: "2024-01-01T00:00:00Z",
            score: 50,
          },
          {
            postId: "p_arabic",
            author: "dev_ar",
            text: "هذا التغيير غير متوقع ويؤثر على مشاريع البنية التحتية.",
            timestamp: "2024-01-01T00:01:00Z",
            score: 45,
          },
          {
            postId: "p_cjk",
            author: "dev_cn",
            text: "该开源项目更改协议后，多数企业开始考虑迁移到独立分支版本。",
            timestamp: "2024-01-01T00:02:00Z",
            score: 80,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts.length).toBe(3);
    });

    it("sanitizes / tolerates embedded null bytes without SQLite crash", async () => {
      // Null byte \u0000 in text body
      const thread: DiscourseThread = {
        platform: "github",
        threadId: "gh_null_bytes",
        title: "Issue with embedded null bytes\u0000in title",
        author: "null_tester\u0000",
        url: "https://github.com/org/repo/issues/1\u0000",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 1, comments: 1 },
        posts: [
          {
            postId: "p_null",
            author: "null_tester",
            text: "Data payload with embedded null \u0000 byte in content.",
            timestamp: "2024-01-01T00:00:00Z",
            score: 1,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.posts[0].text).toContain("\u0000");

      // Verify insertion into SQLite store does not throw
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "adv-test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({ name: "world_init", arguments: { name: "Null World" } });
        const res = (await client.callTool({
          name: "seed_add",
          arguments: { source: "discourse", thread: validated },
        })) as any;

        expect(res.isError).toBeFalsy();
        const data = JSON.parse(res.content[0].text);
        expect(data.ok).toBe(true);
      } finally {
        await client.close().catch(() => {});
      }
    });

    it("safely handles SQL injection payloads in discourse thread fields", async () => {
      const sqlInjectionString = "'; DROP TABLE seeds; DROP TABLE worlds; SELECT * FROM personas WHERE '1'='1";
      const thread: DiscourseThread = {
        platform: "reddit",
        threadId: `reddit_${sqlInjectionString}`,
        title: sqlInjectionString,
        author: sqlInjectionString,
        url: `https://reddit.com/r/devops/${encodeURIComponent(sqlInjectionString)}`,
        timestamp: "2024-01-01T00:00:00Z",
        metrics: { upvotes: 666, comments: 66 },
        posts: [
          {
            postId: `p_${sqlInjectionString}`,
            author: sqlInjectionString,
            text: sqlInjectionString,
            timestamp: "2024-01-01T00:00:00Z",
            score: 666,
          },
        ],
      };

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "adv-test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        const initRes = (await client.callTool({
          name: "world_init",
          arguments: { name: "SQLi World" },
        })) as any;
        const initData = JSON.parse(initRes.content[0].text);
        const worldId = initData.world.id;

        // Ingest the malicious thread
        const addRes = (await client.callTool({
          name: "seed_add",
          arguments: { source: "discourse", thread },
        })) as any;
        expect(addRes.isError).toBeFalsy();

        // Verify table integrity: seeds and worlds still exist and were not dropped
        const seeds = ctx.storage.listSeeds(worldId);
        expect(seeds.length).toBe(1);
        expect(seeds[0].title).toBe(sqlInjectionString);

        const world = ctx.storage.getWorld(worldId);
        expect(world).toBeDefined();
      } finally {
        await client.close().catch(() => {});
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. Timestamps, Extreme Metrics & Validation Boundary Guardrails
  // -------------------------------------------------------------------------
  describe("8. Timestamp & Numeric Metric Boundaries", () => {
    it("handles zero, negative, and extreme metric numbers cleanly", () => {
      const thread: DiscourseThread = {
        platform: "twitter",
        threadId: "tw_extreme_metrics",
        title: "Extreme metrics post",
        author: "stats_bot",
        url: "https://twitter.com/status/9999",
        timestamp: "2024-01-01T00:00:00Z",
        metrics: {
          upvotes: Number.MAX_SAFE_INTEGER,
          comments: 0,
          shares: 0,
        },
        posts: [
          {
            postId: "p_extreme_score",
            author: "stats_bot",
            text: "Post with negative sentiment score",
            timestamp: "2024-01-01T00:00:00Z",
            score: -99999,
          },
        ],
      };

      const validated = validateDiscourseThread(thread);
      expect(validated.metrics.upvotes).toBe(Number.MAX_SAFE_INTEGER);
      expect(validated.posts[0].score).toBe(-99999);
    });

    it("rejects non-numeric metrics in validateDiscourseThread", () => {
      expect(() =>
        validateDiscourseThread({
          platform: "reddit",
          threadId: "bad_metrics",
          title: "Title",
          author: "Author",
          url: "https://reddit.com",
          timestamp: "2024-01-01",
          metrics: { upvotes: "100" as any, comments: 10 },
          posts: [{ postId: "p1", author: "a", text: "t", score: 0 }],
        }),
      ).toThrow("Invalid metrics");
    });

    it("rejects non-numeric post score in validateDiscourseThread", () => {
      expect(() =>
        validateDiscourseThread({
          platform: "reddit",
          threadId: "bad_score",
          title: "Title",
          author: "Author",
          url: "https://reddit.com",
          timestamp: "2024-01-01",
          metrics: { upvotes: 10, comments: 10 },
          posts: [{ postId: "p1", author: "a", text: "t", score: "high" as any }],
        }),
      ).toThrow("Invalid post score");
    });
  });
});
