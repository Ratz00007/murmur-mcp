/**
 * Shared fetch layer for the murmur live-data collector.
 *
 * This module (and everything under the collector directory) is a standalone
 * research utility. It is NEVER shipped with the murmur packages and may
 * use the network. The shipped murmur package sources stay network-free.
 *
 * Features:
 * - per-host rate limit (default 1 req/s, env MURMUR_COLLECTOR_MIN_INTERVAL_MS)
 * - retry with exponential backoff on 429/5xx, honoring Retry-After (max 3)
 * - AbortController timeout (default 20s, env MURMUR_COLLECTOR_TIMEOUT_MS)
 * - on-disk response cache in tools/collector/.cache, TTL 24h unless --refresh
 * - descriptive User-Agent (env MURMUR_COLLECTOR_UA)
 * - robots.txt gate: one fetch per host, longest-match-wins, clear errors
 *
 * Every response is exposed as { status, body, sha256, retrievedAt, url,
 * method, fromCache } so parsers can stamp DiscourseThread.provenance.
 *
 * Zero npm dependencies. Node >= 20 (global fetch, node:crypto).
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const COLLECTOR_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(COLLECTOR_DIR, ".cache");
export const FIXTURES_DIR = path.join(COLLECTOR_DIR, "fixtures");

const DEFAULT_UA =
  "murmur-collector/0.1 (offline-fixture research; contact: repo maintainer)";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MIN_INTERVAL_MS = 1_000; // 1 req/s per host
const MAX_RETRIES = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_RETRY_AFTER_MS = 30_000; // never sleep longer than this on Retry-After

// ---------------------------------------------------------------------------
// Environment (read lazily so tests can override per call)
// ---------------------------------------------------------------------------

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function userAgent() {
  return process.env.MURMUR_COLLECTOR_UA || DEFAULT_UA;
}

export function timeoutMs() {
  return envInt("MURMUR_COLLECTOR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
}

export function minIntervalMs() {
  return envInt("MURMUR_COLLECTOR_MIN_INTERVAL_MS", DEFAULT_MIN_INTERVAL_MS);
}

export function backoffBaseMs() {
  return envInt("MURMUR_COLLECTOR_BACKOFF_BASE_MS", 1_000);
}

// ---------------------------------------------------------------------------
// Mode switches (CLI wiring)
// ---------------------------------------------------------------------------

let offlineMode = false;
let recordDir = null;
let refresh = false;
let seqCounter = 0;

/** Offline mode never touches the network; responses replay committed cassettes. */
export function setOffline(on) {
  offlineMode = !!on;
}
export function isOffline() {
  return offlineMode;
}

/** Recording mode writes every live response as a cassette under dir. */
export function setRecordDir(dir) {
  recordDir = dir;
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
export function getRecordDir() {
  return recordDir;
}

/** --refresh ignores the on-disk cache (live fetches only). */
export function setRefresh(on) {
  refresh = !!on;
}

// ---------------------------------------------------------------------------
// Keys, cache, cassettes
// ---------------------------------------------------------------------------

export function cacheKey(method, url) {
  return crypto.createHash("sha256").update(`${method}${url}`).digest("hex");
}

function cachePathForKey(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function readStoredResponse(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.body !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredResponse(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 1), "utf8");
  fs.renameSync(tmp, file);
}

// Cassette index for offline replay: key -> stored response.
let cassetteIndex = null;

function loadCassetteIndex() {
  if (cassetteIndex) return cassetteIndex;
  cassetteIndex = new Map();
  if (!fs.existsSync(FIXTURES_DIR)) return cassetteIndex;
  const stack = [FIXTURES_DIR];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name.endsWith(".json")) {
        const stored = readStoredResponse(p);
        if (stored) {
          const key = cacheKey(stored.method || "GET", stored.url);
          cassetteIndex.set(key, stored);
        }
      }
    }
  }
  return cassetteIndex;
}

/** Test/replay hook: forget the in-memory cassette + robots caches. */
export function resetCaches() {
  cassetteIndex = null;
  robotsCache.clear();
  hostLastRequest.clear();
}

// ---------------------------------------------------------------------------
// Rate limiting (per host)
// ---------------------------------------------------------------------------

const hostLastRequest = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit(host) {
  const interval = minIntervalMs();
  if (interval <= 0) return;
  const last = hostLastRequest.get(host);
  const now = Date.now();
  if (last !== undefined) {
    const wait = last + interval - now;
    if (wait > 0) await sleep(wait);
  }
  hostLastRequest.set(host, Date.now());
}

// ---------------------------------------------------------------------------
// robots.txt gate
// ---------------------------------------------------------------------------

export const robotsCache = new Map(); // origin -> { status: 'allow'|'parsed', groups }

/**
 * Parse a robots.txt body into groups of rules.
 * Supports User-agent groups, Disallow/Allow, '*' wildcard, trailing '$'.
 * Longest-match-wins across Allow/Disallow; ties go to Allow.
 */
export function parseRobots(body) {
  const groups = [];
  let currentAgents = [];
  let currentRules = [];
  const flush = () => {
    if (currentAgents.length && currentRules.length) {
      groups.push({
        agents: currentAgents.map((a) => a.toLowerCase()),
        rules: currentRules,
      });
    }
    currentAgents = [];
    currentRules = [];
  };
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue; // blank line ends the current group
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (currentRules.length) flush(); // new group after rules
      currentAgents.push(value);
    } else if (field === "disallow" || field === "allow") {
      if (!currentAgents.length) continue; // rule outside any group
      currentRules.push({ type: field, path: value });
    }
    // Crawl-delay, Sitemap and friends are ignored (we bring our own limiter)
  }
  flush();
  return groups;
}

function robotsPatternToRegExp(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") source += ".*";
    else if (ch === "$" && i === pattern.length - 1) source += "$";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}`);
}

function selectGroups(groups, agentToken) {
  const token = agentToken.toLowerCase();
  const exact = groups.filter((g) => g.agents.includes(token));
  if (exact.length) return exact;
  return groups.filter((g) => g.agents.includes("*"));
}

/**
 * Decide whether url is allowed for agentToken by parsed groups.
 * Returns null when allowed, or { agent, rule } describing the matching
 * Disallow rule when blocked.
 */
export function robotsAllows(groups, agentToken, urlPath) {
  const applicable = selectGroups(groups || [], agentToken);
  let best = null; // { type, path, agent, length }
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (rule.type === "disallow" && rule.path === "") continue; // no-op
      let re;
      try {
        re = robotsPatternToRegExp(rule.path);
      } catch {
        continue;
      }
      if (!re.test(urlPath)) continue;
      const length = rule.path.length;
      if (
        !best ||
        length > best.length ||
        (length === best.length && rule.type === "allow")
      ) {
        best = { type: rule.type, path: rule.path, agent: group.agents.join(", "), length };
      }
    }
  }
  if (best && best.type === "disallow") return { agent: best.agent, rule: best.path };
  return null;
}

async function fetchRobots(origin) {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const url = `${origin}/robots.txt`;
  let groups;
  try {
    const res = await rawFetch(url, { robotsProbe: true });
    if (res.status >= 200 && res.status < 300) {
      groups = parseRobots(await res.text());
    } else {
      groups = null; // 4xx/5xx: unreachable robots.txt = allow
    }
  } catch {
    groups = null; // unreachable = allow
  }
  const entry = { groups };
  robotsCache.set(origin, entry);
  return entry;
}

async function assertRobotsAllowed(url) {
  const origin = new URL(url).origin;
  const { groups } = await fetchRobots(origin);
  if (!groups) return; // missing/unreachable robots.txt = allow
  const parsed = new URL(url);
  const blocked = robotsAllows(
    groups,
    userAgent().replace(/\/.*$/, "").split(/\s+/)[0],
    parsed.pathname + parsed.search,
  );
  if (blocked) {
    throw new Error(
      `robots.txt of ${origin} disallows ${url} ` +
        `(matched rule User-agent: ${blocked.agent}; Disallow: ${blocked.rule}) — ` +
        `use a different endpoint, a public API mirror, or manual export`,
    );
  }
}

// ---------------------------------------------------------------------------
// Retry-After handling
// ---------------------------------------------------------------------------

export function retryAfterMs(headers, attempt) {
  const raw = headers?.get?.("retry-after");
  let ms = null;
  if (raw) {
    const asInt = Number.parseInt(raw, 10);
    if (Number.isFinite(asInt)) ms = asInt * 1000;
    else {
      const asDate = Date.parse(raw);
      if (!Number.isNaN(asDate)) ms = asDate - Date.now();
    }
  }
  if (ms === null || ms < 0) ms = backoffBaseMs() * 2 ** attempt;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

const injectableFetch = { impl: null };

/** Test hook: replace the underlying network fetch (must behave like global fetch). */
export function setFetchImpl(impl) {
  injectableFetch.impl = impl;
}

async function rawFetch(url, { robotsProbe = false, headers = {} } = {}) {
  const impl = injectableFetch.impl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await impl(url, {
      method: "GET",
      headers: { "user-agent": userAgent(), accept: "*/*", ...headers },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url) {
  return new URL(url).host;
}

/**
 * Fetch url (GET), applying rate limit, robots gate, cache, retries.
 * Returns { status, body, sha256, retrievedAt, url, method, fromCache }.
 */
export async function fetchText(url, { method = "GET", headers = {}, robotsProbe = false } = {}) {
  const key = cacheKey(method, url);
  const transportHeaders = headers;

  if (offlineMode) {
    const cassette = loadCassetteIndex().get(key);
    if (!cassette) {
      throw new Error(
        `offline mode: no committed cassette for ${method} ${url} — ` +
          `run the collector live once (e.g. node tools/collector/cli.mjs --source <id> --query ... --record tools/collector/fixtures/<id>) or add a cassette`,
      );
    }
    return {
      status: cassette.status ?? 200,
      body: cassette.body,
      sha256: sha256Hex(cassette.body),
      retrievedAt: cassette.retrievedAt,
      url,
      method,
      fromCache: true,
    };
  }

  // Robots gate runs BEFORE the cache lookup: a cache hit must not silently
  // bypass a rules change, and the once-per-host robots fetch is cheap.
  if (!robotsProbe) await assertRobotsAllowed(url);

  if (!refresh) {
    const cached = readStoredResponse(cachePathForKey(key));
    if (cached && Date.parse(cached.retrievedAt) > Date.now() - CACHE_TTL_MS) {
      return {
        status: cached.status,
        body: cached.body,
        sha256: sha256Hex(cached.body),
        retrievedAt: cached.retrievedAt,
        url,
        method,
        fromCache: true,
      };
    }
  }

  let attempt = 0;
  for (;;) {
    await rateLimit(hostOf(url));
    let res;
    try {
      res = await rawFetch(url, { robotsProbe, headers: transportHeaders });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(backoffBaseMs() * 2 ** attempt);
        attempt += 1;
        continue;
      }
      throw new Error(`fetch failed after ${MAX_RETRIES} retries: ${method} ${url} (${err.message})`);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(res.headers, attempt));
        attempt += 1;
        continue;
      }
      throw new Error(
        `HTTP ${res.status} for ${url} after ${MAX_RETRIES} retries — giving up`,
      );
    }
    const body = await res.text();
    const retrievedAt = new Date().toISOString();
    const entry = {
      url,
      method,
      status: res.status,
      retrievedAt,
      sha256: sha256Hex(body),
      body,
    };
    try {
      writeStoredResponse(cachePathForKey(key), entry);
    } catch {
      /* cache write failures are non-fatal */
    }
    if (recordDir) {
      entry.seq = ++seqCounter;
      try {
        writeStoredResponse(path.join(recordDir, `${key}.json`), entry);
      } catch {
        /* record write failures are non-fatal */
      }
    }
    return {
      status: res.status,
      body,
      sha256: entry.sha256,
      retrievedAt,
      url,
      method,
      fromCache: false,
    };
  }
}

/** fetchText that throws on non-2xx with a descriptive message. */
export async function fetchJsonOrText(url, opts = {}) {
  const res = await fetchText(url, opts);
  if (res.status >= 400) {
    throw new Error(
      `HTTP ${res.status} for ${url}${res.body ? ` — ${res.body.slice(0, 200)}` : ""}`,
    );
  }
  return res;
}
