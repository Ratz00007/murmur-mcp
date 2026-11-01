/**
 * MurmurBench-0 — r2 final verification (no network): re-establish every r2
 * pair's evidence from the stored artifacts exactly as fetch-hn-pairs.mjs
 * --verify does, then rewrite bench/data-hn/verify-r2.json with the outcome.
 *
 * For each pair in bench/data-hn/pairs-r2.json:
 *   - load announcements/<id>.txt and reactions/<id>.json (full HN item tree);
 *   - B1: the reaction story's url IS the announcement URL, or a comment in
 *     the tree (depth <= 2) links it exactly (normalised);
 *   - B2: otherwise, a distinctive 6-8 word phrase from the announcement text
 *     appears verbatim in the story title or a comment;
 *   - re-check: >= 10 top-level comments, reaction before 2026-10-29,
 *     reaction on/after the announcement publication date (when stated).
 * A pair whose recorded evidence cannot be re-established from the stored
 * artifacts is marked FAIL and reported — never downgraded or dropped
 * silently.
 *
 * Usage: node bench/verify-r2-final.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlToText, distinctivePhrases } from "./lib/announcement-screen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "data-hn");
const CUTOFF_EPOCH = Date.UTC(2026, 9, 29) / 1000;

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

function extractUrls(text) {
  const plain = htmlToText(text ?? "");
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  return [...plain.matchAll(re)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
}

function flattenComments(item, depth = 0, out = []) {
  for (const child of item?.children ?? []) {
    if (depth <= 2) out.push({ id: child.id, text: child.text ?? "", depth });
    flattenComments(child, depth + 1, out);
  }
  return out;
}

function referenceTest({ announcementUrl, story, comments }) {
  const target = normUrl(announcementUrl);
  if (story?.url && normUrl(story.url) === target) {
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

const data = JSON.parse(readFileSync(join(OUT, "pairs-r2.json"), "utf8"));
const results = [];
let failures = 0;

function fail(id, vendor, reason, checks) {
  failures++;
  results.push({ observation_id: id, vendor, status: "FAIL", reason, checks });
  console.log(`${id} ${vendor.padEnd(14)} FAIL ${reason}`);
}

for (const p of data.pairs) {
  const id = p.observation_id;
  const checks = [];
  const annPath = join(OUT, "announcements", `${id}.txt`);
  const reactPath = join(OUT, "reactions", `${id}.json`);

  if (!existsSync(annPath)) { fail(id, p.vendor, "missing_announcement_file", checks); continue; }
  if (!existsSync(reactPath)) { fail(id, p.vendor, "missing_reaction_file", checks); continue; }
  const annText = readFileSync(annPath, "utf8");
  const item = JSON.parse(readFileSync(reactPath, "utf8"));
  const comments = flattenComments(item);

  // First-party domain (mechanical, against the recorded allow-list).
  const host = new URL(p.announcement.url).hostname.toLowerCase().replace(/^www\./, "");
  const firstParty = p.announcement.first_party_domain.some((d) => host === d || host.endsWith(`.${d}`));
  checks.push({ check: "announcement_first_party_domain", ok: firstParty });
  if (!firstParty) { fail(id, p.vendor, "announcement_not_first_party_domain", checks); continue; }

  // Reference re-established from stored artifacts.
  const ref = referenceTest({ announcementUrl: p.announcement.url, story: item, comments });
  let evidence = ref;
  if (!ref.ok) {
    const q = quoteTest(annText, { story: item, comments });
    if (!q.ok) { fail(id, p.vendor, `reference_not_reestablished (${ref.how})`, checks); continue; }
    evidence = q;
  }
  checks.push({ check: "reference_established", ok: true, detail: { how: evidence.how, matched: evidence.matched ?? null, quoted: evidence.quoted ?? null, evidence_comment_id: evidence.evidence_comment_id ?? null } });
  // Counts and dates.
  const top = item.children?.length ?? 0;
  checks.push({ check: "top_level_comments_gte_10", ok: top >= 10, detail: top });
  if (top < 10) { fail(id, p.vendor, "fewer_than_10_top_level_comments", checks); continue; }
  const createdAt = item.created_at_i ?? 0;
  const beforeCutoff = createdAt < CUTOFF_EPOCH;
  checks.push({ check: "reaction_before_2026_10_29", ok: beforeCutoff, detail: item.created_at });
  if (!beforeCutoff) { fail(id, p.vendor, "reaction_created_on_or_after_2026_10_29", checks); continue; }
  const annDate = p.announcement.publication_date_epoch;
  const afterAnn = annDate === null || annDate === undefined ? "not_enforceable_date_unstated" : createdAt >= annDate;
  checks.push({ check: "reaction_after_announcement_publication", ok: afterAnn, detail: { announcement_publication_iso: p.announcement.publication_date_iso, reaction_created_iso: p.reaction.created_iso } });
  if (afterAnn === false) { fail(id, p.vendor, "reaction_precedes_announcement_publication", checks); continue; }

  // The recorded verification must agree with the re-established evidence.
  const recorded = p.verification;
  const agrees = recorded && (recorded.type === (evidence.how === "quotes_the_announcement" ? "verbatim_quote" : "url_link"));
  checks.push({ check: "recorded_verification_agrees", ok: Boolean(agrees) });
  if (!agrees) { fail(id, p.vendor, "recorded_verification_disagrees_with_reestablished_evidence", checks); continue; }

  results.push({ observation_id: id, vendor: p.vendor, status: "PASS", evidence: { type: recorded.type, how: evidence.how, matched_url: evidence.matched ?? null, quoted: evidence.quoted ?? null, evidence_comment_id: evidence.evidence_comment_id ?? null, evidence_permalink: evidence.evidence_comment_id ? `https://news.ycombinator.com/item?id=${evidence.evidence_comment_id}` : null }, comments_scanned: comments.length, checks });
  console.log(`${id} ${p.vendor.padEnd(14)} PASS (${evidence.how}${evidence.quoted ? ` quoted="${evidence.quoted.slice(0, 50)}"` : ""})`);
}

const out = {
  verified_at: new Date().toISOString(),
  method: "no-network re-verification from stored artifacts (bench/data-hn/announcements/<id>.txt + reactions/<id>.json), same tests as fetch-hn-pairs.mjs --verify",
  pairs_checked: results.length,
  passed: results.filter((r) => r.status === "PASS").length,
  failed: failures,
  results,
};
writeFileSync(join(OUT, "verify-r2.json"), JSON.stringify(out, null, 2));
console.log(`\n--- verify: ${out.passed}/${results.length} pairs re-established from stored artifacts ---`);
if (failures > 0) process.exitCode = 1;
