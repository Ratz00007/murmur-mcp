/** murmur-mcp doctor — local diagnostics. No network, no keys, ever. */
import * as fs from "node:fs";
import * as path from "node:path";
import { CLIENTS, detectClients, renderInstall } from "@murmur/adapters";
import { findWorkspaceRoot } from "@murmur/engine";

export interface DoctorReport {
  ok: boolean;
  checks: { name: string; pass: boolean; detail: string }[];
  detectedClients: { client: string; configured: boolean }[];
  worlds: number;
}

export async function runDoctor(cwd: string): Promise<DoctorReport> {
  const checks: DoctorReport["checks"] = [];
  const [major] = process.versions.node.split(".").map(Number);
  checks.push({
    name: "Node.js >= 20",
    pass: major >= 20,
    detail: `running ${process.versions.node} (${process.platform})`,
  });

  let sqliteOk = false;
  let sqliteDetail = "better-sqlite3 loaded";
  try {
    const mod = (await import("better-sqlite3")) as unknown as { default: new (p: string) => { exec(s: string): void; close(): void } };
    const Db = mod.default;
    const db = new Db(":memory:");
    db.exec("create table t(a)");
    db.close();
    sqliteOk = true;
  } catch (e) {
    sqliteDetail = `native module failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  checks.push({ name: "SQLite native module", pass: sqliteOk, detail: sqliteDetail });

  const root = findWorkspaceRoot(cwd);
  const murmurDir = path.join(root, ".murmur");
  let writable = false;
  let writableDetail = murmurDir;
  try {
    fs.mkdirSync(murmurDir, { recursive: true });
    const probe = path.join(murmurDir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
    writable = true;
  } catch (e) {
    writableDetail = `cannot write ${murmurDir}: ${e instanceof Error ? e.message : String(e)}`;
  }
  checks.push({ name: "Workspace writable", pass: writable, detail: writableDetail });

  let worlds = 0;
  const dbFile = path.join(murmurDir, "murmur.db");
  if (fs.existsSync(dbFile)) {
    try {
      const { Storage, openDatabase } = await import("@murmur/engine");
      const storage = new Storage(openDatabase(dbFile));
      worlds = storage.listWorlds().length;
      storage.close();
    } catch {
      worlds = -1;
    }
  }
  checks.push({
    name: "World store",
    pass: worlds >= 0,
    detail: worlds > 0 ? `${worlds} world(s) in ${path.relative(root, dbFile)}` : worlds === 0 ? "empty (no worlds yet — that's fine)" : "database exists but could not be opened",
  });

  const detected = detectClients(cwd).map((d) => ({ client: d.client.name, configured: d.configured }));
  checks.push({
    name: "MCP clients detected",
    pass: true,
    detail: detected.length ? detected.map((d) => `${d.client}${d.configured ? " (murmur configured)" : ""}`).join(", ") : "none found in this workspace/home — use any client from the support matrix",
  });

  return { ok: checks.every((c) => c.pass), checks, detectedClients: detected, worlds: Math.max(0, worlds) };
}

export function printDoctor(report: DoctorReport): void {
  const out = process.stdout;
  out.write("\nmurmur-mcp doctor\n=================\n");
  for (const c of report.checks) {
    out.write(`${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}\n`);
  }
  out.write("\nInstall snippets for all supported clients:\n");
  out.write(
    "NOTE: these snippets use `npx -y murmur-mcp`, which only resolves once the murmur-mcp package is\n" +
      "published on npm — until then npx returns a 404 and the client starts nothing. From a source\n" +
      "checkout, run `npm install && npm run build` and use the direct command instead:\n" +
      "  node <repo>/packages/server/dist/index.js\n" +
      "`murmur-mcp init --client <id>` prints that form automatically when it can find a built checkout.\n",
  );
  for (const c of CLIENTS) {
    out.write(`\n${renderInstall(c)}\n`);
  }
  out.write(`\nOverall: ${report.ok ? "READY" : "PROBLEMS FOUND — fix the ✗ items above"}\n\n`);
}
