/**
 * MurmurBench-0 — fetch the announcement artifacts (the BLIND INPUT).
 *
 * Retrieval compliance (PROTOCOL AMENDED 3): this is the HOST fetching, which
 * is exactly what seed_add_url already does and what an MCP client does
 * natively. Murmur's server gains no fetch capability and the zero-network
 * guarantee is untouched. The extracted text is handed to the engine.
 *
 * This script also VERIFIES each pair: the announcement must actually be a
 * first-party announcement ABOUT THE SAME CHANGE as the reaction thread. A
 * pricing page or an unrelated vendor page is dropped, because a mismatched
 * pair would silently turn the benchmark into noise.
 *
 * The reaction title is used for matching ONLY. It is never included in the
 * blind input: it is a bystander's framing, and handing it to an arm would
 * leak the reaction it is supposed to predict.
 *
 * Usage: node bench/fetch-announcement.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const pairsPath = join(HERE, "data-pairs", "pairs.json");
const raw = JSON.parse(readFileSync(pairsPath, "utf8"));
// Always re-run from the unverified selection. A partial run must not leave
// stale verified pairs behind, and re-running must be idempotent.
const data = {
  ...raw,
  pairs: raw.pairs.filter((p) => !p.announcement?.text),
  announcement_fetch_log: [],
  dropped: (raw.dropped ?? []).filter((d) => d.query !== "announcement_fetch"),
};
const UA = "murmur-bench/0.1 (non-commercial research evaluation)";

/** Strip tags/scripts to plain text without pulling in an HTML parser dep. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&hellip;/g, "…")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Announcement must read as first-party AND be about a change. */
const ANNOUNCE_VERBS = /\b(increas\w*|rais(?:e|ed|ing|es)|hike[ds]?|bump(?:ed|s)?|announc\w*|deprecat\w*|discontinu\w*|sunset\w*|remov(?:e|ed|al|ing)|chang(?:e|ed|ing)|updat(?:e|ed|ing)|adjust\w*|revok\w*|overhaul\w*|effective)\b/i;
const FIRST_PARTY = /\b(we|our|us)\b/i;
/**
 * Commercial-page tells. Matched against the document BODY, and only
 * meaningful when a real ratio of the page is marketing copy — a price
 * announcement legitimately contains words like "pricing" and even
 * "price list", so keyword presence alone must not reject it.
 */
const LANDING_MARKERS =
  /\b(sign up|get started|subscribe now|start free trial|add to cart|buy now|contact sales|book a demo|currently-sold|currently sold|price history|buying guide|compare prices|shop now|free shipping|browse deals|our best sellers|customer reviews)\b/gi;

/** A vendor price-adjustment notice is a legitimate announcement. These are not. */
const LANDING_TITLE = /^\s*(deals?|buy|shop|products?|catalog|pricing table|compare)\b/i;

function landingRatio(text) {
  const hits = (text.match(LANDING_MARKERS) ?? []).length;
  return hits / Math.max(1, text.length / 1000); // markers per 1k chars
}

/**
 * Read the document's opening, which is where an announcement states what
 * changed. A catalog or comparison page opens with inventory ("178
 * currently-sold drives", "Hard drives 178 SSDs 106"), an announcement opens
 * with the change. Long pages dilute any keyword ratio, so the leading
 * window is what gets screened.
 */
const HEAD_CHARS = 2500;
function screenHead(text) {
  const head = text.slice(0, HEAD_CHARS);
  if (LANDING_TITLE.test(head)) return { ok: false, reason: "vendor_landing_or_catalog_page_not_an_announcement" };
  if (landingRatio(head) > 2) return { ok: false, reason: "vendor_landing_or_catalog_page_not_an_announcement" };
  // Inventory/catalog openings: counts of SKUs, "per 1k chars"-style density.
  const inventory = (head.match(/\b\d{2,}\s+(?:currently-sold|sold|available|drives|ssds|devices|items|products)\b/gi) ?? []).length;
  if (inventory > 0) return { ok: false, reason: "vendor_catalog_inventory_opening" };
  return { ok: true, reason: null };
}

/**
 * An announcement must (a) be first-party, (b) state a change, (c) not be a
 * commercial landing page, and (d) actually be ABOUT a change rather than a
 * price list. A product catalog, price table, or comparison tool fails even
 * when it contains a vendor name and many prices, because there is no
 * announced change to react to.
 */
function screenAnnouncementDoc(url, text) {
  if (text.length < 300) return { ok: false, reason: "announcement_too_short_after_extraction" };
  const head = screenHead(text);
  if (!head.ok) return head;
  // The change statement must be near the TOP, not buried in a footer.
  const headText = text.slice(0, HEAD_CHARS * 2);
  if (!FIRST_PARTY.test(headText)) return { ok: false, reason: "not_first_party_voice" };
  if (!ANNOUNCE_VERBS.test(headText)) return { ok: false, reason: "no_announcement_verb_in_document" };
  return { ok: true, reason: null };
}

/**
 * Verify the announcement is about the SAME CHANGE as the reaction thread.
 *
 * Token overlap alone is far too weak: a NAS hard-drive comparison site passed
 * on the shared token "drive" while announcing nothing whatsoever. The
 * reaction must share a token that identifies the ACTOR (the vendor) or the
 * ACT (the specific change), and generic commerce words are not evidence.
 */
const GENERIC = new Set([
  "price", "prices", "pricing", "increase", "raises", "change", "changes", "changed", "update", "updates",
  "announce", "announces", "announced", "cost", "costs", "plan", "plans", "month", "monthly", "year", "annual",
  "new", "old", "users", "customer", "customers", "account", "better", "with", "from", "about", "just", "like",
  "here", "they", "this", "that", "have", "been", "will", "your", "their", "more", "less", "good", "bad",
  "drive", "drives", "ssd", "ssds", "nas", "hdd", "hdds", "hardware", "device", "devices", "product", "products",
  "tool", "tools", "site", "website", "page", "blog", "home", "deals", "deals", "price", "comparison", "compare",
  "server", "servers", "cloud", "storage", "traffic", "bandwidth", "support", "docs", "help", "about", "contact",
]);

/**
 * Verify the announcement is about the SAME CHANGE as the reaction thread.
 *
 * Token overlap alone is far too weak, and a purely generic stop-list was not
 * enough either: a NAS hard-drive comparison site passed on the shared token
 * "drive" and announced nothing whatsoever. Two requirements therefore:
 *
 *   1. at least one non-generic shared token identifying the actor or act, AND
 *   2. the shared token must also appear in the announcement's OPENING, where
 *      the change is stated — a word that only occurs in a footer or a product
 *      table is not evidence that the same change is being discussed.
 */
function verifyMatch(reactionTitle, annText) {
  const head = annText.slice(0, HEAD_CHARS * 2);
  const words = reactionTitle.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const evidence = [];
  for (const w of words) {
    if (GENERIC.has(w)) continue;
    const rx = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (rx.test(head)) evidence.push(w);
  }
  if (evidence.length === 0) {
    return { ok: false, reason: "no_non_generic_shared_token_in_announcement_opening" };
  }
  return { ok: true, reason: null, evidence: [...new Set(evidence)] };
}

async function fetchAnnouncement(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!res.ok) return { ok: false, reason: `announcement_unretrievable_http_${res.status}`, text: "" };
    const ct = res.headers.get("content-type") ?? "";
    if (!/html|text|plain|json/i.test(ct)) return { ok: false, reason: `announcement_unretrievable_content_type_${ct}`, text: "" };
    const body = await res.text();
    return { ok: true, reason: null, text: htmlToText(body), final_url: res.url };
  } catch (err) {
    return { ok: false, reason: `announcement_unretrievable_${err.message}`, text: "" };
  }
}

const results = [];
for (const pair of data.pairs) {
  const { url } = pair.announcement;
  process.stdout.write(`${pair.observation_id} ${new URL(url).hostname} … `);
  const got = await fetchAnnouncement(url);
  if (!got.ok) { console.log(got.reason); results.push({ id: pair.observation_id, ok: false, reason: got.reason }); await sleep(2000); continue; }

  const doc = screenAnnouncementDoc(url, got.text);
  if (!doc.ok) { console.log(doc.reason); results.push({ id: pair.observation_id, ok: false, reason: doc.reason }); await sleep(2000); continue; }

  const match = verifyMatch(pair.reaction.title, got.text);
  if (!match.ok) { console.log(`match: ${match.reason}`); results.push({ id: pair.observation_id, ok: false, reason: match.reason }); await sleep(2000); continue; }

  pair.announcement.text = got.text.slice(0, 20000);
  pair.announcement.final_url = got.final_url;
  pair.announcement.char_count = got.text.length;
  pair.verified = { evidence: match.evidence, verified_at: new Date().toISOString() };
  console.log(`OK ${got.text.length} chars, evidence=[${match.evidence.join(",")}]`);
  results.push({ id: pair.observation_id, ok: true, chars: got.text.length, evidence: match.evidence });
  await sleep(2500);
}


data.pairs = data.pairs.filter((p) => p.announcement.text);
data.pair_count = data.pairs.length;
data.dropped.push(...results.filter((r) => !r.ok).map((r) => ({ query: "announcement_fetch", id: r.id, reason: r.reason })));
writeFileSync(pairsPath, JSON.stringify(data, null, 2));

console.log(`\n--- verified pairs: ${data.pairs.length}/${data.target_n} ---`);
for (const p of data.pairs) console.log(`  ${p.observation_id}  ${p.announcement.host}  ${p.announcement.char_count} chars  r/${p.reaction.subreddit}`);
