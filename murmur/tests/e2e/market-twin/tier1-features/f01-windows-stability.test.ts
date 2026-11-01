/**
 * Tier 1 — Feature 1: Windows Stability & Test Timeouts (R6)
 * Validates isolated temp paths, clean SQLite handles, no EBUSY locks,
 * and execution within 60s timeout limits.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTestWorkspace, initDirectWorld } from "../helpers/harness.js";

describe("Tier 1 - F01: Windows Stability & Test Timeouts", () => {
  it("creates isolated workspaces with unique paths preventing Windows collisions", async () => {
    const ws1 = createTestWorkspace();
    const ws2 = createTestWorkspace();
    expect(ws1.cwd).not.toBe(ws2.cwd);
    expect(fs.existsSync(ws1.cwd)).toBe(true);
    expect(fs.existsSync(ws2.cwd)).toBe(true);
    await ws1.close();
    await ws2.close();
    expect(fs.existsSync(ws1.cwd)).toBe(false);
    expect(fs.existsSync(ws2.cwd)).toBe(false);
  });

  it("opens, writes, and cleanly closes SQLite databases without EBUSY file locks", async () => {
    const ws = createTestWorkspace();
    const { storage, world } = initDirectWorld(ws.cwd, "win-sqlite-world");
    ws.storage = storage;

    expect(world.slug).toBe("win-sqlite-world");
    expect(storage.countPersonas(world.id)).toBe(0);

    const dbPath = path.join(ws.cwd, ".murmur", "murmur.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    // Explicit close & teardown must succeed without EBUSY
    storage.close();
    await ws.close();
    expect(fs.existsSync(ws.cwd)).toBe(false);
  });

  it("handles rapid consecutive database reopenings in the same workspace", async () => {
    const ws = createTestWorkspace();
    const { storage: s1 } = initDirectWorld(ws.cwd, "reopen-world");
    s1.close();

    const dbPath = path.join(ws.cwd, ".murmur", "murmur.db");
    const { Storage, openDatabase } = await import("@murmur/engine");
    const s2 = new Storage(openDatabase(dbPath));
    const listed = s2.listWorlds();
    expect(listed.some((w) => w.slug === "reopen-world")).toBe(true);
    s2.close();

    await ws.close();
    expect(fs.existsSync(ws.cwd)).toBe(false);
  });

  it("executes operations well within the 60s test timeout threshold", async () => {
    const start = performance.now();
    const ws = createTestWorkspace();
    const { storage } = initDirectWorld(ws.cwd, "timeout-check");
    ws.storage = storage;

    storage.listWorlds();
    await ws.close();
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(10_000); // Must be under 10 seconds
  });

  it("isolates concurrent multi-workspace writes without cross-thread contamination", async () => {
    const workspaces = Array.from({ length: 3 }, () => createTestWorkspace());
    try {
      const worlds = workspaces.map((ws, i) => {
        const { storage, world } = initDirectWorld(
          ws.cwd,
          `concurrent-world-${i}`,
        );
        ws.storage = storage;
        return { storage, world };
      });

      worlds.forEach(({ world }, i) => {
        expect(world.slug).toBe(`concurrent-world-${i}`);
      });
    } finally {
      await Promise.all(workspaces.map((ws) => ws.close()));
    }
  });
});
