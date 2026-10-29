#!/usr/bin/env node
/**
 * tests/cleanroom/gate.mjs — the release gate (PRD 9.3).
 *
 *   1. No-egress audit: the bundled server AND its sourcemap contain no network
 *      APIs, no URLs and no process/eval escape hatches.
 *   2. No-key audit: no API-key/token surface anywhere in the shipped code.
 *   3. Supply-chain audit: runtime dependencies are exactly the three declared
 *      roots, and the full transitive closure matches the allowlist resolved
 *      from package-lock.json — unknown or missing packages fail the gate.
 *   4. Pack audit: `npm pack --dry-run` may ship only files the gate audited
 *      (bundle + sourcemap) or expected doc files.
 *   5. Time-to-first-world: a full headless pipeline (seeds → report) completes
 *      in under the 2-minute envelope.
 *   6. Workspace isolation: everything the run created lives under .murmur/.
 *
 * Scope note: the isolation walk covers the pipeline's temp cwd only, and this
 * gate never executes the MCP server itself — `npm run test:e2e` covers the
 * running server separately. The gate summary states what was and wasn't proven.
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
  /node:http/,
  /node:https/,
  /node:net(?!\w)/,
  /node:dns/,
  /node:tls/,
  /node:diagnostics_channel(?!\w)/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /navigator\.sendBeacon/,
  /https?:\/\//,
];
const KEY_PATTERNS = [
  /API_KEY/i,
  /apiKey/,
  /OPENAI/,
  /ANTHROPIC/,
  /ZEP_API/,
  /Bearer\s+[A-Za-z0-9]/,
  /x-api-key/i,
];
const ESCAPE_PATTERNS = [
  /child_process/,
  /worker_threads/,
  /process\.dlopen/,
  /\bspawn\s*\(/,
  /\bexecSync\s*\(/,
  /\bexecFile\s*\(/,
  /\brequire\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\beval\s*\(/,
  /import\s*\(\s*(['"`])(?!(?:@modelcontextprotocol\/sdk|better-sqlite3|zod)\1)/,
  /import\s*\(\s*[A-Za-z_$]/,
];
// allowlist, not a denylist: the exact prod-dependency closure of the three
// declared roots, resolved from package-lock.json by walking its
// node_modules/<name> entries following "dependencies". Regenerate whenever the
// lockfile changes; anything outside this list fails the gate.
const ALLOW_ROOTS = ["@modelcontextprotocol/sdk", "better-sqlite3", "zod"];
const EXPECTED_CLOSURE = [
  "@hono/node-server",
  "@modelcontextprotocol/sdk",
  "accepts",
  "ajv",
  "ajv-formats",
  "base64-js",
  "better-sqlite3",
  "bindings",
  "bl",
  "body-parser",
  "buffer",
  "bytes",
  "call-bind-apply-helpers",
  "call-bound",
  "chownr",
  "content-disposition",
  "content-type",
  "cookie",
  "cookie-signature",
  "cors",
  "cross-spawn",
  "debug",
  "decompress-response",
  "deep-extend",
  "depd",
  "detect-libc",
  "dunder-proto",
  "ee-first",
  "encodeurl",
  "end-of-stream",
  "es-define-property",
  "es-errors",
  "es-object-atoms",
  "escape-html",
  "etag",
  "eventsource",
  "eventsource-parser",
  "expand-template",
  "express",
  "express-rate-limit",
  "fast-deep-equal",
  "fast-uri",
  "file-uri-to-path",
  "finalhandler",
  "forwarded",
  "fresh",
  "fs-constants",
  "function-bind",
  "get-intrinsic",
  "get-proto",
  "github-from-package",
  "gopd",
  "has-symbols",
  "hasown",
  "hono",
  "http-errors",
  "iconv-lite",
  "ieee754",
  "inherits",
  "ini",
  "ip-address",
  "ipaddr.js",
  "is-promise",
  "isexe",
  "jose",
  "json-schema-traverse",
  "json-schema-typed",
  "math-intrinsics",
  "media-typer",
  "merge-descriptors",
  "mime-db",
  "mime-types",
  "mimic-response",
  "minimist",
  "mkdirp-classic",
  "ms",
  "napi-build-utils",
  "negotiator",
  "node-abi",
  "object-assign",
  "object-inspect",
  "on-finished",
  "once",
  "parseurl",
  "path-key",
  "path-to-regexp",
  "pkce-challenge",
  "prebuild-install",
  "proxy-addr",
  "pump",
  "qs",
  "range-parser",
  "raw-body",
  "rc",
  "readable-stream",
  "require-from-string",
  "router",
  "safe-buffer",
  "safer-buffer",
  "semver",
  "send",
  "serve-static",
  "setprototypeof",
  "shebang-command",
  "shebang-regex",
  "side-channel",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
  "simple-concat",
  "simple-get",
  "statuses",
  "string_decoder",
  "strip-json-comments",
  "tar-fs",
  "tar-stream",
  "toidentifier",
  "tunnel-agent",
  "type-is",
  "unpipe",
  "util-deprecate",
  "vary",
  "which",
  "wrappy",
  "zod",
  "zod-to-json-schema",
];

export async function runGate(root = repoRoot) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });

  // ---- 1 + 2: scan the shipped bundle and its sourcemap --------------------
  const distDir = path.join(root, "packages", "server", "dist");
  const dist = path.join(distDir, "index.js");
  const distMap = path.join(distDir, "index.js.map");
  const missingArtifacts = [dist, distMap].filter((f) => !fs.existsSync(f));
  if (missingArtifacts.length > 0) {
    check(
      "bundle exists",
      false,
      `missing ${missingArtifacts.join(", ")} — run npm run build first (tsup emits sourcemap: true, so index.js.map ships too and must be scanned)`,
    );
    return { pass: false, checks };
  }
  const surfaces = [
    { name: "dist/index.js", code: fs.readFileSync(dist, "utf8") },
    { name: "dist/index.js.map", code: fs.readFileSync(distMap, "utf8") },
  ];
  const scan = (patterns) => {
    const hits = [];
    for (const re of patterns) {
      for (const s of surfaces) {
        const m = s.code.match(re);
        if (m) {
          hits.push(`${s.name}:${String(m[0])}`);
          break;
        }
      }
    }
    return hits;
  };

  const netHits = scan(NETWORK_PATTERNS);
  check(
    "no network APIs in shipped code",
    netHits.length === 0,
    netHits.length
      ? `found: ${[...new Set(netHits)].join(", ")}`
      : "no http/https/net/dns/tls/fetch/WebSocket/URL tokens in the bundle or its sourcemap",
  );

  const escapeHits = scan(ESCAPE_PATTERNS);
  check(
    "no process/eval escape hatches",
    escapeHits.length === 0,
    escapeHits.length
      ? `found: ${[...new Set(escapeHits)].join(", ")}`
      : "no child_process/spawn/exec/require/eval/dlopen/worker_threads/dynamic-import escape hatches in the bundle or its sourcemap",
  );

  const keyHits = scan(KEY_PATTERNS);
  check(
    "no API-key surface",
    keyHits.length === 0,
    keyHits.length
      ? `found: ${[...new Set(keyHits)].join(", ")}`
      : "no key/token fields anywhere in the bundle or its sourcemap",
  );

  // ---- 3: dependency closure vs the lockfile allowlist ---------------------
  const serverPkg = JSON.parse(
    fs.readFileSync(
      path.join(root, "packages", "server", "package.json"),
      "utf8",
    ),
  );
  const runtimeDeps = Object.keys(serverPkg.dependencies ?? {});
  const unexpected = runtimeDeps.filter((d) => !ALLOW_ROOTS.includes(d));
  check(
    "runtime dependencies exact",
    unexpected.length === 0,
    unexpected.length
      ? `unexpected deps: ${unexpected.join(", ")}`
      : `exactly ${ALLOW_ROOTS.join(", ")}`,
  );

  const nodeModules = path.join(root, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    check(
      "dependency closure matches lockfile allowlist",
      false,
      `node_modules missing under ${root} — run npm install first; refusing to pass on an unverified closure`,
    );
  } else {
    const closure = new Set(runtimeDeps);
    const unresolved = [];
    const queue = [...runtimeDeps];
    while (queue.length > 0) {
      const name = queue.shift();
      let pkg;
      try {
        pkg = JSON.parse(
          fs.readFileSync(
            path.join(nodeModules, ...name.split("/"), "package.json"),
            "utf8",
          ),
        );
      } catch {
        unresolved.push(name);
        break;
      }
      for (const d of Object.keys(pkg.dependencies ?? {})) {
        if (!closure.has(d)) {
          closure.add(d);
          queue.push(d);
        }
      }
    }
    if (unresolved.length > 0) {
      check(
        "dependency closure matches lockfile allowlist",
        false,
        `closure package not installed: ${unresolved.join(", ")} — run npm install; refusing to pass on an unverified closure`,
      );
    } else {
      const unknown = [...closure].filter((d) => !EXPECTED_CLOSURE.includes(d));
      const absent = EXPECTED_CLOSURE.filter((d) => !closure.has(d));
      check(
        "dependency closure matches lockfile allowlist",
        unknown.length === 0 && absent.length === 0,
        unknown.length > 0
          ? `packages outside the reviewed allowlist: ${unknown.join(", ")}`
          : absent.length > 0
            ? `allowlist packages missing from the closure: ${absent.join(", ")} — package-lock.json and node_modules disagree; run npm install`
            : `${closure.size} packages, exactly the allowlist resolved from package-lock.json (prod deps of ${ALLOW_ROOTS.join(", ")}); note the pinned set includes the SDK's HTTP-capable transitives (express, hono, eventsource) — proven is the exact match, not the absence of HTTP code`,
      );
    }
  }

  // ---- 4: pack audit — everything npm ships is audited ----------------------
  const scannedFiles = ["dist/index.js", "dist/index.js.map"];
  const expectedPackFiles = new Set([
    ...scannedFiles,
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",
  ]);
  let shipped = null;
  let packError = null;
  try {
    const { execFileSync } = await import("node:child_process");
    const npmCmd = `npm${process.platform === "win32" ? ".cmd" : ""} pack --dry-run --json`;
    const out = execFileSync(npmCmd, {
      cwd: path.join(root, "packages", "server"),
      encoding: "utf8",
      shell: true,
    });
    shipped = JSON.parse(out)[0]?.files?.map((f) => f.path) ?? null;
    if (!shipped) packError = "npm pack --dry-run --json returned no file list";
  } catch (e) {
    packError = `npm pack failed: ${e?.message ?? e} — is npm on PATH?`;
  }
  if (shipped) {
    const extra = shipped.filter((f) => !expectedPackFiles.has(f));
    const unscanned = scannedFiles.filter((f) => !shipped.includes(f));
    check(
      "npm pack ships only audited files",
      extra.length === 0 && unscanned.length === 0,
      extra.length > 0
        ? `unaudited files would ship: ${extra.join(", ")}`
        : unscanned.length > 0
          ? `scanned files missing from the tarball: ${unscanned.join(", ")}`
          : `all ${shipped.length} shipped files accounted for — bundle + sourcemap scanned, the rest are package.json/doc files`,
    );
  } else {
    check(
      "npm pack ships only audited files",
      false,
      packError ?? "could not determine the pack output",
    );
  }

  // ---- 5 + 6: headless run in a clean temp workspace ------------------------
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cleanroom-"));
  let seconds = -1;
  let reportExists = false;
  let isolated = true;
  let isolationDetail = "no files created outside .murmur/";
  try {
    const { runPipeline } = await import(
      url.pathToFileURL(path.join(root, "tests", "helpers", "pipeline.mjs"))
        .href
    );
    const engine = await import(
      url.pathToFileURL(
        path.join(root, "packages", "engine", "dist", "index.js"),
      ).href
    );
    const t0 = Date.now();
    const run = await runPipeline(engine, {
      cwd,
      seed: "cleanroom",
      rounds: 3,
      population: 10,
    });
    seconds = (Date.now() - t0) / 1000;
    reportExists = fs.existsSync(run.reportPath);
    run.close();
    // isolation: walk cwd; everything must be under .murmur/ (covers this temp
    // cwd only — writes elsewhere on the machine are not observed here)
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
  } catch (e) {
    isolated = false;
    isolationDetail = `pipeline did not complete: ${e?.message ?? e}`;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  check(
    "time-to-first-world < 120s",
    seconds >= 0 && seconds < 120,
    seconds >= 0
      ? `${seconds.toFixed(2)}s for seeds → ontology → graph → personas → 3 rounds → report`
      : "pipeline did not complete — see workspace isolation detail; run npm install if node_modules is missing",
  );
  check(
    "report file produced",
    reportExists,
    reportExists
      ? "report-1.md written into .murmur/reports/"
      : "no report file",
  );
  check("workspace isolation", isolated, isolationDetail);

  return { pass: checks.every((c) => c.pass), checks };
}

// ---- CLI mode -----------------------------------------------------------------
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(url.fileURLToPath(import.meta.url))
) {
  runGate()
    .then((r) => {
      process.stdout.write(
        "\nmurmur cleanroom release gate\n==============================\n",
      );
      for (const c of r.checks)
        process.stdout.write(`${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}\n`);
      process.stdout.write(
        `\nOverall: ${r.pass ? "GATE GREEN — releasable" : "GATE RED — release blocked"}\n`,
      );
      process.stdout.write(
        "Proven: shipped bundle and sourcemap free of network/exec/key tokens; dependency surface exactly the reviewed lockfile allowlist; npm pack ships only audited files; the headless pipeline (engine only, not the server) is fast and kept every file inside .murmur/ within its temp cwd.\n",
      );
      process.stdout.write(
        "Not proven here: isolation beyond the pipeline's temp cwd, and the MCP server is never executed — `npm run test:e2e` covers the running server separately.\n\n",
      );
      process.exit(r.pass ? 0 : 1);
    })
    .catch((e) => {
      process.stderr.write(`gate crashed: ${e?.stack ?? e}\n`);
      process.exit(1);
    });
}
