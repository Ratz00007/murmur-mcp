/**
 * Test Harness for Market Twin E2E Testing.
 * Provides isolated workspaces, Windows file-lock safe cleanups,
 * MCP client spawning, and direct engine world management.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as engine from "@murmur/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = path.resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "server",
  "dist",
  "index.js",
);

export interface TestWorkspace {
  cwd: string;
  storage?: engine.Storage;
  close: () => Promise<void>;
}

export function createTestWorkspace(): TestWorkspace {
  // Use crypto random ID to prevent collisions on Windows
  const uniqueId = `murmur-mt-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const cwd = path.join(os.tmpdir(), uniqueId);
  fs.mkdirSync(cwd, { recursive: true });

  let closed = false;
  const ws: TestWorkspace = {
    cwd,
    close: async () => {
      if (closed) return;
      closed = true;

      // Close storage handle if open
      if (ws.storage) {
        try {
          ws.storage.close();
        } catch {
          // ignore already closed
        }
      }

      // Windows file-lock retry loop
      let retries = 5;
      while (retries > 0) {
        try {
          if (fs.existsSync(cwd)) {
            fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
          break;
        } catch {
          retries--;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    },
  };
  return ws;
}

export async function spawnMcpClient(
  cwd: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd,
    env: { ...process.env, MURMUR_LOG: "error" } as Record<string, string>,
  });
  const client = new Client({ name: "market-twin-e2e", version: "1.0.0" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      try {
        await client.close();
      } catch {
        // ignore
      }
    },
  };
}

export function initDirectWorld(cwd: string, slug = "market-twin-world"): {
  storage: engine.Storage;
  world: engine.World;
} {
  const murmurDir = path.join(cwd, ".murmur");
  fs.mkdirSync(murmurDir, { recursive: true });
  const dbPath = path.join(murmurDir, "murmur.db");
  const db = engine.openDatabase(dbPath);
  const storage = new engine.Storage(db);
  const world = storage.createWorld({
    name: slug,
    slugHint: slug,
    description: "Market Twin E2E Testing World",
    seed: "market-twin-seed-42",
    config: {
      seed: "market-twin-seed-42",
      platforms: ["twitter", "reddit"],
      batch: { maxPersonas: 12, rounds: 4, postsPerRound: 3 },
    },
  });
  return { storage, world };
}
