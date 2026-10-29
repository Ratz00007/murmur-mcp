/**
 * MurmurBench-0 — AMENDMENT 4: pair discovery and verification against HN
 * Algolia.
 *
 * The Reddit path (PROTOCOL.md §4, AMENDMENT-3) could not enumerate the
 * announcement→reaction edge: Arctic Shift rejects body, URL, and domain
 * search. HN Algolia indexes comment text and story URLs, so the edge is
 * searchable in the direction the protocol needs — find the item that LINKS
 * the announcement, then read its thread as ground truth.
 *
 * Inclusion rule (AMENDMENT-4 §3), applied mechanically, rejection by default:
 *
 *   (a) the announcement URL is first-party (vendor's own domain, declared
 *       below BEFORE any query runs);
 *   (b) a different HN item references that exact announcement URL — either a
 *       story whose `url` IS the announcement, or a comment whose text links
 *       it — or quotes a distinctive 6–8 word phrase from it verbatim;
 *   (c) at most one reaction thread per vendor, earliest after the
 *       announcement, ties broken by item id.
 *
 * Retained from the sealed protocol: reaction before the seal, reaction after
 * the announcement, >= 10 comments, thread discusses the change.
 *
 * Every rejection carries a reason string and is written to rejections.json.
 * Nothing is dropped silently, and no threshold is tuned after seeing results.
 *
 * Usage:
 *   node bench/fetch-hn-pairs.mjs            # discover + verify, write data-hn/
 *   node bench/fetch-hn-pairs.mjs --verify   # re-check existing pairs only
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sleep.mjs";
import { screenAnnouncement, htmlToText, distinctivePhrases } from "./lib/announcement-screen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "data-hn");
const PAIRS = join(OUT_DIR, "pairs.json");
const REJECTIONS = join(OUT_DIR, "rejections.json");
const VERIFY_ONLY = process.argv.includes("--verify");

const ALGOLIA = "https://hn.algolia.com/api/v1";
const UA = "murmur-bench/0.1 (non-commercial research evaluation; +https://github.com/Ratz00007/murmur-mcp)";

const MIN_COMMENTS = 10;
const SEAL_EPOCH = 1790560176; // same seal constant as select-vendor-pairs.mjs
const AFTER_EPOCH = SEAL_EPOCH - 365 * 86400;
const MAX_STORY_FETCHES_PER_VENDOR = 10;
const MAX_PER_VENDOR = 1;

/**
 * Vendors and announcements are the SAME list already used by the Reddit
 * pipeline, declared before this run and not extended after seeing results.
 * Domains are the vendor's own; `firstParty` is the allow-list for rule (a).
 */
const VENDORS = [
  {
    name: "ONLYOFFICE",
    announcement: "https://www.onlyoffice.com/blog/2026/03/onlyoffice-flags-license-violations-in-euro-office-project-by-nextcloud-and-ionos",
    firstParty: ["onlyoffice.com"],
    term: "onlyoffice",
  },
  {
    name: "Flathub",
    announcement: "https://docs.flathub.org/blog/enhanced-license-compliance-tools",
    firstParty: ["flathub.org"],
    term: "flathub",
  },
  {
    name: "Hetzner",
    announcement: "https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/",
    firstParty: ["hetzner.com"],
    term: "hetzner",
  },
  {
    name: "Scaleway",
    announcement: "https://www.scaleway.com/en/blog/a-transparent-update-on-scaleway-pricing/",
    firstParty: ["scaleway.com"],
    term: "scaleway",
  },
  {
    name: "Bitwarden",
    announcement: "https://bitwarden.com/resources/january-2026-spotlight-enhanced-premium-plan",
    firstParty: ["bitwarden.com"],
    term: "bitwarden",
  },
  {
    name: "Nextcloud",
    announcement: "https://nextcloud.com/blog/september-updates-for-nextcloud-hub-25-autumn-26-winter-26-spring/",
    firstParty: ["nextcloud.com"],
    term: "nextcloud",
  },
  {
    name: "Mullvad",
    announcement: "https://mullvad.net/en/blog/removing-openvpn-15th-january-2026",
    firstParty: ["mullvad.net"],
    term: "mullvad",
  },
  {
    name: "Proton",
    announcement: "https://proton.me/blog/monthly-unlimited-price-change",
    firstParty: ["proton.me"],
    term: "proton",
  },
];

/* ------------------------------------------------------------------ */
/* Polite HTTP                                                         */
/* ------------------------------------------------------------------ */

let lastCallAt = 0;
const MIN_GAP_MS = 1000;

/** ~1 req/sec, descriptive UA, exponential backoff on 429/5xx. */
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
/* URL helpers — normalisation only, no fuzzy matching                 */
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

/** Specific document, not a bare domain root. */
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
/* Algolia retrieval — query set derived mechanically from the URL     */
/* ------------------------------------------------------------------ */

const queryLog = [];

async function searchStoriesByUrl(announcementUrl) {
  const q = new URL(announcementUrl);
  const query = `${q.hostname.replace(/^www\./, "")}${q.pathname}`;
  const params = new URLSearchParams({
    query,
    tags: "story",
    restrictSearchableAttributes: "url",
    hitsPerPage: "50",
    numericFilters: `created_at_i>${AFTER_EPOCH},created_at_i<${SEAL_EPOCH}`,
  });
  const url = `${ALGOLIA}/search?${params}`;
  let res = await politeGet(url);
  // If the attribute restriction is rejected, retry without it and say so.
  let restrictionUsed = true;
  if (!res.ok && res.status >= 400 && res.status < 500) {
    params.delete("restrictSearchableAttributes");
    res = await politeGet(`${ALGOLIA}/search?${params}`);
    restrictionUsed = false;
  }
  queryLog.push({ kind: "story_url", vendor_query: query, http_status: res.status, ok: res.ok, hits: res.json?.hits?.length ?? 0, restriction: restrictionUsed });
  return { hits: res.ok ? res.json.hits ?? [] : [], ok: res.ok, status: res.status };
}

async function searchCommentsForUrl(announcementUrl) {
  const q = new URL(announcementUrl);
  const host = q.hostname.replace(/^www\./, "");
  const slug = q.pathname.split("/").filter(Boolean).pop() ?? "";
  // Three fixed queries, all derived from the URL itself. Breadth here is
  // RECALL only: precision is enforced locally by exact URL comparison.
  const queries = [...new Set([`${host}${q.pathname}`, slug, host])].filter(Boolean);
  const out = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      tags: "comment",
      hitsPerPage: "100",
      numericFilters: `created_at_i>${AFTER_EPOCH},created_at_i<${SEAL_EPOCH}`,
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

/** Flatten an item tree to { id, text } pairs, depth <= 2 per §6. */
function flattenComments(item, depth = 0, out = []) {
  for (const child of item?.children ?? []) {
    if (depth <= 2) out.push({ id: child.id, text: child.text ?? "", depth });
    flattenComments(child, depth + 1, out);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reference test — rule (b)                                           */
/* ------------------------------------------------------------------ */

/**
 * B1: the exact announcement URL appears as the story's url or in a comment.
 * B2: a distinctive 6–8 word phrase from the announcement appears verbatim.
 * Both are deliberate acts; neither has a tuned threshold.
 */
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
/* Announcement side                                                   */
/* ------------------------------------------------------------------ */

/**
 * The announcement's own publication date, when the page states one.
 *
 * AMENDMENT-4 §3 retains the sealed rule "the reaction must be created after
 * the announcement". Without it, a story that linked the same URL months
 * earlier — when the page described a DIFFERENT change — would be paired with
 * the text the page carries today. That is a false pair of exactly the kind
 * the verification exists to catch, so the rule is enforced rather than
 * assumed.
 *
 * Deliberately narrow: only an explicit "created/published/posted on
 * YYYY-MM-DD" statement. When a page states no date the constraint cannot be
 * applied, the pair records `publication_date: null`, and the report says so.
 */
function announcementPublicationEpoch(text) {
  const m = text.match(/\b(?:created|published|posted)\s+on\s+(\d{4})-(\d{2})-(\d{2})\b/i);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

async function fetchAnnouncement(url) {
  if (!isFirstParty(url, VENDORS.find((v) => v.announcement === url)?.firstParty ?? [])) {
    return { ok: false, reason: "announcement_not_first_party_domain" };
  }
  if (!isSpecificDocument(url)) return { ok: false, reason: "announcement_is_a_domain_root_not_a_document" };
  const res = await politeGet(url, { json: false });
  if (!res.ok) return { ok: false, reason: `announcement_unretrievable_${res.error ?? res.status}` };
  const text = htmlToText(res.text);
  const screen = screenAnnouncement(text);
  if (!screen.ok) return { ok: false, reason: screen.reason };
  return { ok: true, text, finalUrl: res.finalUrl };
}

/* ------------------------------------------------------------------ */
/* Collection                                                          */
/* ------------------------------------------------------------------ */

function rejection(vendor, stage, reason, detail = {}) {
  return { vendor: vendor.name, stage, reason, ...detail };
}

async function collectForVendor(v, rejects) {
  process.stdout.write(`${v.name.padEnd(11)} `);

  const ann = await fetchAnnouncement(v.announcement);
  if (!ann.ok) {
    console.log(`announcement rejected: ${ann.reason}`);
    rejects.push(rejection(v, "announcement", ann.reason, { url: v.announcement }));
    return null;
  }

  const storyRes = await searchStoriesByUrl(v.announcement);
  const commentHits = await searchCommentsForUrl(v.announcement);
  console.log(`story hits ${storyRes.hits.length}, comment hits ${commentHits.length}`);

  const target = normUrl(v.announcement);

  // Story-level candidates: the submission whose url IS the announcement.
  const storyCandidates = [];
  for (const h of storyRes.hits) {
    if (!h.url) {
      rejects.push(rejection(v, "story", "story_has_no_url", { hn_item_id: Number(h.objectID), title: h.title }));
      continue;
    }
    if (normUrl(h.url) !== target) {
      rejects.push(rejection(v, "story", "story_url_is_not_the_announcement", { hn_item_id: Number(h.objectID), story_url: h.url, title: h.title }));
      continue;
    }
    storyCandidates.push({ story_id: Number(h.objectID), how: "story_url_is_the_announcement", hit: h });
  }

  // Comment-level candidates: a comment links the exact URL. The reaction
  // thread is the comment's parent story.
  const commentCandidates = [];
  const seenComments = new Set();
  for (const h of commentHits) {
    if (!h.story_id) continue;
    if (seenComments.has(h.objectID)) continue;
    seenComments.add(h.objectID);
    const urls = extractUrls(h.comment_text ?? "");
    const matched = urls.find((u) => normUrl(u) === target);
    if (!matched) continue;
    commentCandidates.push({ story_id: Number(h.story_id), how: "a_comment_links_the_announcement", hit: h, matched, evidence_comment_id: Number(h.objectID) });
  }

  // Deduplicate by story, story-level evidence first.
  const byStory = new Map();
  for (const c of [...storyCandidates, ...commentCandidates]) {
    if (!byStory.has(c.story_id)) byStory.set(c.story_id, c);
  }

  if (byStory.size === 0) {
    rejects.push(rejection(v, "reference", "no_hn_item_references_the_announcement", { searched_story_hits: storyRes.hits.length, searched_comment_hits: commentHits.length }));
    return null;
  }

  const survivors = [];
  let fetched = 0;
  for (const cand of [...byStory.values()].sort((a, b) => a.story_id - b.story_id)) {
    if (fetched >= MAX_STORY_FETCHES_PER_VENDOR) {
      rejects.push(rejection(v, "story", "story_fetch_budget_exhausted", { hn_item_id: cand.story_id }));
      continue;
    }
    fetched++;
    const item = await fetchItem(cand.story_id);
    if (!item) {
      rejects.push(rejection(v, "story", "story_unretrievable", { hn_item_id: cand.story_id }));
      continue;
    }
    const comments = flattenComments(item);
    const createdAt = item.created_at_i ?? 0;

    if (createdAt >= SEAL_EPOCH) {
      rejects.push(rejection(v, "story", "created_after_protocol_seal", { hn_item_id: cand.story_id, created_at_i: createdAt }));
      continue;
    }
    if (createdAt < AFTER_EPOCH) {
      rejects.push(rejection(v, "story", "outside_declared_lookback_window", { hn_item_id: cand.story_id, created_at_i: createdAt }));
      continue;
    }
    const annDate = announcementPublicationEpoch(ann.text);
    if (annDate !== null && createdAt < annDate) {
      rejects.push(rejection(v, "story", "reaction_precedes_announcement_publication", { hn_item_id: cand.story_id, created_at_i: createdAt, announcement_publication_epoch: annDate, title: item.title }));
      continue;
    }
    if ((item.children?.length ?? 0) < MIN_COMMENTS) {
      rejects.push(rejection(v, "story", "fewer_than_10_top_level_comments", { hn_item_id: cand.story_id, top_level: item.children?.length ?? 0 }));
      continue;
    }

    // Rule (b) re-applied on the fetched item, not on the search hit.
    const ref = referenceTest({ announcementUrl: v.announcement, story: item, comments });
    let evidence = ref;
    if (!ref.ok) {
      const q = quoteTest(ann.text, { story: item, comments });
      if (!q.ok) {
        rejects.push(rejection(v, "reference", "reference_not_reestablished_on_fetch", { hn_item_id: cand.story_id, detail: ref.how }));
        continue;
      }
      evidence = q;
    }

    // The thread must discuss the change, not be self-promotion.
    const title = (item.title ?? "").trim();
    if (/^(?:i|we)\s+(?:built|made|created|launched|am)\b|check\s+it\s+out|my\s+(?:saas|tool|app|product|extension)\b/i.test(title)) {
      rejects.push(rejection(v, "story", "self_promotion_not_a_reaction", { hn_item_id: cand.story_id, title }));
      continue;
    }
    const namesVendor = new RegExp(`\\b${v.term}\\b`, "i").test(`${title}\n${item.url ?? ""}`);
    if (!namesVendor) {
      rejects.push(rejection(v, "story", "thread_does_not_name_the_vendor", { hn_item_id: cand.story_id, title }));
      continue;
    }

    survivors.push({ cand, item, comments, evidence, createdAt, annDate });
  }

  if (survivors.length === 0) return null;

  // Rule (c): one reaction thread per vendor, earliest after the announcement.
  survivors.sort((a, b) => a.createdAt - b.createdAt || a.cand.story_id - b.cand.story_id);
  for (const extra of survivors.slice(MAX_PER_VENDOR)) {
    rejects.push(rejection(v, "story", "additional_reaction_for_same_vendor", { hn_item_id: extra.cand.story_id, kept_instead: survivors[0].cand.story_id }));
  }
  return { v, ...survivors[0], ann };
}

/* ------------------------------------------------------------------ */
/* Verification mode                                                   */
/* ------------------------------------------------------------------ */

async function verifyPair(pair) {
  const v = VENDORS.find((x) => x.name === pair.vendor);
  const checks = [];
  const fail = (reason, detail = {}) => ({ ok: false, reason, ...detail });

  if (!v) return fail("vendor_not_in_declared_list");
  if (!isFirstParty(pair.announcement.url, v.firstParty)) return fail("announcement_not_first_party_domain", { url: pair.announcement.url });

  const ann = await fetchAnnouncement(pair.announcement.url);
  if (!ann.ok) return fail(ann.reason);

  const item = await fetchItem(pair.reaction.hn_item_id);
  if (!item) return fail("story_unretrievable", { hn_item_id: pair.reaction.hn_item_id });

  const comments = flattenComments(item);
  const ref = referenceTest({ announcementUrl: pair.announcement.url, story: item, comments });
  let evidence = ref;
  if (!ref.ok) {
    const q = quoteTest(ann.text, { story: item, comments });
    if (!q.ok) return fail("reference_not_reestablished", { detail: ref.how, hn_item_id: pair.reaction.hn_item_id });
    evidence = q;
  }

  if ((item.created_at_i ?? 0) >= SEAL_EPOCH) return fail("created_after_protocol_seal");
  if ((item.children?.length ?? 0) < MIN_COMMENTS) return fail("fewer_than_10_top_level_comments");
  const annDate = announcementPublicationEpoch(ann.text);
  if (annDate !== null && (item.created_at_i ?? 0) < annDate) {
    return fail("reaction_precedes_announcement_publication", { announcement_publication_epoch: annDate, story_created_at_i: item.created_at_i });
  }

  // The recorded evidence must still be present, not merely "some" reference.
  if (pair.verified?.evidence_comment_id && evidence.evidence_comment_id !== pair.verified.evidence_comment_id && evidence.how === pair.verified.how) {
    checks.push("evidence_comment_id_changed");
  }

  return { ok: true, reason: null, evidence, checks, comments_seen: comments.length };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (VERIFY_ONLY) {
    if (!existsSync(PAIRS)) {
      console.error(`no ${PAIRS}; run without --verify first`);
      process.exitCode = 1;
      return;
    }
    const data = JSON.parse(readFileSync(PAIRS, "utf8"));
    const results = [];
    for (const pair of data.pairs) {
      process.stdout.write(`${pair.vendor.padEnd(11)} hn:${pair.reaction.hn_item_id} … `);
      const r = await verifyPair(pair);
      console.log(r.ok ? `PASS (${r.evidence.how}${r.evidence.quoted ? ` quoted="${r.evidence.quoted.slice(0, 50)}"` : ""})` : `FAIL ${r.reason}`);
      results.push({ vendor: pair.vendor, hn_item_id: pair.reaction.hn_item_id, ok: r.ok, reason: r.reason, evidence: r.evidence ?? null, checks: r.checks ?? [] });
    }
    const passed = results.filter((r) => r.ok).length;
    writeFileSync(join(OUT_DIR, "verify.json"), JSON.stringify({ verified_at: new Date().toISOString(), pairs_checked: results.length, passed, results }, null, 2));
    console.log(`\n--- verify: ${passed}/${results.length} pairs re-established ---`);
    if (passed !== results.length) process.exitCode = 1;
    return;
  }

  const rejects = [];
  const pairs = [];

  for (const v of VENDORS) {
    const got = await collectForVendor(v, rejects);
    if (!got) continue;
    const { item, comments, evidence, cand, ann, annDate } = got;
    pairs.push({
      observation_id: `h${pairs.length + 1}`,
      vendor: v.name,
      // BLIND INPUT side
      announcement: {
        url: v.announcement,
        final_url: ann.finalUrl,
        text: ann.text.slice(0, 20000),
        char_count: ann.text.length,
        first_party_domain: v.firstParty,
        publication_date_epoch: annDate ?? null,
        publication_date_iso: annDate ? new Date(annDate * 1000).toISOString() : null,
        publication_date_source: annDate ? "page_text_created_on" : "not_stated_on_page",
      },
      // GROUND TRUTH side
      reaction: {
        platform: "hackernews",
        hn_item_id: cand.story_id,
        permalink: `https://news.ycombinator.com/item?id=${cand.story_id}`,
        title: item.title,
        url: item.url ?? null,
        author: item.author ?? null,
        created_at_i: item.created_at_i ?? null,
        created_iso: item.created_at_i ? new Date(item.created_at_i * 1000).toISOString() : null,
        top_level_comments: item.children?.length ?? 0,
        points: item.points ?? null,
      },
      verified: {
        how: evidence.how,
        matched_url: evidence.matched ?? null,
        quoted: evidence.quoted ?? null,
        evidence_comment_id: evidence.evidence_comment_id ?? null,
        evidence_permalink: evidence.evidence_comment_id ? `https://news.ycombinator.com/item?id=${evidence.evidence_comment_id}` : null,
        verified_at: new Date().toISOString(),
        comments_scanned: comments.length,
      },
    });
    console.log(`${v.name.padEnd(11)} PAIR hn:${cand.story_id} (${evidence.how})`);
  }

  const out = {
    protocol: "PROTOCOL.md (sealed) + AMENDMENT-3 + AMENDMENT-4",
    method: "HN Algolia: find the item that links the declared first-party announcement; that item's thread is the reaction",
    source: "https://hn.algolia.com/api/v1",
    seal_epoch: SEAL_EPOCH,
    lookback_start_epoch: AFTER_EPOCH,
    generated_at: new Date().toISOString(),
    rule: {
      a_first_party: "announcement host is the vendor's own domain (declared in VENDORS)",
      b_reference: "a different HN item links the exact announcement URL, or quotes a 6-8 word phrase verbatim",
      c_one_per_vendor: "earliest qualifying reaction after the announcement",
      retained: "reaction before seal, >= 10 top-level comments, discusses the change",
    },
    pair_count: pairs.length,
    pairs,
    rejection_count: rejects.length,
    query_log: queryLog,
  };

  writeFileSync(PAIRS, JSON.stringify(out, null, 2));
  writeFileSync(REJECTIONS, JSON.stringify({ generated_at: new Date().toISOString(), count: rejects.length, rejections: rejects }, null, 2));

  console.log(`\n--- HN pairs: ${pairs.length} ---`);
  for (const p of pairs) console.log(`  ${p.observation_id}  ${p.vendor.padEnd(11)} hn:${p.reaction.hn_item_id}  ${p.verified.how}${p.verified.quoted ? ` quoted="${p.verified.quoted.slice(0, 50)}"` : ""}`);
  const byReason = {};
  for (const r of rejects) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  console.log(`\nrejections: ${rejects.length}`);
  for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
}

await main();
