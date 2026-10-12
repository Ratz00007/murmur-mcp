/**
 * Server CLI surface: argument parsing, doctor diagnostics, server resolution.
 *
 * cli.ts and doctor.ts were at 0% coverage — the only code in the repo the
 * coverage gate could not see, because the config excluded the server tools
 * and these files are exercised only by hand. What is pinned here is the
 * contract a user depends on: `murmur-mcp doctor` reports five checks with an
 * overall verdict, `parseArgs` routes every documented action, and
 * `resolveServerCommand` prefers the local build.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs, resolveServerCommand } from "../../packages/server/src/cli.js";
import { runDoctor } from "../../packages/server/src/doctor.js";

describe("parseArgs", () => {
  it("routes the documented actions", () => {
    expect(parseArgs(["serve"]).action).toBe("serve");
    expect(parseArgs(["doctor"]).action).toBe("doctor");
    expect(parseArgs(["init"]).action).toBe("init");
    expect(parseArgs(["templates"]).action).toBe("templates");
    expect(parseArgs(["version"]).action).toBe("version");
    // No positional means "serve": the binary's default job is to start the
    // server on stdio, not to print help.
    expect(parseArgs([]).action).toBe("serve");
    expect(parseArgs(["--help"]).action).toBe("help");
    expect(parseArgs(["-h"]).action).toBe("help");
  });

  it("parses flags and short flags", () => {
    const init = parseArgs(["init", "--client", "claude-code", "--write"]);
    expect(init.action).toBe("init");
    expect(init.flags.client).toBe("claude-code");
    expect(init.flags.write).toBe(true);
    // -v is --version, not verbosity: it routes the action, it is not a flag.
    const verbose = parseArgs(["doctor", "-v"]);
    expect(verbose.action).toBe("version");
    expect(verbose.flags.version).toBe(true);
  });

  it("falls back to help on an unknown action", () => {
    expect(parseArgs(["frobnicate"]).action).toBe("help");
  });
});

describe("resolveServerCommand", () => {
  it("prefers a direct node invocation when a built monorepo is detectable", () => {
    // The murmur package root has packages/server/dist after a build.
    const root = path.resolve(__dirname, "..", "..");
    const resolved = resolveServerCommand(root);
    // process.execPath, not the bare word "node": the child must run under
    // the same runtime that spawned it.
    expect(resolved.command.toLowerCase()).toMatch(/node(\.exe)?$/);
    expect(resolved.args.join(" ")).toContain("dist");
  });

  it("falls back to npx outside a checkout", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-resolve-"));
    try {
      const resolved = resolveServerCommand(dir);
      expect(resolved.command).toBe("npx");
      expect(resolved.args).toContain("murmur-mcp");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runDoctor", () => {
  it("reports exactly five checks with an overall verdict", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-doctor-"));
    try {
      const report = await runDoctor(dir);
      expect(report.checks).toHaveLength(5);
      for (const c of report.checks) {
        expect(typeof c.name).toBe("string");
        expect(typeof c.pass).toBe("boolean");
        expect(typeof c.detail).toBe("string");
      }
      expect(typeof report.ok).toBe("boolean");
      expect(report.ok).toBe(report.checks.every((c) => c.pass));
      expect(typeof report.worlds).toBe("number");
      expect(Array.isArray(report.detectedClients)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes the Node floor on any supported runtime", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-doctor-"));
    try {
      const report = await runDoctor(dir);
      const node = report.checks.find((c) => c.name.includes("Node"));
      expect(node).toBeTruthy();
      expect(node!.pass).toBe(true);
      expect(node!.detail).toContain(process.platform);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
