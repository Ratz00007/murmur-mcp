/**
 * Hosted-server smoke test (opt-in): spawns the built murmur-mcp-host,
 * checks auth gating (401 without/with-bad token), a full MCP initialize
 * handshake, tool listing, world_init, and per-user data isolation.
 *
 * Requires the host bundle to exist (npm run build -w murmur-mcp-host).
 * Run:  MURMUR_HOST_SMOKE=1 npx vitest run tests/unit/host-smoke.test.ts
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST_DIST = path.resolve(here, "..", "..", "packages", "host", "dist", "index.js");

const TOKEN = "tok_smoke_alice";

async function waitForHealth(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("host did not become healthy in time");
}

describe("murmur-mcp-host (smoke)", () => {
  it.runIf(process.env.MURMUR_HOST_SMOKE === "1")(
    "auth-gates, serves the MCP protocol, and isolates per-user data",
    async () => {
      const port = 18899;
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-host-smoke-"));
      const child = spawn(process.execPath, [HOST_DIST], {
        cwd: path.resolve(here, "..", ".."),
        env: {
          ...process.env,
          PORT: String(port),
          MURMUR_HOST_DATA: dataDir,
          MURMUR_HOST_TOKENS: JSON.stringify({ alice: TOKEN }),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let logs = "";
      child.stdout.on("data", (d) => (logs += String(d)));
      child.stderr.on("data", (d) => (logs += String(d)));

      try {
        const base = `http://127.0.0.1:${port}/mcp`;
        await waitForHealth(`http://127.0.0.1:${port}/health`);

        // 401 without / with bad token
        for (const auth of [undefined, "Bearer nope"]) {
          const r = await fetch(base, {
            method: "POST",
            headers: {
              ...(auth ? { authorization: auth } : {}),
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
          });
          expect(r.status).toBe(401);
        }

        // Real handshake
        const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
        const init = await fetch(base, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }) });
        expect(init.status).toBe(200);
        const sid = init.headers.get("mcp-session-id");
        expect(sid).toBeTruthy();
        const initBody = await init.json();
        expect(initBody.result?.serverInfo?.name).toBe("murmur-mcp");

        const h2 = { ...h, "mcp-session-id": sid! };
        await fetch(base, { method: "POST", headers: h2, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

        const toolsRes = await fetch(base, { method: "POST", headers: h2, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
        const toolsBody = await toolsRes.json();
        const names = (toolsBody.result?.tools ?? []).map((t: { name: string }) => t.name);
        expect(names).toContain("world_init");
        expect(names).toContain("macro_sim");

        const wRes = await fetch(base, { method: "POST", headers: h2, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "world_init", arguments: { name: "smoke-world" } } }) });
        const wBody = await wRes.json();
        expect(wBody.result?.structuredContent?.ok ?? wBody.result?.content?.[0]?.text).toBeTruthy();

        // per-user isolation: alice's world exists under users/alice
        const aliceDir = path.join(dataDir, "users", "alice", ".murmur");
        expect(fs.existsSync(aliceDir)).toBe(true);
      } finally {
        child.kill("SIGTERM");
        await once(child, "exit").catch(() => undefined);
      }
    },
  );
});
