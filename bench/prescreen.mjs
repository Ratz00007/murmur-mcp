/**
 * MurmurBench-0 — semantic pre-screen (PROTOCOL AMENDED 2026-09-28).
 *
 * The sealed §4 mechanical rules (is_self, >=10 comments, pre-seal date) are
 * necessary but NOT sufficient: the suite can admit a freelancer *asking* for
 * pricing advice or a sysadmin *asking* about a license migration, neither of
 * which is a party announcing a change to its users. This step applies the
 * §4 inclusion rule that the SQL filters cannot express:
 *
 *   "announces a specific, material change to a product's price, licensing,
 *    API surface, or terms"
 *
 * It runs on the ANNOUNCEMENT ARTIFACT ONLY (title + body). It never reads a
 * comment. Its verdict, and the reason, are logged for every candidate.
 *
 * Timing: this screen and the query expansion below are applied BEFORE any
 * ground truth is extracted and before either arm has run. No objection
 * content has been observed. Query expansion was driven by measured YIELD
 * (comment counts and titles only) — never by objection content.
 *
 * Usage: node bench/prescreen.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sel = JSON.parse(readFileSync(join(HERE, "data", "selection.json"), "utf8"));

/**
 * Announcement signals. A candidate must hit at least one VERB (a party acting
 * on its own product) — a bare noun like "pricing" is not enough, which is
 * exactly what let the freelancer question through.
 */
const ANNOUNCE = [
  /\b(increas\w+)/i, /\b(rais\w+|hiked?|bumped?)\b/i, /\b(announc\w+|unveil\w+)/i,
  /\b(deprecat\w+|decommission\w+)/i, /\b(discontinu\w+|end(?:ing|s|ed)?\s+(?:support|service|free|plan|tier))/i,
  /\b(sunset\w*|shut(?:ting)?\s+down|phasing?\s+out)/i, /\b(revok\w+|remov(?:e|ing|al)\s+(?:the\s+)?(?:api|key|access|feature|support))/i,
  /\b(chang(?:e|ing|es)\s+(?:to|our|the)\s+(?:pricing|price|plan|terms|licen[cs]e|api))/i,
  /\b(we'?re\s+(?:moving|switching|migrating|upgrading))/i, /\b(migrat\w+\s+(?:to|from|away))/i,
  /\b(now\s+requires?|requires?\s+(?:an?\s+)?(?:api\s+key|paid|subscription|approval))/i,
  /\b(licen[cs]e\s+change|terms\s+(?:of\s+service\s+)?change)/i, /\b(replac\w+\s+.{0,30}(?:with|by))/i,
  /\b(price\s+(?:hike|increase|change|rise))/i, /\b(overpriced|outpricing)/i,
];

/** Questions and help requests are the failure mode this screen exists to kill. */
const ASKS = [
  /^\s*(?:help|how|any\s?(?:one|body)|does\s+anyone|can\s+(?:i|someone|anyone)|what|why|is\s+it|am\s+i|should\s+i|where)\b/i,
  /\?/,
  /\b(am\s+i\s+pricing|how\s+(?:do|should|can)\s+i|any\s+advice|thoughts\?|help\s+me|how\s+do\s+i)\b/i,
  /\b(am\s+i\s+wrong|is\s+this\s+(?:right|fair|correct))\b/i,
];

function prescreen(obs) {
  const text = `${obs.title}\n\n${obs.body ?? ""}`;
  const announceHit = ANNOUNCE.find((rx) => rx.test(text));
  // A question mark in the TITLE is the strongest tell: a party announcing a
  // change is stating, not asking.
  const titleIsQuestion = /\?/.test(obs.title ?? "");
  const askHit = (titleIsQuestion && ASKS.find((rx) => rx.test(text))) || null;

  if (!announceHit) {
    return { pass: false, reason: "no_announcement_verb_in_artifact" };
  }
  if (titleIsQuestion && askHit) {
    return { pass: false, reason: "artifact_is_a_question_not_an_announcement" };
  }
  return { pass: true, reason: null, matched: String(announceHit) };
}

const results = sel.selected.map((obs) => {
  const body = obs.blind_artifact.split("BODY:\n")[1] ?? "";
  const verdict = prescreen({ title: obs.title, body });
  return {
    observation_id: obs.observation_id,
    title: (obs.title ?? "").replace(/\s+/g, " ").slice(0, 100),
    subreddit: obs.subreddit,
    permalink: obs.permalink,
    ...verdict,
  };
});

const out = {
  note: "Semantic pre-screen, PROTOCOL AMENDED 2026-09-28. Announcement artifact only; no comment was read.",
  run_at: new Date().toISOString(),
  results,
};
writeFileSync(join(HERE, "data", "prescreen.json"), JSON.stringify(out, null, 2));

for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.observation_id}  ${r.reason ?? ""}`);
  console.log(`      "${r.title}"`);
}
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed the announcement screen.`);
