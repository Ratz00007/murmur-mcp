/**
 * MurmurBench-0 — Step 2b: extract ground-truth objections.
 *
 * Applies the FROZEN rubric from PROTOCOL.md §6. The rubric and the prompt are
 * transcribed from the sealed protocol and must not be tuned. Whatever this
 * produces is the answer key, and neither arm has been run yet.
 *
 * The one judgement call that cannot be delegated: this file DRAFTS the
 * objections and a human (or a later reviewer) audits every one. The audit file
 * is written so a second person can check each extraction against the
 * comments that support it. At N=5 there is no excuse for sampling — the
 * protocol requires a full audit, and the agreement rate is reported.
 *
 * A real Reddit username is never a persona and never appears in an objection
 * label. Ground truth is about which complaints arose, not who made them.
 *
 * Usage: node bench/extract-ground-truth.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RX = join(HERE, "data-vendor", "reactions");
const PAIRS = join(HERE, "data-vendor", "pairs.json");
const OUT = join(HERE, "data-vendor", "ground-truth");
mkdirSync(OUT, { recursive: true });

const data = JSON.parse(readFileSync(PAIRS, "utf8"));

/**
 * PROTOCOL.md §6, verbatim. An objection is a specific, actionable complaint or
 * concern about the announced change, raised by at least one commenter.
 */
const RUBRIC = `
An OBJECTION is a specific, actionable complaint or concern ABOUT THE ANNOUNCED CHANGE,
raised by at least one commenter. Label each in 3-10 words.

EXCLUDE from the ground truth:
  - general approval without a specific concern
  - jokes, memes, meta-commentary about the subreddit
  - off-topic replies
  - opinions about something other than the change
  - speculation about post-announcement events that do not concern the change
  - personal anecdotes with no critique of the change

Return JSON: {"objections": [{"label": "...", "evidence_comment_ids": ["..."], "paraphrase": "..."}]}

Return only objections supported by at least one specific comment. If there are fewer
than 3, return what exists. Do not pad.
`.trim();

/**
 * Deterministic keyword screen used ONLY to surface candidate comments for
 * human review. It is deliberately permissive: this is a drafting aid, and
 * §6 requires a full hand audit, so a missed candidate is caught by the audit
 * and a spurious candidate is discarded there.
 *
 * This is NOT the extraction. The extraction is the judgement recorded in
 * ground-truth/*.json, and every entry there must cite a comment id.
 */
const SIGNAL = /\b(will|won't|cannot|can't|can't afford|breaking|breaks|broken|forced|migrat|lock[ -]?in|switch|alternativ|competitor|protest|complain|angry|outrage|drop|abandon|churn|cancel|switching|riots?|hike|increase|price|expensive|free tier|loss of|remove|removal|deadline|risk|unacceptable|unfair|scam|disappoint|confus|regress|paywall|limit|throttl|surveil|telemetry|privacy|trust|support|backward|incompatib|sunset|eol|deprecat|no longer|unavailable|downtime|outage|data loss|security|vulnerab|compliance|legal|licen[cs]e|fees?|billing|refund|charge|subscription|vendor|lock|sunk|switching cost|migration cost)\w*/gi;

const STOP_COMMENT = /^(?:deleted|removed|\[removed\]|this comment was deleted)/i;

for (const pair of data.pairs) {
  const id = pair.observation_id;
  const rxPath = join(RX, `${id}.json`);
  if (!existsSync(rxPath)) {
    console.log(`${id}  no reaction file, skipping`);
    continue;
  }
  const rx = JSON.parse(readFileSync(rxPath, "utf8"));

  // Candidate shortlist: comments carrying objection vocabulary, best-scoring
  // first, capped so the audit stays reviewable at N=5.
  const candidates = rx.comments
    .filter((c) => !STOP_COMMENT.test(c.body))
    .map((c) => {
      const hits = [...new Set((c.body.match(SIGNAL) ?? []).map((w) => w.toLowerCase()))];
      return { ...c, signals: hits, signalCount: hits.length };
    })
    .filter((c) => c.signalCount > 0)
    .sort((a, b) => b.signalCount - a.signalCount || b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 40);

  writeFileSync(
    join(OUT, `${id}.candidates.json`),
    JSON.stringify(
      {
        observation_id: id,
        vendor: pair.vendor,
        permalink: pair.reaction.permalink,
        announcement_url: pair.announcement.final_url ?? pair.announcement.url,
        total_comments: rx.comments.length,
        rubric: RUBRIC,
        candidates: candidates.map((c) => ({ id: c.id, score: c.score, signals: c.signals, body: c.body })),
      },
      null,
      2,
    ),
  );

  console.log(`${id}  ${pair.vendor.padEnd(11)} ${String(rx.comments.length).padStart(4)} comments -> ${candidates.length} candidates for audit`);
}

console.log(`
--- next step is JUDGEMENT, not automation ---
The rubric is frozen and the candidate shortlists are written. Each objection in
ground-truth/<id>.json must be recorded by a human reviewer with:
  label, evidence_comment_ids (must exist in the candidates file), paraphrase
and optionally an "announcement_preempts: true" flag when the vendor's own
announcement already states or answers that objection.
`);
