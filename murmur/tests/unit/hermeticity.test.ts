/**
 * Hermeticity regression gate (unit-level).
 *
 * The discourse adapters are offline-fixture-only by design. This test is the
 * regression probe that would FAIL on the old live-network implementation:
 * it stubs `globalThis.fetch` to record calls (and throw), then drives every
 * adapter's fetchThread with the former tier-2/tier-3 option shapes. Under the
 * old code those paths selected live network and invoked fetch; under the
 * hermetic implementation fetch is never called and a valid fixture is always
 * returned.
 */
import { describe, expect, it } from "vitest";
import {
  GitHubAdapter,
  HackerNewsAdapter,
  RedditAdapter,
  TwitterAdapter,
  validateDiscourseThread,
} from "@murmur/engine";

describe("hermeticity: discourse adapters never touch the network", () => {
  const adapters = [
    new RedditAdapter(),
    new HackerNewsAdapter(),
    new TwitterAdapter(),
    new GitHubAdapter(),
  ];

  it("never calls globalThis.fetch — even under former tier-2/tier-3 options", async () => {
    let fetchCalls = 0;
    const origFetch = globalThis.fetch;
    const g = globalThis as unknown as Record<string, unknown>;
    g.fetch = (..._args: unknown[]) => {
      fetchCalls += 1;
      throw new TypeError("network disabled: fetch must never be called");
    };

    try {
      for (const adapter of adapters) {
        // Former tier-2/3 paths selected live network; options must be ignored.
        const tier2 = await adapter.fetchThread("some_thread_id_or_url", {
          tier: 2,
          timeoutMs: 50,
        } as never);
        const v2 = validateDiscourseThread(tier2);
        expect(v2.platform).toBe(adapter.platform);
        expect(v2.posts.length).toBeGreaterThan(0);

        const tier3 = await adapter.fetchThread("some_thread_id_or_url", {
          tier: 3,
          timeoutMs: 50,
        } as never);
        const v3 = validateDiscourseThread(tier3);
        expect(v3.platform).toBe(adapter.platform);
        expect(v3.posts.length).toBeGreaterThan(0);
      }
      expect(fetchCalls).toBe(0);
    } finally {
      g.fetch = origFetch;
    }
  });

  it("returns a valid fixture for every platform with plain calls", async () => {
    for (const adapter of adapters) {
      const thread = await adapter.fetchThread("default");
      const validated = validateDiscourseThread(thread);
      expect(validated.platform).toBe(adapter.platform);
      expect(validated.threadId.length).toBeGreaterThan(0);
      expect(validated.posts.length).toBeGreaterThan(0);
    }
  });
});
