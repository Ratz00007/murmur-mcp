/**
 * MurmurBench-0 — announcement text screen, shared by the AMENDMENT-4 HN
 * pipeline.
 *
 * This is a transcription of the tests already used by
 * `fetch-vendor-announcements.mjs`, moved into a module so the HN pipeline can
 * apply the SAME bar without importing a script that runs on import. The
 * tests themselves are unchanged: a valid announcement is first-party, speaks
 * about the vendor's own offering, and states a concrete change. The history
 * of why each test is shaped this way is documented at length in
 * `fetch-vendor-announcements.mjs` and is not repeated here.
 *
 * The point of keeping the bar identical: switching the reaction source must
 * not quietly lower the standard for what counts as an announcement.
 */

export function htmlToText(html) {
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

const HEAD_CHARS = 2500;

const COMMERCE_WORDS =
  /\b(sign up|get started|start free trial|add to cart|contact sales|book a demo|our best sellers|compare prices|shop now)\b/i;

const THIRD_PARTY =
  /\b(according to|reportedly|sources (?:say|says)|has confirmed|have confirmed|is expected to|said in a statement|sign letter|open letter|petition|we demand|join the call)\b/i;

const FIRST_PARTY_OWN =
  /\b(we|our|us)\b(?=[^.?!]{0,80}\b(price[sd]?|pricing|plan[s]?|licen[cs]e|licensing|api|terms|policy|customers?|users?|developers?|service|subscription|account|platform|product|billing|refund|storage|traffic|bandwidth|compliance|disclosure|abuse|incident)\b)/i;

const STATES_A_CHANGE =
  /\b(we (?:are|'re|will be|have been|have now|had) (?:increasing|raised?|raising|removing|removed|changed|changing|updated|updating|deprecat\w*|discontinued|ending|ended|disabling|revoked|revoking|added|adding|introduced|introducing|migrated|migrating|rolled back|rolling back)|price[s]? (?:increase|hike|change|rise|adjustment)|new pricing|updated pricing|pricing (?:update|change)|effective (?:immediately|from|on)|took effect|takes effect|comes? into effect|is now|are now|end of life|\beol\b|no longer|now requires?|is being (?:removed|retired|discontinued|withdrawn)|as of (?:today|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}))\b/i;

function looksLikeIndex(text) {
  const head = text.slice(0, HEAD_CHARS * 2);
  const dated = (head.match(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/gi) ?? []).length;
  const readMore = (head.match(/\b(read more|continue reading|view all|see all|load more|all posts|back to blog|recent posts)\b/gi) ?? []).length;
  return dated >= 3 || readMore >= 2;
}

/** Returns { ok: true, reason: null } or { ok: false, reason }. */
export function screenAnnouncement(annText) {
  if (annText.length < 400) return { ok: false, reason: "announcement_too_short_after_extraction" };
  const head = annText.slice(0, HEAD_CHARS * 2);
  if (looksLikeIndex(annText)) return { ok: false, reason: "index_or_archive_page_not_a_specific_announcement" };
  if (THIRD_PARTY.test(head.slice(0, 1800))) return { ok: false, reason: "third_party_report_not_first_party_announcement" };
  if (!FIRST_PARTY_OWN.test(head)) return { ok: false, reason: "no_first_party_voice_about_its_own_offering" };
  if (!STATES_A_CHANGE.test(head)) {
    if (COMMERCE_WORDS.test(head)) return { ok: false, reason: "commercial_or_catalog_page_not_an_announcement" };
    return { ok: false, reason: "no_concrete_change_stated" };
  }
  return { ok: true, reason: null };
}

/**
 * Distinctive 6–8 word phrases from the change-stating part of an announcement.
 * Identical construction to `distinctivePhrases` in
 * `fetch-vendor-announcements.mjs`: a 6-word run is long enough that a
 * community member reproducing it is quoting, not coinciding.
 */
export function distinctivePhrases(annText) {
  const head = annText.slice(0, HEAD_CHARS * 2);
  const sentences = head.split(/(?<=[.!?])\s+/).filter((s) => s.length > 60);
  const out = new Set();
  for (const s of sentences) {
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let n = 8; n >= 6; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        out.add(words.slice(i, i + n).join(" "));
      }
    }
  }
  return [...out].slice(0, 400);
}
