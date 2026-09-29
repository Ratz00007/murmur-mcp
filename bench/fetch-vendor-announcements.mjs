/**
 * MurmurBench-0 — announcement fetch and pair verification.
 *
 * The vendor-anchored selection pairs a reaction thread with a declared
 * announcement URL, but the declaration can be wrong: a bystander post about a
 * data-purge incident gets paired with the vendor's price-adjustment page, and
 * a thread about an open letter gets paired with a blog index. Both would be
 * silently false pairs, and a false pair makes the recall number meaningless
 * because the arm is answering about a different change than the one that
 * provoked the reaction.
 *
 * So every pair is verified here, by fetching the announcement and requiring
 * that it actually be a first-party statement ABOUT THE SAME CHANGE. Anything
 * that fails is dropped with a reason and logged.
 *
 * Retrieval compliance: this is the HOST fetching, exactly as seed_add_url
 * already does. The engine gains no network capability.
 *
 * Usage: node bench/fetch-vendor-announcements.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAIRS = join(HERE, "data-vendor", "pairs.json");
const UA = "murmur-bench/0.1 (non-commercial research evaluation)";
const HEAD_CHARS = 2500;

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
    .replace(/&#x27;/g, "'").replace(/&ndash;/g, "-").replace(/&mdash;/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Generic commerce and index pages are never a specific announcement.
 *
 * Note the earlier version of this regex rejected the ONLYOFFICE and Flathub
 * posts, which are specific, first-party, and correct. A vendor post that
 * happens to say "all posts" in its sidebar is not an index page, so the test
 * is on the page's dominant content, not on the presence of navigation words.
 */
/**
 * Commerce furniture. NOT a rejection on its own.
 *
 * This started as a primary screen and was wrong twice. It first rejected the
 * ONLYOFFICE and Flathub posts, which are specific and correct, because their
 * sidebars contain "all posts". It then still rejected the Bitwarden
 * premium-plan announcement — a first-party statement of a price change —
 * because the plan table says "Get Started Free".
 *
 * So it is now only a tie-breaker. A first-party document that speaks in the
 * vendor's voice about its own offering AND states a concrete change is an
 * announcement, whatever its navigation furniture says.
 */
const COMMERCE_WORDS =
  /\b(sign up|get started|start free trial|add to cart|contact sales|book a demo|our best sellers|compare prices|shop now)\b/i;
/** Reporting and advocacy are reactions, not the party's own announcement. */
const THIRD_PARTY =
  /\b(according to|reportedly|sources (?:say|says)|has confirmed|have confirmed|is expected to|said in a statement|sign letter|open letter|petition|we demand|join the call)\b/i;
/** Vendor must speak about its own offering. */
const FIRST_PARTY_OWN =
  /\b(we|our|us)\b(?=[^.?!]{0,80}\b(price[sd]?|pricing|plan[s]?|licen[cs]e|licensing|api|terms|policy|customers?|users?|developers?|service|subscription|account|platform|product|billing|refund|storage|traffic|bandwidth|compliance|disclosure|abuse|incident)\b)/i;
/**
 * The vendor must state a concrete change. This is the primary screen.
 *
 * The tense matters and the first version got it wrong. A live announcement
 * says "we are increasing prices"; an EFFECTIVE one — Hetzner's actual page —
 * says "the price adjustment took effect for new orders starting 15 June". Both
 * are legitimate announcements and both are the announcement you would have
 * held before reacting, so both must pass. A screen that only recognises
 * future-tense change language silently rejects the majority of real
 * announcements, which are already in effect.
 */
const STATES_A_CHANGE =
  /\b(we (?:are|'re|will be|have been|have now|had) (?:increasing|raised?|raising|removing|removed|changed|changing|updated|updating|deprecat\w*|discontinued|ending|ended|disabling|revoked|revoking|added|adding|introduced|introducing|migrated|migrating|rolled back|rolling back)|price[s]? (?:increase|hike|change|rise|adjustment)|new pricing|updated pricing|pricing (?:update|change)|effective (?:immediately|from|on)|took effect|takes effect|comes? into effect|is now|are now|end of life|\beol\b|no longer|now requires?|is being (?:removed|retired|discontinued|withdrawn)|as of (?:today|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}))\b/i;
/**
 * An index page lists many items and states no single change. Detected by
 * density of post headings in the opening, which a single announcement does not
 * have.
 */
function looksLikeIndex(text) {
  const head = text.slice(0, HEAD_CHARS * 2);
  const dated = (head.match(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/gi) ?? []).length;
  const readMore = (head.match(/\b(read more|continue reading|view all|see all|load more|all posts|back to blog|recent posts)\b/gi) ?? []).length;
  return dated >= 3 || readMore >= 2;
}

function screenAnnouncement(annText) {
  if (annText.length < 400) return { ok: false, reason: "announcement_too_short_after_extraction" };
  const head = annText.slice(0, HEAD_CHARS * 2);
  if (looksLikeIndex(annText)) return { ok: false, reason: "index_or_archive_page_not_a_specific_announcement" };
  if (THIRD_PARTY.test(head.slice(0, 1800))) return { ok: false, reason: "third_party_report_not_first_party_announcement" };
  if (!FIRST_PARTY_OWN.test(head)) return { ok: false, reason: "no_first_party_voice_about_its_own_offering" };
  // Primary test: a change is actually stated. A commercial page can satisfy
  // everything above and still state nothing, so commerce words only matter
  // when no change is declared.
  if (!STATES_A_CHANGE.test(head)) {
    if (COMMERCE_WORDS.test(head)) return { ok: false, reason: "commercial_or_catalog_page_not_an_announcement" };
    return { ok: false, reason: "no_concrete_change_stated" };
  }
  return { ok: true, reason: null };
}


async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!res.ok) return { ok: false, reason: `announcement_unretrievable_http_${res.status}`, text: "" };
    return { ok: true, reason: null, text: htmlToText(await res.text()), final_url: res.url };
  } catch (e) {
    return { ok: false, reason: `announcement_unretrievable_${e.message}`, text: "" };
  }
}

/** Tokens that identify the ACT, not generic commerce vocabulary. */
const GENERIC = new Set([
  "price", "prices", "pricing", "increase", "raises", "raise", "change", "changes", "changed", "update", "updates",
  "announce", "announces", "announced", "cost", "costs", "plan", "plans", "month", "monthly", "year", "annual",
  "new", "old", "users", "user", "customer", "customers", "account", "better", "with", "from", "about", "just",
  "like", "here", "they", "this", "that", "have", "been", "will", "your", "their", "more", "less", "good", "bad",
  "drive", "drives", "ssd", "ssds", "nas", "hdd", "hdds", "hardware", "device", "devices", "product", "products",
  "tool", "tools", "site", "website", "page", "blog", "home", "deals", "comparison", "compare", "server", "servers",
  "cloud", "storage", "traffic", "bandwidth", "support", "docs", "help", "contact", "data", "delete", "deleted",
]);

/**
 * The reaction must REFERENCE the announcement.
 *
 * Two previous tests were both wrong, and the second one is the interesting
 * failure. Checking that the reaction and announcement shared topical terms let
 * through a Hetzner thread about a DATA-PURGE INCIDENT paired with a
 * price-adjustment page (matched on the word "last"), and a Proton thread
 * comparing Tuta and Proton for private mail paired with a price-change post
 * (matched on "email", "mail", "private"). Shared vocabulary between a vendor
 * and a community thread is nearly always incidental; it is not evidence that
 * the thread is about the change.
 *
 * What IS evidence: the thread links the announcement, or quotes a distinctive
 * phrase from it verbatim. That is a deliberate act by the commenter, it cannot
 * happen by accident, and it needs no tuned threshold.
 */
function reactionReferencesAnnouncement(pair, annText) {
  const rx = `${pair.reaction.title}\n${pair.reaction.selftext ?? ""}`;

  // (a) The thread links the announcement (or its canonical form).
  const annUrl = (pair.announcement.final_url ?? pair.announcement.url).replace(/\/+$/, "");
  const host = new URL(annUrl).hostname.replace(/^www\./, "");
  const linked = rx.includes(annUrl) || rx.includes(pair.announcement.url);
  // A bare vendor blog root is too weak to count as a link to a specific post.
  const linkedSpecific = linked && !/^https?:\/\/[^/]+\/?$/.test(annUrl);
  if (linkedSpecific) return { ok: true, how: "thread_links_the_announcement" };

  // (b) The thread quotes a distinctive phrase from the announcement verbatim.
  const phrases = distinctivePhrases(annText);
  const quoted = phrases.filter((p) => rx.toLowerCase().includes(p));
  if (quoted.length > 0) {
    return { ok: true, how: "thread_quotes_the_announcement", quoted: quoted.slice(0, 3) };
  }
  return { ok: false, how: "reaction_does_not_reference_the_announcement", phrases_considered: phrases.length, vendor_host: host };
}

/**
 * Distinctive phrases from the announcement: long word sequences from the
 * change-stating sentences, lowercased. A 6-word run is long enough that a
 * community post reproducing it is quoting, not coinciding.
 */
function distinctivePhrases(annText) {
  const head = annText.slice(0, HEAD_CHARS * 2);
  const sentences = head.split(/(?<=[.!?])\s+/).filter((s) => s.length > 60);
  const out = new Set();
  for (const s of sentences) {
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let n = 8; n >= 6; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const phrase = words.slice(i, i + n).join(" ");
        if (phrase.split(" ").length === n) out.add(phrase);
      }
    }
  }
  return [...out].slice(0, 400);
}

const raw = JSON.parse(readFileSync(PAIRS, "utf8"));
const data = {
  ...raw,
  pairs: raw.pairs.filter((p) => !p.announcement?.text),
  announcement_fetch_log: [],
  dropped: (raw.dropped ?? []).filter((d) => d.query !== "announcement_fetch"),
};
const kept = [];

for (const pair of raw.pairs) {
  if (pair.announcement?.text) { kept.push(pair); continue; }
  const { url } = pair.announcement;
  process.stdout.write(`${pair.observation_id} ${pair.vendor.padEnd(12)} ${new URL(url).hostname.padEnd(24)} … `);

  const got = await fetchText(url);
  if (!got.ok) { console.log(got.reason); data.announcement_fetch_log.push({ id: pair.observation_id, ok: false, reason: got.reason }); await sleep(2500); continue; }

  const doc = screenAnnouncement(got.text);
  if (!doc.ok) { console.log(doc.reason); data.announcement_fetch_log.push({ id: pair.observation_id, ok: false, reason: doc.reason }); await sleep(2500); continue; }

  const match = reactionReferencesAnnouncement(pair, got.text);
  if (!match.ok) {
    console.log(`${match.how} (${match.phrases_considered} phrases considered)`);
    data.announcement_fetch_log.push({ id: pair.observation_id, ok: false, reason: `reaction_mismatch_${match.how}` });
    await sleep(2500);
    continue;
  }

  pair.announcement.text = got.text.slice(0, 20000);
  pair.announcement.final_url = got.final_url;
  pair.announcement.char_count = got.text.length;
  pair.verified = { how: match.how, quoted: match.quoted ?? null, verified_at: new Date().toISOString() };
  kept.push(pair);
  console.log(`OK ${got.text.length} chars, reaction ${match.how}${match.quoted ? ` quoted="${match.quoted[0].slice(0, 60)}"` : ""}`);
  data.announcement_fetch_log.push({ id: pair.observation_id, ok: true, chars: got.text.length, how: match.how });
  await sleep(3000);
}

data.pairs = kept;
data.pair_count = kept.length;
data.dropped.push(...data.announcement_fetch_log.filter((r) => !r.ok).map((r) => ({ query: "announcement_fetch", id: r.id, reason: r.reason })));
mkdirSync(join(HERE, "data-vendor"), { recursive: true });
writeFileSync(PAIRS, JSON.stringify(data, null, 2));

console.log(`\n--- verified pairs: ${kept.length}/${data.target_n} ---`);
for (const p of kept) {
  console.log(`  ${p.observation_id}  ${p.vendor.padEnd(12)} ${String(p.announcement.char_count).padStart(6)} chars  r/${p.reaction.subreddit}  ${p.reaction.num_comments}c`);
}

