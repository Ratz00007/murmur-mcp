/**
 * Tier 1 — Feature 6: Seed Ingestion MCP Extensions (R1, R6)
 * Validates text seed ingestion, size limits, sentence digest generation,
 * corpus seed grounding, and seeds review.
 */
import { describe, expect, it } from "vitest";
import { coverageStats, makeDigest, MAX_SEED_BYTES } from "@murmur/engine";
import { createTestWorkspace, initDirectWorld } from "../helpers/harness.js";
import { UNITY_2023_CASE } from "../helpers/fixtures.js";

describe("Tier 1 - F06: Seed Ingestion MCP Extensions", () => {
  it("enforces MAX_SEED_BYTES limit to prevent memory blowout", () => {
    expect(MAX_SEED_BYTES).toBe(50 * 1024 * 1024); // 50MB
  });

  it("extracts extractive sentence digests from discourse announcements", () => {
    const announcement = `
      Today we are introducing a new pricing tier.
      Beginning next month, developers who cross $200,000 in revenue will be subject to a fee.
      The fee is calculated based on each qualifying game install.
      We believe this model aligns our business with developers' success.
      Feedback from the community will be reviewed carefully.
    `;
    const digest = makeDigest(announcement, 200);
    expect(typeof digest).toBe("string");
    expect(digest.length).toBeGreaterThan(0);
    expect(digest.length).toBeLessThanOrEqual(200);
  });

  it("stores text seeds in the world database with clean provenance", async () => {
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(ws.cwd, "seed-storage-world");
    ws.storage = storage;

    const digest = makeDigest(UNITY_2023_CASE.policySummary);
    const { seed, duplicate } = storage.addSeed(world.id, {
      kind: "text",
      title: "Unity Runtime Fee Announcement",
      ref: "text://unity-announcement",
      text: UNITY_2023_CASE.policySummary,
      digest,
    });

    expect(seed.id).toBeDefined();
    expect(seed.kind).toBe("text");
    expect(seed.title).toContain("Unity Runtime Fee");
    expect(duplicate).toBe(false);

    const seeds = storage.listSeeds(world.id);
    expect(seeds.length).toBe(1);
    expect(seeds[0].id).toBe(seed.id);

    storage.close();
    await ws.close();
  });

  it("stores historical corpus cases as grounded seeds with structured metadata", async () => {
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(ws.cwd, "corpus-seed-world");
    ws.storage = storage;

    const corpusPayload = JSON.stringify(UNITY_2023_CASE);
    const { seed } = storage.addSeed(world.id, {
      kind: "text",
      title: UNITY_2023_CASE.title,
      ref: `corpus://${UNITY_2023_CASE.id}`,
      text: corpusPayload,
      digest: UNITY_2023_CASE.policySummary,
    });

    expect(seed.ref).toContain("corpus://unity-runtime-fee-2023");
    const retrieved = storage.listSeeds(world.id);
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].title).toBe(UNITY_2023_CASE.title);
    expect(retrieved[0].digest).toContain(UNITY_2023_CASE.policySummary.slice(0, 50));

    storage.close();
    await ws.close();
  });

  it("computes coverage statistics across varied seed sources", async () => {
    // Under 2KB to trigger small corpus note
    const smallSizes = [500, 300];
    const stats = coverageStats(smallSizes);
    expect(stats.seeds).toBe(2);
    expect(stats.totalBytes).toBe(800);
    expect(stats.largest).toBe(500);
    expect(stats.notes.length).toBeGreaterThan(0);
    expect(stats.notes[0]).toContain("Small corpus");
  });
});
