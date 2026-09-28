/**
 * MurmurBench-0 — linked-pair selection (PROTOCOL AMENDED 3).
 *
 * The corpus problem AMENDMENT 3 addresses: Reddit is dense with people
 * REACTING and thin on parties ANNOUNCING. So we no longer try to find an
 * announcement inside a Reddit post. We take the Reddit post as the REACTION
 * and require it to resolve to a real, first-party ANNOUNCEMENT elsewhere.
 *
 *   announcement  vendor blog / changelog / pricing page  -> blind input
 *   reaction      Reddit thread                          -> ground truth
 *
 * A reaction thread qualifies only if it LINKS to a resolvable first-party
 * announcement, or names a vendor whose official announcement is resolvable by
 * a pre-registered lookup. This script selects candidate PAIRS and records
 * both the reaction and the announcement URL. It never reads a comment body.
 *
 * Linking preference order (fixed in advance, first that resolves wins):
 *   1. link-post whose url is on the vendor's own domain (is_self = false and
 *      the domain is NOT reddit/self)  — the thread links the announcement.
 *   2. self-post that names a vendor AND contains an absolute URL to a
 *      non-reddit domain.
 *   3. self-post that names a vendor from a pre-registered official-announcement
 *      index (e.g. gitlab.com/blog, kernel.org) with no URL in the post.
 *
 * Vendor identification uses ONLY the post title/body and the link domain. It
 * never inspects comments.
 *
 * Usage: node bench/select-pairs.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchPostsByPhrase } from "./lib/arctic-shift.mjs";
import { screenAnnouncement } from "./lib/prescreen.mjs";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESET = process.argv.includes("--reset");

/**
 * PROTOCOL.md §4 as amended 2026-09-28 / amended 3.
 *
 * The original five queries were drawn before any retrieval was tested. They
 * yielded 3 candidates, 0 of which passed the announcement screen: dev
 * workflow subreddits (r/programming, r/webdev) are where people ASK about
 * pricing, not where companies announce it. Under AMENDMENT 3 the requirement
 * is different again — the reaction thread only has to LINK to a first-party
 * announcement, so what matters is a high rate of vendor-linked threads.
 *
 * Subreddits were re-chosen on measured yield (comment counts, titles, and
 * link domains only; no comment body and no objection content was read).
 * Expanded to 14 because the one-pair-per-query cap left the target
 * unreachable: 8 queries yielded 5 candidates, of which the announcement and
 * match screens correctly rejected 3 (an affiliate link, a pricing page
 * behind a 403, and a drive-comparison catalog).
 */
/**
 * PROTOCOL.md �4 as amended 2026-09-28 / amended 3, then widened again after
 * the provenance screen.
 *
 * Under AMENDMENT 3 the reaction thread only has to LINK to a first-party
 * announcement. Measured yield is low because most threads link to news
 * articles about a change rather than the change itself � which is the whole
 * reason the provenance screen exists. Subreddits were chosen on measured
 * yield (comment counts, titles, link domains only; no comment body and no
 * objection content was read at any point).
 *
 * r/gaming and r/CordCutters are included for VOLUME but yield almost entirely
 * news links (videogameschronicle, gamingbible, mp1st, nintendolife,
 * pushsquare), all correctly rejected by the provenance screen. r/linux and
 * r/selfhosted yield the most genuine vendor announcements because software
 * vendors publish their own changelogs and licence notices.
 */
const QUERIES = [
  { subreddit: "linux", title: "license" },
  { subreddit: "linux", title: "telemetry" },
  { subreddit: "selfhosted", title: "price" },
  { subreddit: "sysadmin", title: "price" },
  { subreddit: "SaaS", title: "pricing" },
  { subreddit: "smallbusiness", title: "subscription" },
  { subreddit: "startups", title: "pricing" },
  { subreddit: "programming", title: "deprecat" },
  { subreddit: "privacy", title: "telemetry" },
  { subreddit: "opensourcesucks", title: "license" },
  { subreddit: "linux", title: "terms" },
  { subreddit: "fedora", title: "telemetry" },
  { subreddit: "gaming", title: "price" },
  { subreddit: "CordCutters", title: "price" },
  { subreddit: "raspberry_pi", title: "price" },
];

const TARGET_N = 5;
/**
 * Candidate pairs are collected well past TARGET_N because the announcement
 * and match screens reject most of them (403s, affiliate links, catalog
 * pages). select-pairs.mjs therefore keeps the FIRST N_CANDIDATES_PER_QUERY
 * resolving candidates from each query, and the verified set is whatever
 * survives fetch-announcement.mjs. Capping candidates at N=5 starved the
 * pipeline: 2 queries produced 5 candidates and 3 were rejected, leaving 2.
 */
const N_CANDIDATES_PER_QUERY = 6;
const MIN_COMMENTS = 10;
const SEAL_EPOCH = 1790560176;
const LOOKBACK_DAYS = 365;
const AFTER_EPOCH = SEAL_EPOCH - LOOKBACK_DAYS * 86400;

/** Non-vendor link targets: link aggregators and social front-ends. */
const NOT_VENDOR =
  /(^|\.)(reddit\.com|redd\.it|twitter\.com|x\.com|news\.ycombinator\.com|linkedin\.com|facebook\.com|youtube\.com|github\.com|tiktok\.com|instagram\.com|medium\.com|substack\.com)$/i;

/**
 * Third-party publishers and aggregators. A news article ABOUT a price hike
 * is a REACTION, not the ANNOUNCEMENT. Linking one would collapse the two
 * artifacts this protocol exists to separate, and would hand the blind input
 * a bystander's framing of the change — which is exactly the leak AMENDMENT 3
 * was written to prevent.
 *
 * Observed: 5 of 5 r/CordCutters candidates linked deadline.com, awfulannouncing.com,
 * hollywoodreporter.com, and variety.com. All were reactions.
 */
const THIRD_PARTY = new Set([
  "deadline.com", "awfulannouncing.com", "hollywoodreporter.com", "variety.com", "theverge.com",
  "techcrunch.com", "arstechnica.com", "engadget.com", "wired.com", "zdnet.com", "cnet.com",
  "tomsguide.com", "pcworld.com", "pcmag.com", "howtogeek.com", "androidauthority.com", "9to5mac.com",
  "9to5google.com", "macrumors.com", "neowin.net", "betanews.com", "servethehome.com", "anandtech.com",
  "tomshardware.com", "gizmodo.com", "lifehacker.com", "businessinsider.com", "forbes.com", "bloomberg.com",
  "reuters.com", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "wsj.com", "ft.com", "economist.com",
  "theguardian.com", "independent.co.uk", "telegraph.co.uk", "dailymail.co.uk", "newsweek.com", "time.com",
  "ycombinator.com", "slashdot.org", "lwn.net", "theregister.com", "heise.de", "golem.de", "heise.de",
  "gigaom.com", "venturebeat.com", "theinformation.com", "paywall.com", "medium.com", "substack.com",
  "wikipedia.org", "quora.com", "linkedin.com", "twitter.com", "x.com", "facebook.com", "youtube.com",
  "serpspur.com", "kommz.fr", "franklymail.com", "patreon.com", "ko-fi.com", "buymeacoffee.com",
  "amazon.com", "ebay.com", "aliexpress.com", "etsy.com", "walmart.com", "target.com", "bestbuy.com",
  "refurbished.com", "newegg.com", "backmarket.com", "slickdeals.net", "reddit.com", "redd.it",
]);

/** A host is first-party when the announcement is published BY the vendor. */
function isFirstPartyHost(host) {
  if (!host) return false;
  if (NOT_VENDOR.test(host)) return false;
  if (THIRD_PARTY.has(host.toLowerCase())) return false;
  return true;
}

/** An announcement lives on a blog/docs/pricing path, or is the vendor root. */
const ANNOUNCEMENT_PATH_HINT = /\/(blog|changelog|news|announce|press|release|update|pricing|price|docs|legal|terms|policy|post)/i;
const MIN_TITLE_LEN = 25;

function urlsIn(text) {
  return [...(text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi) ?? [])].map((m) => m[0].replace(/[.,;:]+$/, ""));
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; }
}

function isAnnouncementUrl(u) {
  const h = hostOf(u);
  if (!h) return false;
  if (!isFirstPartyHost(h)) return false;
  let path = "";
  try { path = new URL(u).pathname; } catch { /* keep empty */ }
  // Vendor root with a referral/affiliate parameter is a landing page, not an
  // announcement. Observed: hostinger.com/?REFERRALCODE=...
  if (/\/$/.test(path) && /[?&](ref|referral|aff|affiliate|via|utm_|gclid|fbclid)=/i.test(u)) return false;
  return ANNOUNCEMENT_PATH_HINT.test(path) || path === "/" || path === "";
}

/**
 * The reaction thread must be a REACTION, not an announcement. It qualifies
 * only by linking to a FIRST-PARTY announcement.
 * Returns {announcementUrl, kind} or null.
 */
function resolveAnnouncement(p) {
  // Rule 1: link post straight to the vendor's own announcement.
  if (!p.is_self && p.url && isAnnouncementUrl(p.url)) {
    return { announcementUrl: p.url, kind: "link_post_to_first_party_announcement" };
  }
  // Rule 2: self post carrying an absolute first-party announcement URL.
  const urls = urlsIn(`${p.title ?? ""}\n${p.selftext ?? ""}`);
  const hit = urls.find(isAnnouncementUrl);
  if (hit) return { announcementUrl: hit, kind: "self_post_with_first_party_announcement_url" };
  return null;
}

function reactionVerdict(p) {
  if (p.removed_by_category || p.removed_by) return "removed_or_quarantined";
  if ((p.num_comments ?? 0) < MIN_COMMENTS) return "fewer_than_10_comments";
  if (p.created_utc >= SEAL_EPOCH) return "created_after_protocol_seal";
  if (p.created_utc < AFTER_EPOCH) return "outside_declared_lookback_window";
  if ((p.title ?? "").length < MIN_TITLE_LEN) return "title_too_short_to_identify_a_change";
  return null;
}

async function main() {
  if (RESET) rmSync(join(HERE, "data-pairs"), { recursive: true, force: true });
  mkdirSync(join(HERE, "data-pairs"), { recursive: true });

  const candidatePairs = [];
  const dropped = [];
  const queryLog = [];

  for (const q of QUERIES) {
    if (candidatePairs.length >= TARGET_N * 3) break;
    const label = `r/${q.subreddit} "${q.title}"`;
    process.stdout.write(`${label} … `);
    const { posts, status } = await searchPostsByPhrase(q.subreddit, q.title, {
      limit: 100,
      afterEpoch: AFTER_EPOCH,
    });
    let linked = 0, notLinked = 0;
    console.log(`${posts.length} candidates`);

    let fromThisQuery = 0;
    for (const p of posts) {
      if (fromThisQuery >= N_CANDIDATES_PER_QUERY) break;
      const base = { query: label, id: p.id, title: (p.title ?? "").replace(/\s+/g, " ").slice(0, 90), num_comments: p.num_comments };

      const r = reactionVerdict(p);
      if (r) { dropped.push({ ...base, reason: r }); continue; }

      const res = resolveAnnouncement(p);
      if (!res) { notLinked++; dropped.push({ ...base, reason: "no_resolvable_announcement" }); continue; }
      linked++;

      fromThisQuery++;
      candidatePairs.push({
        observation_id: `p${candidatePairs.length + 1}`,
        query: label,
        // GROUND TRUTH side
        reaction: {
          platform: "reddit",
          permalink: `https://www.reddit.com${p.permalink}`,
          link_id: p.id,
          subreddit: p.subreddit,
          created_utc: p.created_utc,
          created_iso: new Date(p.created_utc * 1000).toISOString(),
          num_comments: p.num_comments,
          title: p.title,
          selftext: p.selftext ?? "",
        },
        // BLIND INPUT side
        announcement: {
          url: res.announcementUrl,
          host: hostOf(res.announcementUrl),
          linked_kind: res.kind,
          // The Reddit post's framing of the change is part of the input only
          // if it came FROM the vendor. For a link post the vendor text is the
          // linked page; the Reddit title is a reaction, so it is EXCLUDED
          // from the blind input and kept only for matching.
          text: null, // filled by fetch-announcement.mjs
        },
        // Overlap of topic words, used later to verify the pair is the same change.
        match_hints: (p.title ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
      });
    }

    queryLog.push({ query: label, http_status: status, candidates: posts.length, linked_to_announcement: linked, no_resolvable_announcement: notLinked });
    await sleep(2500);
  }

  const out = {
    protocol: "PROTOCOL.md (sealed e700a3e, amended 79045c2/42ef5d5/7157960)",
    seal_epoch: SEAL_EPOCH,
    lookback_days: LOOKBACK_DAYS,
    generated_at: new Date().toISOString(),
    target_n: TARGET_N,
    candidate_count: candidatePairs.length,
    query_log: queryLog,
    pairs: candidatePairs,
    dropped,
  };

  writeFileSync(join(HERE, "data-pairs", "pairs.json"), JSON.stringify(out, null, 2));

  console.log(`\n--- pairs sealed ---`);
  console.log(`candidate pairs: ${candidatePairs.length} (target verified N=${TARGET_N})   dropped: ${dropped.length}`);
  for (const p of candidatePairs) {
    console.log(`  ${p.observation_id}  r/${p.reaction.subreddit.padEnd(13)} ${String(p.reaction.num_comments).padStart(4)}c`);
    console.log(`       announcement: ${p.announcement.url.slice(0, 90)}`);
  }
  const byReason = {};
  for (const d of dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  console.log(`\ndrops by reason:`);
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}

await main();



