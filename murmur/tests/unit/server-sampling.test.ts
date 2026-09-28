/**
 * Server assembly tests.
 *
 * These exist because `buildServer` had a defect no test could see. The
 * sampling bridge detached a prototype method and called it unbound, so every
 * sampling request threw `Cannot read properties of undefined (reading
 * '_clientCapabilities')`, which the surrounding catch swallowed into a
 * one-time warning. `use_sampling: true` silently no-opped and the entire
 * `fillViaSampling` accelerator was unreachable — while the capability probe
 * reported success, because the probe only checked that the method EXISTED.
 *
 * The regression is observable in the warning the bridge logs: a bound call
 * fails at the transport ("Not connected"); an unbound one fails on `this`.
 */
import { describe, expect, it } from "vitest";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";

/** Capture what the server writes to stderr while `fn` runs. */
async function captureStderr(fn: () => Promise<unknown>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  (process.stderr as unknown as { write: unknown }).write = (chunk: string) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stderr as unknown as { write: unknown }).write = original;
  }
  return chunks.join("");
}

describe("sampling bridge", () => {
  it("invokes createMessage with a live `this`, so failure is at the transport and not on `this`", async () => {
    const ctx = new ServerContext(process.cwd());
    buildServer(ctx);

    // A client that declares sampling but has no transport throws "Not
    // connected" once the method is entered with a correct receiver.
    expect(ctx.sampling, "sampling bridge should be installed when createMessage exists").toBeTypeOf("function");

    const output = await captureStderr(() => ctx.sampling!("prompt", "system", 64));
    expect(output).toContain("sampling bridge declined by client");
    // The regression signature: the method was entered with `this === undefined`.
    expect(output).not.toMatch(/reading '_clientCapabilities'/i);
    expect(output).not.toMatch(/reading "_clientCapabilities"/i);
    // Reaching the transport is the proof the receiver was live.
    expect(output).toMatch(/Not connected|not connected/i);
  });

  it("resolves null rather than rejecting when the client declines", async () => {
    const ctx = new ServerContext(process.cwd());
    buildServer(ctx);
    if (!ctx.sampling) return; // no client sampling support in this environment
    let resolved: unknown;
    await captureStderr(async () => {
      resolved = await ctx.sampling!("p", "s", 10);
    });
    expect(resolved).toBeNull();
  });
});
