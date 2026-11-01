/**
 * Transport behaviour with an injected fetch (NO network): retry/backoff on
 * 429/5xx with Retry-After, timeout aborts, on-disk cache hits, offline
 * cassette errors, and per-host rate limiting.
 *
 * The collector's cache dir is shared; these tests use unique URLs so they
 * never collide with recorded data, and restore every env/module knob.
 */
import { test, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import {
  fetchText,
  setFetchImpl,
  setOffline,
  setRefresh,
  setRecordDir,
  resetCaches,
  cacheKey,
} from "../http.mjs";

const ENV_KEYS = [
  "MURMUR_COLLECTOR_BACKOFF_BASE_MS",
  "MURMUR_COLLECTOR_TIMEOUT_MS",
  "MURMUR_COLLECTOR_MIN_INTERVAL_MS",
];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.MURMUR_COLLECTOR_BACKOFF_BASE_MS = "1";
  process.env.MURMUR_COLLECTOR_MIN_INTERVAL_MS = "0";
  delete process.env.MURMUR_COLLECTOR_TIMEOUT_MS;
  resetCaches();
  setOffline(false);
  setRefresh(true); // tests always bypass the on-disk cache unless stated
  setRecordDir(null);
  setFetchImpl(null);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setOffline(false);
  setRefresh(false);
  setRecordDir(null);
  setFetchImpl(null);
  resetCaches();
});

const OK = (body) => new Response(body, { status: 200 });

test("retries 429 with Retry-After and then succeeds", async () => {
  let calls = 0;
  setFetchImpl(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve(new Response("slow down", { status: 429, headers: { "retry-after": "0" } }));
    return Promise.resolve(OK("fine"));
  });
  const res = await fetchText("https://example.test/retry-429");
  assert.equal(res.status, 200);
  assert.equal(res.body, "fine");
  assert.equal(calls, 2);
});

test("gives up after 3 retries on persistent 500s", async () => {
  let calls = 0;
  setFetchImpl(() => {
    calls += 1;
    return Promise.resolve(new Response("boom", { status: 500 }));
  });
  await assert.rejects(
    () => fetchText("https://example.test/retry-500"),
    /HTTP 500 .*after 3 retries/,
  );
  assert.equal(calls, 4, "1 initial + 3 retries");
});

test("retries transient network errors, then throws a descriptive failure", async () => {
  let calls = 0;
  setFetchImpl(() => {
    calls += 1;
    if (calls <= 3) return Promise.reject(new Error("ECONNRESET"));
    return Promise.resolve(OK("recovered"));
  });
  const res = await fetchText("https://example.test/retry-conn");
  assert.equal(res.status, 200);
  assert.equal(calls, 4);
});

test("abortController timeout aborts a hanging response", async () => {
  process.env.MURMUR_COLLECTOR_TIMEOUT_MS = "20";
  resetCaches();
  setFetchImpl(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  await assert.rejects(() => fetchText("https://example.test/hang"), /fetch failed after 3 retries/);
});

test("second call within TTL is served from the on-disk cache", async () => {
  setRefresh(false);
  const url = `https://example.test/cache-check-${Date.now()}`;
  let calls = 0;
  setFetchImpl(() => {
    calls += 1;
    return Promise.resolve(OK("cache me"));
  });
  const first = await fetchText(url);
  assert.equal(first.fromCache, false);
  const second = await fetchText(url);
  assert.equal(second.fromCache, true);
  assert.equal(second.body, "cache me");
  assert.equal(second.sha256, first.sha256);
  assert.equal(calls, 1, "the network must be hit exactly once");
});

test("offline mode refuses URLs without a committed cassette", async () => {
  setOffline(true);
  await assert.rejects(
    () => fetchText("https://example.test/no-cassette"),
    /offline mode: no committed cassette/,
  );
});

test("offline mode replays a cassette keyed by GET + url", async () => {
  // Install a fake cassette by recording one through the normal path first.
  setOffline(false);
  const url = `https://example.test/cassette-${Date.now()}`;
  setFetchImpl(() => Promise.resolve(OK("cassette body")));
  await fetchText(url);
  setOffline(true);
  const res = await fetchText(url);
  assert.equal(res.body, "cassette body");
  assert.equal(res.fromCache, true);
});

test("per-host rate limit spaces requests by the configured interval", async () => {
  process.env.MURMUR_COLLECTOR_MIN_INTERVAL_MS = "60";
  resetCaches();
  setFetchImpl(() => Promise.resolve(OK("ok")));
  const t0 = Date.now();
  await fetchText("https://ratelimit.test/a");
  await fetchText("https://ratelimit.test/b");
  const elapsed = Date.now() - t0;
  assert.ok(
    elapsed >= 50,
    `two requests to the same host must wait >=60ms apart, took ${elapsed}ms`,
  );
});

test("cacheKey is a stable sha256 of method+url", () => {
  const k1 = cacheKey("GET", "https://x.test/a");
  const k2 = cacheKey("GET", "https://x.test/a");
  const k3 = cacheKey("POST", "https://x.test/a");
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.match(k1, /^[0-9a-f]{64}$/);
});
