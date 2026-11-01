/**
 * Validator edge cases: engine-mirroring rules, provenance requirements,
 * timestamp sanity, depth cap and dedupe behaviour.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  validateThread,
  validateAndNormalize,
  applyDepthCap,
  dedupeThreads,
  timestampOk,
  is64Hex,
  MAX_DEPTH,
} from "../validate.mjs";

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

function goodThread(overrides = {}) {
  return {
    platform: "bluesky",
    threadId: "at://did:plc:abc/app.bsky.feed.post/123",
    title: "A thread about licensing",
    author: "example.bsky.social",
    url: "https://bsky.app/profile/example.bsky.social/post/123",
    timestamp: "2026-10-01T12:00:00.000Z",
    metrics: { upvotes: 3, comments: 1 },
    posts: [
      { postId: "p1", author: "example.bsky.social", text: "root post", timestamp: "2026-10-01T12:00:00.000Z", score: 3 },
      { postId: "p2", parentId: "p1", author: "other.bsky.social", text: "a reply", timestamp: "2026-10-01T13:00:00.000Z", score: 0 },
    ],
    provenance: { retrievedAt: "2026-11-01T00:00:00.000Z", contentSha256: SHA, via: "bluesky" },
    ...overrides,
  };
}

test("accepts a fully valid thread", () => {
  const res = validateThread(goodThread());
  assert.equal(res.ok, true);
  assert.deepEqual(res.reasons, []);
});

test("rejects every engine-invalid shape with a stable reason", () => {
  const cases = [
    [null, ["not-an-object"]],
    ["string", ["not-an-object"]],
    [{ ...goodThread(), platform: "myspace" }, ["platform:\"myspace\""]],
    [{ ...goodThread(), threadId: "" }, ["missing-threadId"]],
    [{ ...goodThread(), title: 42 }, ["missing-title"]],
    [{ ...goodThread(), author: null }, ["missing-author"]],
    [{ ...goodThread(), url: "" }, ["missing-url"]],
    [{ ...goodThread(), timestamp: 5 }, ["missing-timestamp"]],
    [{ ...goodThread(), metrics: { upvotes: "1", comments: 1 } }, ["invalid-metrics"]],
    [{ ...goodThread(), posts: [] }, ["empty-posts"]],
    [
      { ...goodThread(), posts: [{ author: "x", text: "t", score: 1 }] },
      ["posts[0]:invalid-postId"],
    ],
    [
      { ...goodThread(), posts: [{ postId: "p1", author: "x", text: null, score: 1 }] },
      ["posts[0]:invalid-text"],
    ],
    [
      { ...goodThread(), posts: [{ postId: "p1", author: "x", text: "t", score: "1" }] },
      ["posts[0]:invalid-score"],
    ],
  ];
  for (const [input, expected] of cases) {
    const res = validateThread(input);
    assert.equal(res.ok, false, JSON.stringify(expected));
    for (const reason of expected) {
      assert.ok(res.reasons.includes(reason), `expected reason ${reason}, got ${res.reasons}`);
    }
  }
});

test("provenance is required and shape-checked", () => {
  const missing = validateThread(goodThread({ provenance: undefined }));
  assert.equal(missing.ok, false);
  assert.ok(missing.reasons.includes("missing-provenance"));

  const badSha = validateThread(
    goodThread({ provenance: { retrievedAt: "2026-11-01T00:00:00.000Z", contentSha256: "not-hex" } }),
  );
  assert.ok(badSha.reasons.includes("invalid-provenance-contentSha256"));

  const badDate = validateThread(
    goodThread({ provenance: { retrievedAt: "not-a-date", contentSha256: SHA } }),
  );
  assert.ok(badDate.reasons.includes("invalid-provenance-retrievedAt"));

  assert.equal(is64Hex(SHA), true);
  assert.equal(is64Hex("A".repeat(64)), false, "uppercase is not canonical hex");
});

test("timestamps must be parseable, not future, not pre-2005", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");
  assert.equal(timestampOk("2026-10-01T00:00:00.000Z", now).ok, true);
  assert.equal(timestampOk("not a date", now).reason, "unparseable");
  assert.equal(timestampOk("2026-12-01T00:00:00.000Z", now).reason, "future");
  assert.equal(timestampOk("1999-01-01T00:00:00.000Z", now).reason, "pre-2005");
  const future = validateThread(goodThread({ timestamp: "2027-01-01T00:00:00.000Z" }), { now });
  assert.ok(future.reasons.includes("timestamp-future"));
});

function chain(n) {
  const posts = [];
  for (let i = 0; i < n; i++) {
    posts.push({
      postId: `p${i}`,
      ...(i > 0 ? { parentId: `p${i - 1}` } : {}),
      author: "x",
      text: `level ${i}`,
      timestamp: "2026-10-01T00:00:00.000Z",
      score: 0,
    });
  }
  return posts;
}

test("depth cap drops posts deeper than MAX_DEPTH and keeps the chain prefix", () => {
  assert.ok(MAX_DEPTH === 20);
  const t = goodThread({ posts: chain(MAX_DEPTH + 5) });
  const capped = applyDepthCap(t);
  assert.equal(capped.dropped, 5);
  assert.equal(capped.thread.posts.length, MAX_DEPTH);
  const res = validateAndNormalize(t);
  assert.equal(res.ok, true);
  assert.equal(res.droppedDepth, 5);
  assert.ok(res.reasons.some((r) => r.startsWith("depth_capped:")));
});

test("a parentId cycle does not hang the depth walk and keeps depth finite", () => {
  const posts = chain(4);
  // p3 -> p1 closes a cycle; the walk must terminate and keep every post.
  posts[3].parentId = "p1";
  const capped = applyDepthCap(goodThread({ posts }));
  assert.equal(capped.dropped, 0);
  assert.equal(capped.thread.posts.length, 4);
  const res = validateAndNormalize(goodThread({ posts }));
  assert.equal(res.ok, true);
});

test("dedupe drops repeat fetches and edited threads, keeps distinct threads", () => {
  const a = goodThread();
  const sameSha = goodThread();
  const edited = goodThread({
    provenance: { retrievedAt: "2026-11-01T01:00:00.000Z", contentSha256: SHA2, via: "bluesky" },
  });
  const other = goodThread({ threadId: "at://did:plc:abc/app.bsky.feed.post/456" });

  const res = dedupeThreads([a, sameSha, edited, other]);
  assert.deepEqual(
    res.threads.map((t) => t.threadId),
    [a.threadId, other.threadId],
  );
  assert.deepEqual(res.dropped, [
    { reason: "duplicate-sha256", threadId: a.threadId },
    { reason: "duplicate-platform-threadId", threadId: a.threadId },
  ]);
});
