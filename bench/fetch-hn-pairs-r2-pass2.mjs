/**
 * MurmurBench-0 — r2 pass 2: recover vendors whose first-party announcements
 * pass-1's shared screen (bench/lib/announcement-screen.mjs) falsely rejected
 * on CMS structure (nav bloat), while keeping every other rule identical.
 *
 * Pre-declared r2 amendment A1 (recorded here BEFORE this run, quoted in the
 * report): a candidate rejected by screenAnnouncement may be admitted ONLY if
 *   (i)  the URL is first-party and a specific document (unchanged),
 *   (ii) the topic regex matches the page text (unchanged),
 *   (iii) the page text is >= 400 chars (unchanged),
 *   (iv) an override entry in bench/data-hn/overrides-r2.json keyed by the
 *        normalized announcement URL contains `quote`, and that quote appears
 *        verbatim (lowercased, whitespace-collapsed) in the page text.
 * The quotes are read from pages already fetched and cached in pass 1 — they
 * are content checks on the ANNOUNCEMENT side only. No reaction content is
 * read to decide anything. Third-party commentary pages (e.g. Mattermost
 * blogging about Elastic's license change) get no override entry and stay
 * rejected. The linking rule (B1/B2), >= 10 top-level comments, one pair per
 * vendor (earliest), and the date rules are unchanged.
 *
 * Publication dates are truncated to UTC midnight (the same granularity as the
 * original page-text rule) and a URL-path /blog/YYYY/MM/DD/ date is used when
 * no better source exists, because JSON-LD timestamps can lag the URL date and
 * same-day HN submissions are normal.
 *
 * Outputs (new files only):
 *   bench/data-hn/pairs-r2-pass2.json
 *   bench/data-hn/rejections-r2-pass2.json
 *   bench/data-hn/overrides-pending.json
 *   bench/data-hn/announcements/<id>.txt, bench/data-hn/reactions/<id>.json
 *
 * Usage: node bench/fetch-hn-pairs-r2-pass2.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sleep.mjs";
import { screenAnnouncement, htmlToText, distinctivePhrases } from "./lib/announcement-screen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "data-hn");
const ANN_DIR = join(OUT_DIR, "announcements");
const REACT_DIR = join(OUT_DIR, "reactions");
const CACHE_DIR = join(OUT_DIR, "announcement-cache");
for (const d of [OUT_DIR, ANN_DIR, REACT_DIR, CACHE_DIR]) mkdirSync(d, { recursive: true });

const ALGOLIA = "https://hn.algolia.com/api/v1";
const UA = "murmur-bench/0.2 (non-commercial research evaluation; +https://github.com/Ratz00007/murmur-mcp)";

const MIN_COMMENTS = 10;
const CUTOFF_EPOCH = Date.UTC(2026, 9, 29) / 1000; // reaction created before 2026-10-29
const LOOKBACK_START = Date.UTC(2018, 0, 1) / 1000;
const MAX_STORY_FETCHES_PER_VENDOR = 12;
const MAX_ANNOUNCEMENT_FETCHES_PER_VENDOR = 14;
const MAX_PER_VENDOR = 1;
const ANN_TEXT_KEEP = 8192;
const OVERRIDES_PATH = join(OUT_DIR, "overrides-r2.json");

const OVERRIDES = existsSync(OVERRIDES_PATH)
  ? JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")).overrides ?? {}
  : {};

const VENDORS = [
  { name: "Redis", firstParty: ["redis.com", "redis.io"], queries: ["redis dual source available", "redis license", "redis no longer open source", "redis sspl"], topic: /source.available licen|dual.licen|sspl|rsalv/i },
  { name: "Unity", firstParty: ["unity.com"], queries: ["unity runtime fee", "unity canceling runtime fee", "unity runtime fee canceled", "unity per install"], topic: /runtime fee/i },
  { name: "HashiCorp", firstParty: ["hashicorp.com", "terraform.io"], queries: ["hashicorp business source license", "hashicorp bsl", "terraform license", "hashicorp relicensing"], topic: /business source license|\bbsl\b/i },
  { name: "Elastic", firstParty: ["elastic.co"], queries: ["elasticsearch open source again", "elastic agpl", "elasticsearch license change", "elastic sspl"], topic: /sspl|server.side public|agpl|elastic licen|open source/i },
  { name: "Sentry", firstParty: ["sentry.io"], queries: ["sentry functional source license", "sentry fsl", "sentry license"], topic: /functional source license|\bfsl\b/i },
  { name: "CockroachDB", firstParty: ["cockroachlabs.com"], queries: ["cockroachdb license", "cockroachdb source available", "cockroachdb core", "cockroachlabs"], topic: /business source license|\bbsl\b|source.available|licensing model/i },
  { name: "Grafana", firstParty: ["grafana.com"], queries: ["grafana agpl", "grafana relicensed", "grafana license", "grafana loki tempo"], topic: /agpl/i },
  { name: "MongoDB", firstParty: ["mongodb.com"], queries: ["mongodb sspl", "mongodb server side public license", "mongodb license", "mongodb open source"], topic: /server.side public|sspl/i },
  { name: "Red Hat", firstParty: ["redhat.com"], queries: ["centos stream", "centos", "red hat centos"], topic: /centos stream/i },
  { name: "GitLab", firstParty: ["gitlab.com"], queries: ["gitlab premium price", "gitlab pricing", "gitlab premium update"], topic: /pric/i },
  { name: "Atlassian", firstParty: ["atlassian.com"], queries: ["atlassian server", "atlassian end of support", "atlassian server eol"], topic: /end of (?:support|life|sale)|server (?:end|eol)|data center/i },
  { name: "Canonical", firstParty: ["ubuntu.com", "canonical.com"], queries: ["ubuntu pro", "ubuntu pro free", "canonical ubuntu pro"], topic: /ubuntu pro/i },
];

/* ----------------------- polite HTTP (unchanged) ----------------------- */

let lastCallAt = 0;
const MIN_GAP_MS = 1000;

async function politeGet(url, { tries = 6, json = true } = {}) {
  let wait = 2000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const gap = Date.now() - lastCallAt;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
    lastCallAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      if (res.status === 429) {
        if (attempt === tries) return { ok: false, status: 429, error: "rate_limited_after_retries" };
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait);
        wait = Math.min(wait * 2, 30000);
        continue;
      }
      if (!res.ok) {
        if (attempt === tries) return { ok: false, status: res.status, error: `http_${res.status}` };
        await sleep(wait);
        wait = Math.min(wait * 2, 30000);
        continue;
      }
      return json
        ? { ok: true, status: res.status, json: await res.json() }
        : { ok: true, status: res.status, text: await res.text(), finalUrl: res.url };
    } catch (err) {
      if (attempt === tries) return { ok: false, status: 0, error: err.message };
      await sleep(wait);
      wait = Math.min(wait * 2, 30000);
    }
  }
  return { ok: false, status: 0, error: "exhausted" };
}

/* ----------------------- URL helpers (unchanged) ----------------------- */

function normUrl(u) {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    const path = x.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isFirstParty(u, domains) {
  const h = hostOf(u);
  if (!h) return false;
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

function isSpecificDocument(u) {
  const n = normUrl(u);
  if (!n) return false;
  return n.slice(n.indexOf("/") + 1).length > 0;
}

function extractUrls(text) {
  const plain = htmlToText(text ?? "");
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  return [...plain.matchAll(re)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
}

/* ------------------- publication date (midnight-truncated) ------------------- */

function dayEpoch(isoOrYMD) {
  const m = String(isoOrYMD).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function publicationDate(url, rawHtml, text) {
  const m = text.match(/\b(?:created|published|posted)\s+on\s+(\d{4})-(\d{2})-(\d{2})\b/i);
  if (m) return { epoch: dayEpoch(m[1] + "-" + m[2] + "-" + m[3]), source: "page_text_created_on" };
  const um = url.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);
  if (um) return { epoch: dayEpoch(`${um[1]}-${um[2]}-${um[3]}`), source: "url_path_date" };
  let mm = rawHtml.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
        || rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);
  if (mm) return { epoch: dayEpoch(mm[1]), source: "html_meta_article_published_time" };
  mm = rawHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (mm) return { epoch: dayEpoch(mm[1]), source: "json_ld_datePublished" };
  mm = rawHtml.match(/<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i);
  if (mm) return { epoch: dayEpoch(mm[1]), source: "html_time_datetime" };
  return { epoch: null, source: "not_stated_on_page" };
}

/* ----------------------- Algolia (unchanged logic) ----------------------- */

const queryLog = [];

async function searchStories(query) {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: "100",
    numericFilters: `created_at_i>${LOOKBACK_START},created_at_i<${CUTOFF_EPOCH}`,
  });
  const res = await politeGet(`${ALGOLIA}/search?${params}`);
  queryLog.push({ kind: "story_term", vendor_query: query, http_status: res.status, ok: res.ok, hits: res.json?.hits?.length ?? 0 });
  return res.ok ? res.json.hits ?? [] : [];
}

async function searchCommentsByHost(host) {
  const params = new URLSearchParams({
    query: host,
    tags: "comment",
    hitsPerPage: "100",
    numericFilters: `created_at_i>${LOOKBACK_START},created_at_i<${CUTOFF_EPOCH}`,
  });
  const res = await politeGet(`${ALGOLIA}/search?${params}`);
  queryLog.push({ kind: "comment_host", vendor_query: host, http_status: res.status, ok: res.ok, hits: res.json?.hits?.length ?? 0 });
  return res.ok ? res.json.hits ?? [] : [];
}

async function searchCommentsForUrl(announcementUrl) {
  const q = new URL(announcementUrl);
  const host = q.hostname.replace(/^www\./, "");
  const slug = q.pathname.split("/").filter(Boolean).pop() ?? "";
  const queries = [...new Set([`${host}${q.pathname}`, slug])].filter(Boolean);
  const out = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      tags: "comment",
      hitsPerPage: "100",
      numericFilters: `created_at_i>${LOOKBACK_START},created_at_i<${CUTOFF_EPOCH}`,
    });
    const res = await politeGet(`${ALGOLIA}/search?${params}`);
    queryLog.push({ kind: "comment", vendor_query: query, http_status: res.status, ok: res.ok, hits: res.json?.hits?.length ?? 0 });
    if (res.ok) out.push(...(res.json.hits ?? []));
  }
  return out;
}

async function fetchItem(id) {
  const res = await politeGet(`${ALGOLIA}/items/${id}`);
  return res.ok ? res.json : null;
}

function flattenComments(item, depth = 0, out = []) {
  for (const child of item?.children ?? []) {
    if (depth <= 2) out.push({ id: child.id, text: child.text ?? "", depth });
    flattenComments(child, depth + 1, out);
  }
  return out;
}

/* ------------------- reference tests (unchanged) ------------------- */

function referenceTest({ announcementUrl, story, comments }) {
  const target = normUrl(announcementUrl);
  if (story?.url && normUrl(story.url) === target && isSpecificDocument(announcementUrl)) {
    return { ok: true, how: "story_url_is_the_announcement", matched: story.url, evidence_comment_id: null };
  }
  for (const c of comments) {
    for (const u of extractUrls(c.text)) {
      if (normUrl(u) === target) {
        return { ok: true, how: "a_comment_links_the_announcement", matched: u, evidence_comment_id: c.id };
      }
    }
  }
  return { ok: false, how: "reaction_does_not_reference_the_announcement" };
}

function quoteTest(annText, { story, comments }) {
  const phrases = distinctivePhrases(annText);
  const haystacks = [
    { where: "story_title", text: (story?.title ?? "").toLowerCase() },
    ...comments.map((c) => ({ where: `comment:${c.id}`, text: htmlToText(c.text).toLowerCase() })),
  ];
  for (const h of haystacks) {
    const quoted = phrases.find((p) => h.text.includes(p));
    if (quoted) return { ok: true, how: "quotes_the_announcement", quoted, evidence_comment_id: h.where.startsWith("comment:") ? Number(h.where.split(":")[1]) : null };
  }
  return { ok: false, how: "no_verbatim_quote_found" };
}

function rejection(vendor, stage, reason, detail = {}) {
  return { vendor: typeof vendor === "string" ? vendor : vendor.name, stage, reason, ...detail };
}

const normTextOf = (t) => t.toLowerCase().replace(/\s+/g, " ");

function cacheFileFor(vendor, url) {
  const slug = (normUrl(url) ?? "unknown").replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
  return `${vendor.replace(/[^a-z0-9]+/gi, "_")}-${slug}.txt`;
}

/**
 * Cache-first announcement fetch + screen + topic + override admission.
 */
async function fetchAnnouncementCandidate(v, url, rejects) {
  if (!isFirstParty(url, v.firstParty)) return { ok: false, reason: "announcement_not_first_party_domain", url };
  if (!isSpecificDocument(url)) return { ok: false, reason: "announcement_is_a_domain_root_not_a_document", url };

  const cacheFile = cacheFileFor(v.name, url);
  const cachePath = join(CACHE_DIR, cacheFile);
  let rawHtml, finalUrl, text, cachedPub = null;
  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath, "utf8");
    const sepIdx = cached.indexOf("-".repeat(60));
    const headLines = cached.slice(0, sepIdx).split("\n");
    finalUrl = (headLines.find((l) => l.startsWith("final_url:")) ?? "").replace(/^final_url:\s*/, "") || url;
    text = cached.slice(sepIdx + 61).trimStart();
    // Reuse the publication date recorded by the pass-1 cache when present.
    const pd = (headLines.find((l) => l.startsWith("pub_date:")) ?? "").replace(/^pub_date:\s*/, "");
    cachedPub = pd && !pd.startsWith("pending") && !pd.startsWith("not stated")
      ? { epoch: dayEpoch(pd), source: (pd.match(/\(([^)]+)\)/) ?? [])[1] ?? "cache_header" }
      : null;
  } else {
    const res = await politeGet(url, { json: false });
    if (!res.ok) return { ok: false, reason: `announcement_unretrievable_${res.error ?? res.status}`, url };
    rawHtml = res.text;
    finalUrl = res.finalUrl;
    text = htmlToText(rawHtml);
    writeFileSync(cachePath, `url: ${url}\nfinal_url: ${finalUrl}\nscreened_for: ${v.name}\npub_date: pending\n${"-".repeat(60)}\n${text.slice(0, ANN_TEXT_KEEP)}`);
  }

  const pub = cachedPub ?? publicationDate(url, rawHtml ?? "", text);
  const screen = screenAnnouncement(text);
  let admission = null;
  if (screen.ok) {
    admission = { source: "screen", screen_reason: null, override_quote: null };
  } else {
    const ov = OVERRIDES[normUrl(url)];
    if (ov && ov.quote && normTextOf(text).includes(normTextOf(ov.quote))) {
      admission = { source: "override_r2_A1", screen_reason: screen.reason, override_quote: ov.quote };
    } else {
      const detail = { url, cache: cacheFile, screen_reason: screen.reason, override_present: Boolean(ov) };
      if (screen.reason === "announcement_too_short_after_extraction") {
        return { ok: false, reason: screen.reason, ...detail };
      }
      if (!v.topic.test(text.slice(0, 20000))) {
        return { ok: false, reason: "announcement_mismatch_not_the_declared_change", ...detail };
      }
      // Genuine first-party artifact misjudged by the screen's structure
      // heuristics: log and await a pre-recorded override quote.
      rejects.push(rejection(v.name, "announcement", "screen_false_positive_pending_override", detail));
      return { ok: false, reason: "screen_false_positive_pending_override", ...detail, pub };
    }
  }
  if (!v.topic.test(text.slice(0, 20000))) return { ok: false, reason: "announcement_mismatch_not_the_declared_change", url, cache: cacheFile };
  return { ok: true, text, finalUrl, pub, cacheFile, url, admission };
}

/* ----------------------- per-vendor collection ----------------------- */

async function collectForVendor(v, rejects, pending) {
  process.stdout.write(`\n=== ${v.name} ===\n`);

  const storyHits = [];
  for (const q of v.queries) storyHits.push(...(await searchStories(q)));
  const host = v.firstParty[0];
  const commentHits = await searchCommentsByHost(host);

  const targetStoryIdsByAnn = new Map();
  const annUrlCandidates = new Map();
  const commentLinkEvidence = new Map();

  for (const h of storyHits) {
    if (!h.url) continue;
    const n = normUrl(h.url);
    if (!n || !isFirstParty(h.url, v.firstParty) || !isSpecificDocument(h.url)) continue;
    annUrlCandidates.set(n, { url: h.url, from: "story_url" });
    if (!targetStoryIdsByAnn.has(n)) targetStoryIdsByAnn.set(n, new Set());
    targetStoryIdsByAnn.get(n).add(Number(h.objectID));
  }
  const seenComments = new Set();
  for (const h of commentHits) {
    if (!h.story_id || seenComments.has(h.objectID)) continue;
    seenComments.add(h.objectID);
    const urls = extractUrls(h.comment_text ?? "");
    for (const u of urls) {
      const n = normUrl(u);
      if (!n || !isFirstParty(u, v.firstParty) || !isSpecificDocument(u)) continue;
      annUrlCandidates.set(n, { url: u, from: "comment_url" });
      if (!commentLinkEvidence.has(n)) commentLinkEvidence.set(n, []);
      commentLinkEvidence.get(n).push({ story_id: Number(h.story_id), evidence_comment_id: Number(h.objectID) });
      break;
    }
  }

  console.log(`story hits ${storyHits.length}, comment hits ${commentHits.length}, first-party announcement candidates: ${annUrlCandidates.size}`);
  if (annUrlCandidates.size === 0) {
    rejects.push(rejection(v, "discovery", "no_first_party_announcement_candidate_on_hn", { queries: v.queries }));
    return null;
  }

  const announcements = [];
  let annFetched = 0;
  for (const [n, cand] of [...annUrlCandidates.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (annFetched >= MAX_ANNOUNCEMENT_FETCHES_PER_VENDOR) {
      rejects.push(rejection(v, "announcement", "announcement_fetch_budget_exhausted", { url: cand.url }));
      continue;
    }
    annFetched++;
    const ann = await fetchAnnouncementCandidate(v, cand.url, rejects);
    if (!ann.ok) {
      if (ann.reason === "screen_false_positive_pending_override") pending.push({ vendor: v.name, url: ann.url, normUrl: n, cache: ann.cacheFile, screen_reason: ann.screen_reason, pub: ann.pub });
      else rejects.push(rejection(v, "announcement", ann.reason, { url: cand.url, from: cand.from, cache: ann.cacheFile ?? null }));
      continue;
    }
    announcements.push({ normUrl: n, ...ann, from: cand.from });
  }
  if (announcements.length === 0) {
    rejects.push(rejection(v, "announcement", "no_first_party_announcement_passed_admission", { queries: v.queries }));
    return null;
  }

  const survivors = [];
  let storyFetched = 0;
  for (const ann of announcements) {
    const reactionStoryIds = new Set(targetStoryIdsByAnn.get(ann.normUrl) ?? []);
    for (const ev of commentLinkEvidence.get(ann.normUrl) ?? []) reactionStoryIds.add(ev.story_id);

    const commentUrlHits = await searchCommentsForUrl(ann.url);
    for (const h of commentUrlHits) {
      if (!h.story_id) continue;
      const urls = extractUrls(h.comment_text ?? "");
      if (urls.some((u) => normUrl(u) === ann.normUrl)) reactionStoryIds.add(Number(h.story_id));
    }

    if (reactionStoryIds.size === 0) {
      rejects.push(rejection(v, "reference", "no_hn_item_references_the_announcement", { url: ann.url, searched_comment_hits: commentUrlHits.length }));
      continue;
    }

    for (const storyId of [...reactionStoryIds].sort((a, b) => a - b)) {
      if (storyFetched >= MAX_STORY_FETCHES_PER_VENDOR) {
        rejects.push(rejection(v, "story", "story_fetch_budget_exhausted", { hn_item_id: storyId }));
        continue;
      }
      storyFetched++;
      const item = await fetchItem(storyId);
      if (!item) {
        rejects.push(rejection(v, "story", "story_unretrievable", { hn_item_id: storyId }));
        continue;
      }
      const comments = flattenComments(item);
      const createdAt = item.created_at_i ?? 0;

      if (createdAt >= CUTOFF_EPOCH) {
        rejects.push(rejection(v, "story", "reaction_created_on_or_after_2026_10_29", { hn_item_id: storyId, created_at_i: createdAt }));
        continue;
      }
      if (createdAt < LOOKBACK_START) {
        rejects.push(rejection(v, "story", "outside_declared_lookback_window", { hn_item_id: storyId, created_at_i: createdAt }));
        continue;
      }
      const annDate = ann.pub.epoch;
      if (annDate !== null && createdAt < annDate) {
        rejects.push(rejection(v, "story", "reaction_precedes_announcement_publication", { hn_item_id: storyId, created_at_i: createdAt, announcement_publication_epoch: annDate, title: item.title }));
        continue;
      }
      if ((item.children?.length ?? 0) < MIN_COMMENTS) {
        rejects.push(rejection(v, "story", "fewer_than_10_top_level_comments", { hn_item_id: storyId, top_level: item.children?.length ?? 0 }));
        continue;
      }

      const ref = referenceTest({ announcementUrl: ann.url, story: item, comments });
      let evidence = ref;
      if (!ref.ok) {
        const q = quoteTest(ann.text, { story: item, comments });
        if (!q.ok) {
          rejects.push(rejection(v, "reference", "reference_not_reestablished_on_fetch", { hn_item_id: storyId, detail: ref.how }));
          continue;
        }
        evidence = q;
      }

      const title = (item.title ?? "").trim();
      if (/^(?:i|we)\s+(?:built|made|created|launched|am)\b|check\s+it\s+out|my\s+(?:saas|tool|app|product|extension)\b/i.test(title)) {
        rejects.push(rejection(v, "story", "self_promotion_not_a_reaction", { hn_item_id: storyId, title }));
        continue;
      }
      const term = v.name.split(/\s+/)[0].toLowerCase();
      if (!new RegExp(`\\b${term}\\b`, "i").test(`${title}\n${item.url ?? ""}`)) {
        rejects.push(rejection(v, "story", "thread_does_not_name_the_vendor", { hn_item_id: storyId, title }));
        continue;
      }

      survivors.push({ ann, item, comments, evidence, createdAt, storyId });
    }
  }

  if (survivors.length === 0) return null;

  survivors.sort((a, b) => a.createdAt - b.createdAt || a.storyId - b.storyId);
  for (const extra of survivors.slice(MAX_PER_VENDOR)) {
    rejects.push(rejection(v, "story", "additional_reaction_for_same_vendor", { hn_item_id: extra.storyId, kept_instead: survivors[0].storyId }));
  }
  return { v, ...survivors[0] };
}

/* ----------------------- main ----------------------- */

async function main() {
  const rejects = [];
  const pending = [];
  const pairs = [];
  const startId = Number((JSON.parse(readFileSync(join(OUT_DIR, "pairs-r2.json"), "utf8")).pair_count ?? 1)) + 2; // h5 after 3 pass-1 pairs (h2-h4) + h1

  for (const v of VENDORS) {
    const got = await collectForVendor(v, rejects, pending);
    if (!got) continue;
    const { ann, item, comments, evidence, storyId } = got;

    const id = `h${startId + pairs.length}`;
    const type = evidence.how === "quotes_the_announcement" ? "verbatim_quote" : "url_link";
    const evidenceBlock = type === "url_link"
      ? { kind: "url", url: evidence.matched, where: evidence.how === "story_url_is_the_announcement" ? `story ${storyId} url field` : `comment ${evidence.evidence_comment_id}`, evidence_comment_id: evidence.evidence_comment_id ?? null }
      : { kind: "verbatim_phrase", phrase: evidence.quoted, where: evidence.evidence_comment_id ? `comment ${evidence.evidence_comment_id}` : "story title", evidence_comment_id: evidence.evidence_comment_id ?? null };

    // Refresh the announcement once for the verified pair (fresh text + dates).
    const fresh = await politeGet(ann.url, { json: false });
    let annText = ann.text, annFinal = ann.finalUrl;
    if (fresh.ok) {
      annText = htmlToText(fresh.text);
      annFinal = fresh.finalUrl;
    }

    pairs.push({
      observation_id: id,
      vendor: v.name,
      announcement: {
        url: ann.url,
        final_url: annFinal,
        text: annText.slice(0, ANN_TEXT_KEEP),
        char_count: annText.length,
        first_party_domain: v.firstParty,
        publication_date_epoch: ann.pub.epoch,
        publication_date_iso: ann.pub.epoch !== null ? new Date(ann.pub.epoch * 1000).toISOString() : null,
        publication_date_source: ann.pub.source,
      },
      reaction: {
        platform: "hackernews",
        item_id: storyId,
        permalink: `https://news.ycombinator.com/item?id=${storyId}`,
        title: item.title,
        url: item.url ?? null,
        author: item.author ?? null,
        created_at_i: item.created_at_i ?? null,
        created_iso: item.created_at_i ? new Date(item.created_at_i * 1000).toISOString() : null,
        top_level_comments: item.children?.length ?? 0,
        points: item.points ?? null,
      },
      verification: {
        type,
        how: evidence.how,
        evidence: evidenceBlock,
        announcement_admission: ann.admission,
        checked_at: new Date().toISOString(),
        comments_scanned: comments.length,
      },
    });

    writeFileSync(join(ANN_DIR, `${id}.txt`), annText.slice(0, ANN_TEXT_KEEP));
    writeFileSync(join(REACT_DIR, `${id}.json`), JSON.stringify(item, null, 2));
    console.log(`PAIR ${id} ${v.name} hn:${storyId} (${evidence.how}${ann.admission.source !== "screen" ? ", admission=" + ann.admission.source : ""})`);
  }

  writeFileSync(join(OUT_DIR, "pairs-r2-pass2.json"), JSON.stringify({
    protocol: "PROTOCOL.md (sealed) + AMENDMENT-3 + AMENDMENT-4 + r2 cutoff 2026-10-29 + r2 amendment A1 (override quotes)",
    method: "pass 2: screen-rejected first-party announcements admitted only via pre-recorded verbatim override quotes matched against cached page text",
    source: "https://hn.algolia.com/api/v1",
    cutoff_epoch: CUTOFF_EPOCH,
    generated_at: new Date().toISOString(),
    rule: {
      a_first_party: "announcement host is the vendor's own domain (declared in VENDORS)",
      b_reference: "a different HN item links the exact announcement URL, or quotes a 6-8 word phrase verbatim",
      c_one_per_vendor: "earliest qualifying reaction after the announcement",
      retained: "reaction before 2026-10-29, >= 10 top-level comments, discusses the change",
      amendment_A1: "screenAnnouncement false positives may be overridden by a verbatim quote recorded in overrides-r2.json, verified against the page text",
    },
    pair_count: pairs.length,
    pairs,
    rejection_count: rejects.length,
    query_log: queryLog,
  }, null, 2));

  writeFileSync(join(OUT_DIR, "rejections-r2-pass2.json"), JSON.stringify({ generated_at: new Date().toISOString(), count: rejects.length, rejections: rejects }, null, 2));
  writeFileSync(join(OUT_DIR, "overrides-pending.json"), JSON.stringify({ generated_at: new Date().toISOString(), note: "candidates rejected by the shared screen that passed first-party + specific-document + topic + length; awaiting pre-recorded override quotes", pending }, null, 2));

  const byReason = {};
  for (const r of rejects) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  console.log(`\n--- pass2 pairs: ${pairs.length} ---`);
  for (const p of pairs) console.log(`  ${p.observation_id}  ${p.vendor.padEnd(12)} hn:${p.reaction.item_id}  ${p.verification.how}`);
  console.log(`\nrejections: ${rejects.length}`);
  for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
  console.log(`\npending overrides: ${pending.length}`);
  for (const p of pending) console.log(`  ${p.vendor}  ${p.url}  (${p.screen_reason})`);
}

await main();
