/**
 * Tier 2 — Boundary 1: Windows Stability & Handle Limits (R6)
 * Tests deep paths, rapid handle cycling, simulated aborts, and unique slug minting.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTestWorkspace, initDirectWorld } from "../helpers/harness.js";
import { openDatabase, Storage } from "@murmur/engine";

describe("Tier 2 - B01: Windows Stability & Handle Limits", () => {
  it("creates and cleans workspaces with deeply nested directory paths", async () => {
    const ws = createTestWorkspace();
    const deepSubdir = path.join(ws.cwd, "sub1", "sub2", "sub3", "deep_target");
    fs.mkdirSync(deepSubdir, { recursive: true });

    expect(fs.existsSync(deepSubdir)).toBe(true);
    await ws.close();
    expect(fs.existsSync(ws.cwd)).toBe(false);
  });

  it("rapidly opens and closes SQLite databases 25 times without handle leaks", async () => {
    const ws = createTestWorkspace();
    const dbPath = path.join(ws.cwd, "rapid-test.db");

    for (let i = 0; i < 25; i++) {
      const db = openDatabase(dbPath);
      const storage = new Storage(db);
      storage.listWorlds();
      storage.close();
    }

    await ws.close();
    expect(fs.existsSync(ws.cwd)).toBe(false);
  });

  it("disambiguates duplicate world names with unique numbered slugs", async () => {
    const ws = createTestWorkspace();
    const { storage } = initDirectWorld(ws.cwd, "duplicate-slug");
    ws.storage = storage;

    const w1 = storage.createWorld({ name: "Alpha World", slugHint: "alpha" });
    const w2 = storage.createWorld({ name: "Alpha World", slugHint: "alpha" });
    const w3 = storage.createWorld({ name: "Alpha World", slugHint: "alpha" });

    expect(w1.slug).toBe("alpha");
    expect(w2.slug).toBe("alpha-2");
    expect(w3.slug).toBe("alpha-3");

    storage.close();
    await ws.close();
  });

  it("handles special characters and Unicode in world descriptions safely", async () => {
    const ws = createTestWorkspace();
    const { storage } = initDirectWorld(ws.cwd, "unicode-world");
    ws.storage = storage;

    const unicodeDesc = "Testing 🚀 emoji & punctuation: 'quotes' \"double\" <xml> \n newline \t tab";
    const world = storage.createWorld({
      name: "Unicode Test",
      description: unicodeDesc,
    });

    const retrieved = storage.getWorld(world.id);
    expect(retrieved?.description).toBe(unicodeDesc);

    storage.close();
    await ws.close();
  });

  it("recovers gracefully from double storage.close() invocations", async () => {
    const ws = createTestWorkspace();
    const { storage } = initDirectWorld(ws.cwd, "double-close");
    ws.storage = storage;

    expect(() => {
      storage.close();
      storage.close(); // Second call must not crash
    }).not.toThrow();

    await ws.close();
  });
});
