/**
 * Elicitation fallback: interact({target:'persona'}) without a persona must
 * return the plain error when the client cannot elicit, never hang or throw
 * an MCP protocol error. In a test harness there is no connected client, so
 * the bridge (if installed) declines and the fallback path is what runs.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";

describe("elicitation fallback", () => {
  it("returns the plain missing-persona error when elicitation is unavailable", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-elicit-"));
    const ctx = new ServerContext(cwd);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "elicit-test", version: "0.0.0" });
    try {
      await buildServer(ctx).connect(serverTransport);
      await client.connect(clientTransport);
      await client.callTool({ name: "world_init", arguments: { name: "e", seed: "e" } });
      // No persona, no elicitation support from this client: the tool must
      // answer with the plain error text, not an MCP protocol failure.
      const res = await client.callTool({ name: "interact", arguments: { target: "persona", question: "Why do you feel this way?" } });
      expect(res.isError).toBeTruthy();
      const text = (res.content as { text: string }[])[0]?.text ?? "";
      expect(text).toContain("needs persona");
    } finally {
      await client.close().catch(() => {});
      ctx.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
