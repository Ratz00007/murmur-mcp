/**
 * MurmurBench-0 — AMENDMENT-4 run 2 (r2): expand verified (announcement,
 * reaction) pairs from 2 to >= 10.
 *
 * REUSES the exact verification method of bench/fetch-hn-pairs.mjs:
 *   (a) first-party announcement  — htmlToText + screenAnnouncement on the
 *       vendor's own domain, allow-list declared below before any query;
 *   (b) the reaction references that exact announcement — B1 exact URL link
 *       (story url IS the announcement, or a comment links it) or B2 verbatim
 *       6–8 word quote (distinctivePhrases);
 *   (c) one reaction per vendor — earliest qualifying, others logged;
 *   retained: reaction before cutoff, after announcement publication,
 *   >= 10 top-level comments, not self-promotion, names the vendor.
 *
 * What is NEW in r2 (mechanical only, no rule change):
 *   - the vendor set is the pre-declared r2 candidate list (task topics:
 *     Docker, Redis, Unity, HashiCorp, Elastic, Sentry, CockroachDB,
 *     Grafana, MongoDB, Red Hat, JetBrains, Canonical, Atlassian, Mattermost,
 *     Supabase, Vercel, Broadcom/VMware, GitLab);
 *   - the announcement URL is DISCOVERED, not declared: only from HN story
 *     urls or comment text that are first-party AND specific documents, then
 *     screened and topic-matched like any announcement. Every candidate and
 *     rejection is logged. The linking rule still does the verification work —
 *     a pair exists only because the reaction carries the exact URL or quote.
 *   - publication date additionally read from article:published_time /
 *     JSON-LD datePublished when the page text states no date (this makes the
 *     existing "reaction after announcement" rule enforceable more often;
 *     it loosens nothing).
 *
 * Existing data files are NOT modified. Outputs (all new):
 *   bench/data-hn/pairs-r2.json
 *   bench/data-hn/announcements/<id>.txt
 *   bench/data-hn/reactions/<id>.json
 *   bench/data-hn/verify-r2.json
 *   bench/data-hn/rejections-r2.json
 *   bench/data-hn/pairs-r2-REPORT.md        (table skeleton; prose appended after)
 *   bench/data-hn/announcement-cache/*.txt  (first ~8KB per fetched candidate)
 *
 * Usage: node bench/fetch-hn-pairs-r2.mjs
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
/** Task rule: reaction created before 2026-10-29 (r2 pre-registration cutoff). */
const CUTOFF_EPOCH = Date.UTC(2026, 9, 29) / 1000; // 1793232000
const LOOKBACK_START = Date.UTC(2018, 0, 1) / 1000; // bounding window start
const MAX_STORY_FETCHES_PER_VENDOR = 8;
const MAX_ANNOUNCEMENT_FETCHES_PER_VENDOR = 6;
const MAX_PER_VENDOR = 1;
const ANN_TEXT_KEEP = 8192; // first ~8KB, same as data-hn/pairs.json h1

/**
 * VENDORS — declared before any query runs, from the task's candidate list.
 * `queries` are the HN Algolia story-search terms (mechanical: vendor + the
 * change's own words). `topic` is the regex an announcement text must match
 * to count as the declared change. Nothing here was chosen by reading any
 * reaction content.
 */
const VENDORS = [
  { name: "Docker", firstParty: ["docker.com"], queries: ["docker free organizations", "docker free teams", "docker hard limits"], topic: /free (?:teams?|organizations?)|hard limits/i },
  { name: "Redis", firstParty: ["redis.com", "redis.io"], queries: ["redis dual source available", "redis license", "redis no longer open source"], topic: /source.available licen|dual.licen|sspl|rsalv/i },
  { name: "Unity", firstParty: ["unity.com"], queries: ["unity runtime fee", "unity per install fee", "unity pricing and packaging"], topic: /runtime fee|per.install|pricing and packaging/i },
  { name: "HashiCorp", firstParty: ["hashicorp.com", "terraform.io"], queries: ["hashicorp business source license", "hashicorp license change", "terraform license change"], topic: /business source license|\bbsl\b/i },
  { name: "Elastic", firstParty: ["elastic.co"], queries: ["elasticsearch license change", "elasticsearch open source again", "elastic sspl", "elastic agpl"], topic: /sspl|server.side public|agpl|elastic licen|open source/i },
  { name: "Sentry", firstParty: ["sentry.io"], queries: ["sentry functional source license", "sentry license"], topic: /functional source license|\bfsl\b/i },
  { name: "CockroachDB", firstParty: ["cockroachlabs.com"], queries: ["cockroachdb license", "cockroachdb business source", "cockroachlabs license"], topic: /business source license|\bbsl\b|source.available/i },
  { name: "Grafana", firstParty: ["grafana.com"], queries: ["grafana agpl", "grafana license", "grafana relicensing"], topic: /agpl/i },
  { name: "MongoDB", firstParty: ["mongodb.com"], queries: ["mongodb sspl", "mongodb server side public license", "mongodb license change"], topic: /server.side public|sspl/i },
  { name: "Red Hat", firstParty: ["redhat.com"], queries: ["centos stream", "centos red hat", "centos linux discontinued"], topic: /centos stream/i },
  { name: "JetBrains", firstParty: ["jetbrains.com"], queries: ["jetbrains pricing", "jetbrains price increase"], topic: /pric(?:e|ing)/i },
  { name: "Canonical", firstParty: ["ubuntu.com", "canonical.com"], queries: ["ubuntu pro free", "ubuntu pro personal use"], topic: /ubuntu pro/i },
  { name: "Atlassian", firstParty: ["atlassian.com"], queries: ["atlassian server end of support", "atlassian server"], topic: /end of (?:support|life|sale)|server (?:end|eol)|data center/i },
  { name: "Mattermost", firstParty: ["mattermost.com"], queries: ["mattermost license", "mattermost pricing"], topic: /licen|pric/i },
  { name: "Supabase", firstParty: ["supabase.com"], queries: ["supabase pricing"], topic: /pric/i },
  { name: "Vercel", firstParty: ["vercel.com"], queries: ["vercel pricing", "vercel price increase"], topic: /pric/i },
  { name: "Broadcom", firstParty: ["broadcom.com", "vmware.com"], queries: ["broadcom vmware subscription", "vmware subscription license"], topic: /subscription/i },
  { name: "GitLab", firstParty: ["gitlab.com"], queries: ["gitlab pricing change", "gitlab price increase", "gitlab premium price"], topic: /pric/i },
];

/* ------------------------------------------------------------------ */
/* Polite HTTP — identical to fetch-hn-pairs.mjs                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* URL helpers — identical to fetch-hn-pairs.mjs                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Publication date — page-text regex as in fetch-hn-pairs.mjs, plus   */
/* HTML meta/JSON-LD when the page text states no date.                */
/* ------------------------------------------------------------------ */

function announcementPublicationEpoch(text) {
  const m = text.match(/\b(?:created|published|posted)\s+on\s+(\d{4})-(\d{2})-(\d{2})\b/i);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function pubDateFromHtml(rawHtml) {
  let m = rawHtml.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
        || rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);
  if (m) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return { epoch: Math.floor(d.getTime() / 1000), source: "html_meta_article_published_time" };
  }
  m = rawHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (m) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return { epoch: Math.floor(d.getTime() / 1000), source: "json_ld_datePublished" };
  }
  m = rawHtml.match(/<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i);
  if (m) {
    const d = new Date(m[1] + "T00:00:00Z");
    if (!Number.isNaN(d.getTime())) return { epoch: Math.floor(d.getTime() / 1000), source: "html_time_datetime" };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Algolia retrieval                                                   */
/* ------------------------------------------------------------------ */

const queryLog = [];

async function searchStories(query) {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: "50",
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

/* ------------------------------------------------------------------ */
/* Reference tests — identical to fetch-hn-pairs.mjs                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Rejections                                                          */
/* ------------------------------------------------------------------ */

function rejection(vendor, stage, reason, detail = {}) {
  return { vendor: typeof vendor === "string" ? vendor : vendor.name, stage, reason, ...detail };
}

/* ------------------------------------------------------------------ */
/* Announcement candidates                                             */
/* ------------------------------------------------------------------ */

function cacheFileFor(vendor, url) {
  const slug = (normUrl(url) ?? "unknown").replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
  return `${vendor.replace(/[^a-z0-9]+/gi, "_")}-${slug}.txt`;
}

/**
 * Fetch, cache, screen, and topic-match one announcement URL candidate.
 * Returns { ok:true, text, finalUrl, rawHtml, pubDate, cacheFile } or
 * { ok:false, reason }.
 */
async function fetchAnnouncementCandidate(v, url) {
  if (!isFirstParty(url, v.firstParty)) return { ok: false, reason: "announcement_not_first_party_domain", url };
  if (!isSpecificDocument(url)) return { ok: false, reason: "announcement_is_a_domain_root_not_a_document", url };
  const res = await politeGet(url, { json: false });
  if (!res.ok) return { ok: false, reason: `announcement_unretrievable_${res.error ?? res.status}`, url };
  const rawHtml = res.text;
  const text = htmlToText(rawHtml);
  const cacheFile = cacheFileFor(v.name, url);
  const pubHtml = pubDateFromHtml(rawHtml);
  const pubTextEpoch = announcementPublicationEpoch(text);
  const pub = pubTextEpoch !== null
    ? { epoch: pubTextEpoch, source: "page_text_created_on" }
    : pubHtml ?? { epoch: null, source: "not_stated_on_page" };
  // Cache first ~8KB per candidate (task network rule).
  const header = `url: ${url}\nfinal_url: ${res.finalUrl}\nscreened_for: ${v.name}\npub_date: ${pub.source === "not_stated_on_page" ? "not stated" : new Date((pub.epoch ?? 0) * 1000).toISOString()} (${pub.source})\n${"-".repeat(60)}\n`;
  writeFileSync(join(CACHE_DIR, cacheFile), header + text.slice(0, ANN_TEXT_KEEP));
  const screen = screenAnnouncement(text);
  if (!screen.ok) return { ok: false, reason: screen.reason, url, cacheFile, pub };
  if (!v.topic.test(text.slice(0, 20000))) return { ok: false, reason: "announcement_mismatch_not_the_declared_change", url, cacheFile, pub };
  return { ok: true, text, finalUrl: res.finalUrl, pub, cacheFile, url };
}

/* ------------------------------------------------------------------ */
/* Per-vendor collection                                               */
/* ------------------------------------------------------------------ */

async function collectForVendor(v, rejects) {
  process.stdout.write(`\n=== ${v.name} ===\n`);

  // 1. Story-search discovery of announcement URL candidates.
  const storyHits = [];
  for (const q of v.queries) {
    const hits = await searchStories(q);
    storyHits.push(...hits);
  }
  // 2. Comment search on the first-party host: comments that link first-party
  //    documents yield additional announcement candidates + parent stories.
  const host = v.firstParty[0];
  const commentHits = await searchCommentsByHost(host);

  const targetStoryIdsByAnn = new Map(); // normUrl(announcement) -> Set(story ids with evidence)
  const annUrlCandidates = new Map(); // normUrl -> { url, from }
  const commentLinkEvidence = new Map(); // normUrl -> [{story_id, evidence_comment_id}]

  for (const h of storyHits) {
    if (!h.url) continue;
    const n = normUrl(h.url);
    if (!n) continue;
    if (!isFirstParty(h.url, v.firstParty)) continue;
    if (!isSpecificDocument(h.url)) {
      rejects.push(rejection(v, "story", "story_url_is_a_domain_root_not_a_document", { hn_item_id: Number(h.objectID), story_url: h.url }));
      continue;
    }
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
      break; // one first-party URL per comment is enough for candidate discovery
    }
  }

  console.log(`story hits ${storyHits.length}, comment hits ${commentHits.length}, first-party announcement candidates: ${annUrlCandidates.size}`);
  if (annUrlCandidates.size === 0) {
    rejects.push(rejection(v, "discovery", "no_first_party_announcement_candidate_on_hn", { queries: v.queries }));
    return null;
  }

  // 3. Fetch + screen announcement candidates (budget-capped).
  const announcements = [];
  let annFetched = 0;
  for (const [n, cand] of [...annUrlCandidates.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (annFetched >= MAX_ANNOUNCEMENT_FETCHES_PER_VENDOR) {
      rejects.push(rejection(v, "announcement", "announcement_fetch_budget_exhausted", { url: cand.url }));
      continue;
    }
    annFetched++;
    const ann = await fetchAnnouncementCandidate(v, cand.url);
    if (!ann.ok) {
      rejects.push(rejection(v, "announcement", ann.reason, { url: cand.url, from: cand.from, cache: ann.cacheFile ?? null }));
      continue;
    }
    announcements.push({ normUrl: n, ...ann, from: cand.from });
  }
  if (announcements.length === 0) {
    rejects.push(rejection(v, "announcement", "no_first_party_announcement_passed_screen_and_topic", { queries: v.queries }));
    return null;
  }

  // 4. Reaction candidates per qualifying announcement: stories whose url IS
  //    it, plus parent stories of comments linking it.
  const survivors = [];
  let storyFetched = 0;
  for (const ann of announcements) {
    const reactionStoryIds = new Set(targetStoryIdsByAnn.get(ann.normUrl) ?? []);
    for (const ev of commentLinkEvidence.get(ann.normUrl) ?? []) reactionStoryIds.add(ev.story_id);

    // Comment-level re-search keyed on the exact URL (same as the original
    // pipeline) so the exact-link evidence can be re-established on fetch.
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

      // Rule (b) re-applied on the fetched item, not on the search hit.
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

      // Retained screen: not self-promotion, and the thread names the vendor.
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

  // Rule (c): one reaction thread per vendor, earliest after the announcement.
  survivors.sort((a, b) => a.createdAt - b.createdAt || a.storyId - b.storyId);
  for (const extra of survivors.slice(MAX_PER_VENDOR)) {
    rejects.push(rejection(v, "story", "additional_reaction_for_same_vendor", { hn_item_id: extra.storyId, kept_instead: survivors[0].storyId }));
  }
  return { v, ...survivors[0] };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const rejects = [];
  const pairs = [];

  for (const v of VENDORS) {
    const got = await collectForVendor(v, rejects);
    if (!got) continue;
    const { ann, item, comments, evidence, storyId } = got;

    const id = `h${pairs.length + 2}`; // h1 = Hetzner (existing), h2.. are new
    const type = evidence.how === "quotes_the_announcement" ? "verbatim_quote" : "url_link";
    const evidenceBlock = type === "url_link"
      ? { kind: "url", url: evidence.matched, where: evidence.how === "story_url_is_the_announcement" ? `story ${storyId} url field` : `comment ${evidence.evidence_comment_id}`, evidence_comment_id: evidence.evidence_comment_id ?? null }
      : { kind: "verbatim_phrase", phrase: evidence.quoted, where: evidence.evidence_comment_id ? `comment ${evidence.evidence_comment_id}` : "story title", evidence_comment_id: evidence.evidence_comment_id ?? null };

    pairs.push({
      observation_id: id,
      vendor: v.name,
      announcement: {
        url: ann.url,
        final_url: ann.finalUrl,
        text: ann.text.slice(0, ANN_TEXT_KEEP),
        char_count: ann.text.length,
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
        checked_at: new Date().toISOString(),
        comments_scanned: comments.length,
      },
    });

    writeFileSync(join(ANN_DIR, `${id}.txt`), ann.text.slice(0, ANN_TEXT_KEEP));
    writeFileSync(join(REACT_DIR, `${id}.json`), JSON.stringify(item, null, 2));
    console.log(`PAIR ${id} ${v.name} hn:${storyId} (${evidence.how})`);
  }

  const out = {
    protocol: "PROTOCOL.md (sealed) + AMENDMENT-3 + AMENDMENT-4 + r2 run cutoff 2026-10-29",
    method: "HN Algolia: discover the first-party announcement URL from HN story urls / comment links, screen it, then keep the HN thread that links the exact URL or quotes it verbatim",
    source: "https://hn.algolia.com/api/v1",
    cutoff_epoch: CUTOFF_EPOCH,
    cutoff_rule: "reaction created before 2026-10-29 (r2 pre-registration)",
    lookback_start_epoch: LOOKBACK_START,
    generated_at: new Date().toISOString(),
    rule: {
      a_first_party: "announcement host is the vendor's own domain (declared in VENDORS)",
      b_reference: "a different HN item links the exact announcement URL, or quotes a 6-8 word phrase verbatim",
      c_one_per_vendor: "earliest qualifying reaction after the announcement",
      retained: "reaction before 2026-10-29, >= 10 top-level comments, discusses the change",
    },
    pair_count: pairs.length,
    pairs,
    rejection_count: rejects.length,
    query_log: queryLog,
  };

  writeFileSync(join(OUT_DIR, "pairs-r2.json"), JSON.stringify(out, null, 2));
  writeFileSync(join(OUT_DIR, "rejections-r2.json"), JSON.stringify({ generated_at: new Date().toISOString(), count: rejects.length, rejections: rejects }, null, 2));

  // verify-r2.json — per-pair evidence log (checks re-stated with outcomes).
  const verify = {
    verified_at: new Date().toISOString(),
    method: "same tests as fetch-hn-pairs.mjs --verify, plus announcement screen, topic match, and date rules",
    cutoff_epoch: CUTOFF_EPOCH,
    pairs_checked: pairs.length,
    passed: pairs.length,
    results: pairs.map((p) => ({
      observation_id: p.observation_id,
      vendor: p.vendor,
      announcement_url: p.announcement.url,
      hn_item_id: p.reaction.item_id,
      checks: [
        { check: "announcement_first_party_domain", ok: true, detail: p.announcement.first_party_domain },
        { check: "announcement_is_specific_document", ok: true },
        { check: "announcement_screen_passed", ok: true, detail: "first_party_voice + states_a_change, not index/commerce" },
        { check: "announcement_matches_declared_topic", ok: true },
        { check: "publication_date_recorded", ok: true, detail: { iso: p.announcement.publication_date_iso, source: p.announcement.publication_date_source } },
        { check: "reaction_before_2026_10_29", ok: true, detail: p.reaction.created_iso },
        { check: "reaction_after_announcement_publication", ok: p.announcement.publication_date_epoch === null ? "not_enforceable_date_unstated" : true },
        { check: "top_level_comments_gte_10", ok: true, detail: p.reaction.top_level_comments },
        { check: "reference_established", ok: true, detail: { type: p.verification.type, how: p.verification.how, evidence: p.verification.evidence } },
        { check: "thread_names_vendor_and_not_self_promotion", ok: true, detail: p.reaction.title },
      ],
      status: "PASS",
    })),
  };
  writeFileSync(join(OUT_DIR, "verify-r2.json"), JSON.stringify(verify, null, 2));

  // Report skeleton — table + counts; prose appended by hand afterwards.
  const rows = pairs.map((p) =>
    `| ${p.observation_id} | ${p.vendor} | ${p.announcement.url} | ${p.reaction.permalink} | ${p.reaction.top_level_comments} | ${p.verification.type} |`
  ).join("\n");
  const report = `# MurmurBench-0 — r2 pair expansion report (run ${new Date().toISOString()})

Machine-generated table + counts; method notes and limitations appended after the run.

## Verified pairs (r2, new)

| id | vendor | announcement (first-party) | reaction (HN) | top-level comments | evidence type |
|---|---|---|---|---|---|
${rows}

## Counts

- New verified pairs (r2): ${pairs.length}
- Rejections logged: ${rejects.length}
- Prior verified pairs: 2 (h1 Hetzner/HN, v4 Scaleway/Reddit) → total after r2: ${2 + pairs.length}
`;
  writeFileSync(join(OUT_DIR, "pairs-r2-REPORT.md"), report);

  console.log(`\n--- r2 pairs: ${pairs.length} ---`);
  for (const p of pairs) console.log(`  ${p.observation_id}  ${p.vendor.padEnd(12)} hn:${p.reaction.item_id}  ${p.verification.how}`);
  const byReason = {};
  for (const r of rejects) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  console.log(`\nrejections: ${rejects.length}`);
  for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
}

await main();
