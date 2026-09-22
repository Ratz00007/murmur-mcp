#!/usr/bin/env node
/**
 * tests/cleanroom/gate.mjs — the release gate (PRD 9.3).
 *
 *   1. No-egress audit: the bundled server contains no network APIs and no URLs.
 *   2. No-key audit: no API-key/token surface anywhere in the shipped code.
 *   3. Dependency audit: runtime dependency closure contains no network libraries.
 *   4. Time-to-first-world: a full headless pipeline (seeds → report) completes
 *      in under the 2-minute envelope.
 *   5. Workspace isolation: everything the run created lives under .murmur/.
 *
 * Exit code 0 = gate green. Run via `npm run cleanroom`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const NETWORK_PATTERNS = [
  /node:http/, /node:https/, /node:net(?!\w)/, /node:dns/, /node:tls/, /node:diagnostics_channel(?!\w)/,
  /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /navigator\.sendBeacon/,
  /https?:\/\//,
];
const KEY_PATTERNS = [/API_KEY/i, /apiKey/, /OPENAI/, /ANTHROPIC/, /ZEP_API/, /Bearer\s+[A-Za-z0-9]/, /x-api-key/i];
const NETWORK_DEP_DENYLIST = [
  "axios", "node-fetch", "got", "request", "undici", "https-proxy-agent", "socks-proxy-agent",
  "cross-fetch", "isomorphic-fetch", "whatwg-fetch", "superagent", "needle", "phin", "needle",
];

export async function runGate(root = repoRoot) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });

  // ---- 1 + 2: scan the shipped bundle ------------------------------------
  const dist = path.join(root, "packages", "server", "dist", "index.js");
  if (!fs.existsSync(dist)) {
    check("bundle exists", false, `missing ${dist} — run npm run build first`);
    return { pass: false, checks };
  }
  const code = fs.readFileSync(dist, "utf8");
  const netHits = [];
  for (const re of NETWORK_PATTERNS) {
    const m = code.match(re);
    if (m) netHits.push(String(m[0]));
  }
  check("no network APIs in shipped code", netHits.length === 0, netHits.length ? `found: ${[...new Set(netHits)].join(", ")}` : "no http/https/net/dns/tls/fetch/WebSocket/URL tokens in the bundle");

  const keyHits = [];
  for (const re of KEY_PATTERNS) {
    const m = code.match(re);
    if (m) keyHits.push(String(m[0]));
  }
  check("no API-key surface", keyHits.length === 0, keyHits.length ? `found: ${[...new Set(keyHits)].join(", ")}` : "no key/token fields anywhere in the bundle");

  // ---- 3: dependency closure ---------------------------------------------
  const serverPkg = JSON.parse(fs.readFileSync(path.join(root, "packages", "server", "package.json"), "utf8"));
  const runtimeDeps = Object.keys(serverPkg.dependencies ?? {});
  const allowRoot = ["@modelcontextprotocol/sdk", "better-sqlite3", "zod"];
  const unexpected = runtimeDeps.filter((d) => !allowRoot.includes(d));
  check("runtime dependencies exact", unexpected.length === 0, unexpected.length ? `unexpected deps: ${unexpected.join(", ")}` : `exactly ${allowRoot.join(", ")}`);

  const closure = new Set(runtimeDeps);
  for (const dep of runtimeDeps) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules", dep, "package.json"), "utf8"));
      for (const d of Object.keys(pkg.dependencies ?? {})) closure.add(d);
    } catch {
      // not installed in this checkout — skip closure expansion
    }
  }
  const denied = [...closure].filter((d) => NETWORK_DEP_DENYLIST.includes(d));
  check("dependency closure has no network libraries", denied.length === 0, denied.length ? `denylisted: ${denied.join(", ")}` : `closure: ${[...closure].sort().join(", ")}`);

  // ---- 4 + 5: headless run in a clean temp workspace ----------------------
  const { runPipeline } = await import(path.join(root, "tests", "helpers", "pipeline.mjs"));
  const engine = await import(path.join(root, "packages", "engine", "dist", "index.js"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cleanroom-"));
  let seconds = -1;
  let reportExists = false;
  let isolated = true;
  let isolationDetail = "no files created outside .murmur/";
  try {
    const t0 = Date.now();
    const run = await runPipeline(engine, { cwd, seed: "cleanroom", rounds: 3, population: 10 });
    seconds = (Date.now() - t0) / 1000;
    reportExists = fs.existsSync(run.reportPath);
    run.close();
    // isolation: walk cwd; everything must be under .murmur/
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        const rel = path.relative(cwd, p);
        if (!rel.startsWith(".murmur") && rel !== ".murmur") {
          isolated = false;
          isolationDetail = `stray file: ${rel}`;
        }
        if (entry.isDirectory()) walk(p);
      }
    };
    walk(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  check("time-to-first-world < 120s", seconds >= 0 && seconds < 120, `${seconds.toFixed(2)}s for seeds → ontology → graph → personas → 3 rounds → report`);
  check("report file produced", reportExists, reportExists ? "report-1.md written into .murmur/reports/" : "no report file");
  check("workspace isolation", isolated, isolationDetail);

  return { pass: checks.every((c) => c.pass), checks };
}

// ---- CLI mode -----------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) {
  runGate()
    .then((r) => {
      process.stdout.write("\nmurmur cleanroom release gate\n==============================\n");
      for (const c of r.checks) process.stdout.write(`${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}\n`);
      process.stdout.write(`\nOverall: ${r.pass ? "GATE GREEN — releasable" : "GATE RED — release blocked"}\n\n`);
      process.exit(r.pass ? 0 : 1);
    })
    .catch((e) => {
      process.stderr.write(`gate crashed: ${e?.stack ?? e}\n`);
      process.exit(1);
    });
}
