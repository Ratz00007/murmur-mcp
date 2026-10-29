/**
 * Tier 2 — Boundary 6: Seed Ingestion MCP Extensions Boundaries (R1, R6)
 * Tests empty seeds, MAX_SEED_BYTES enforcement, de-duplication,
 * and edge coverage stats.
 */
import { describe, expect, it } from "vitest";
import { coverageStats, makeDigest, MAX_SEED_BYTES } from "@murmur/engine";
import { createTestWorkspace, initDirectWorld } from "../helpers/harness.js";

describe("Tier 2 - B06: Seed Ingestion MCP Extensions Boundaries", () => {
  it("generates appropriate warning notes for zero seeds and empty seeds", () => {
    const noSeeds = coverageStats([]);
    expect(noSeeds.notes.some((n) => n.includes("No seeds yet"))).toBe(true);

    const allEmpty = coverageStats([0, 0, 0]);
    expect(allEmpty.notes.some((n) => n.includes("All seeds are empty"))).toBe(true);
  });

  it("generates warning when corpus exceeds the 50MB envelope", () => {
    const overLimit = coverageStats([30 * 1024 * 1024, 25 * 1024 * 1024]);
    expect(overLimit.totalBytes).toBeGreaterThan(MAX_SEED_BYTES);
    expect(overLimit.notes.some((n) => n.includes("exceeds"))).toBe(true);
  });

  it("de-duplicates identical seed payloads within the same world", async () => {
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(ws.cwd, "seed-dedup-world");
    ws.storage = storage;

    const content = "Unique corporate policy text for deduplication verification.";
    const digest = makeDigest(content);

    const first = storage.addSeed(world.id, {
      kind: "text",
      title: "Seed 1",
      ref: "text://dup-1",
      text: content,
      digest,
    });
    expect(first.duplicate).toBe(false);

    const second = storage.addSeed(world.id, {
      kind: "text",
      title: "Seed 2 (Duplicate)",
      ref: "text://dup-2",
      text: content,
      digest,
    });
    expect(second.duplicate).toBe(true);
    expect(second.seed.id).toBe(first.seed.id);

    const seeds = storage.listSeeds(world.id);
    expect(seeds.length).toBe(1); // Deduped

    storage.close();
    await ws.close();
  });

  it("digests short texts with lengths well below the maxChars cutoff", () => {
    const shortText = "Brief notice.";
    const digest = makeDigest(shortText, 1800);
    expect(digest).toBe(shortText);
  });

  it("truncates run-on text with no sentence punctuation cleanly", () => {
    const runOnText = "word ".repeat(500); // 2500 chars with no punctuation
    const digest = makeDigest(runOnText, 300);
    expect(digest.length).toBeLessThanOrEqual(300);
  });
});
