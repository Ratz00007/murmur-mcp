/**
 * Tier 4 — Scenario 5: Cross-Platform Discourse Ingestion Calibration
 * Features: F4, F5, F6, F16
 * Ingests multi-platform developer discourse (Reddit, Hacker News)
 * into MCP world seeds with aspect-based entity attribution.
 */
import { describe, expect, it } from "vitest";
import {
  HACKERNEWS_ALGOLIA_THREAD,
  REDDIT_DEVOPS_THREAD,
} from "../helpers/fixtures.js";
import { validateDiscourseThread } from "../helpers/contracts.js";
import { createTestWorkspace, initDirectWorld } from "../helpers/harness.js";
import { entityMentions, makeDigest, scoreSentiment } from "@murmur/engine";
import type { Entity } from "@murmur/engine";

describe("Tier 4 - Scenario 5: Cross-Platform Discourse Ingestion Calibration", () => {
  const targetEntities: Entity[] = [
    {
      id: "e_vendor",
      worldId: "w_calib",
      name: "Vendor",
      type: "subject",
      description: "Cloud infra provider",
      salience: 0.9,
      anchors: ["vendor"],
      motives: ["monetization"],
    },
    {
      id: "e_valkey",
      worldId: "w_calib",
      name: "Valkey",
      type: "competitor",
      description: "Open source fork",
      salience: 0.8,
      anchors: ["valkey"],
      motives: ["open governance"],
    },
    {
      id: "e_opentofu",
      worldId: "w_calib",
      name: "OpenTofu",
      type: "competitor",
      description: "Open source Terraform fork",
      salience: 0.8,
      anchors: ["opentofu"],
      motives: ["neutral foundation"],
    },
  ];

  it("calibrates discourse threads across Reddit r/devops and Hacker News into MCP world seeds", async () => {
    // 1. Discourse Ingestion Validation
    const redditThread = validateDiscourseThread(REDDIT_DEVOPS_THREAD);
    const hnThread = validateDiscourseThread(HACKERNEWS_ALGOLIA_THREAD);

    expect(redditThread.platform).toBe("reddit");
    expect(hnThread.platform).toBe("hackernews");

    // 2. Aspect-Based Entity Attribution across Threads
    const redditText = redditThread.posts.map((p) => p.text).join(" ");
    const hnText = hnThread.posts.map((p) => p.text).join(" ");

    const redditMentions = entityMentions(redditText, targetEntities);
    const hnMentions = entityMentions(hnText, targetEntities);

    expect(redditMentions.some((m) => m.entityId === "e_opentofu" || m.entityId === "e_valkey")).toBe(true);
    expect(scoreSentiment(hnText).hits).toBeGreaterThan(0);

    // 3. World Seed Ingestion in Isolated Workspace
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(ws.cwd, "discourse-calibration-world");
    ws.storage = storage;

    const redditDigest = makeDigest(redditText);
    const hnDigest = makeDigest(hnText);

    const seed1 = storage.addSeed(world.id, {
      kind: "text",
      title: redditThread.title,
      ref: redditThread.url,
      text: redditText,
      digest: redditDigest,
    });

    const seed2 = storage.addSeed(world.id, {
      kind: "text",
      title: hnThread.title,
      ref: hnThread.url,
      text: hnText,
      digest: hnDigest,
    });

    expect(seed1.duplicate).toBe(false);
    expect(seed2.duplicate).toBe(false);

    // 4. Seeds Review
    const storedSeeds = storage.listSeeds(world.id);
    expect(storedSeeds.length).toBe(2);
    expect(storedSeeds.some((s) => s.ref.includes("reddit.com"))).toBe(true);
    expect(storedSeeds.some((s) => s.ref.includes("news.ycombinator.com"))).toBe(true);

    storage.close();
    await ws.close();
  });
});
