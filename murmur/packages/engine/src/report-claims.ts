/**
 * Numeric claim integrity.
 *
 * The report's citation integrity already refuses a fabricated post id. It did
 * NOT check a single NUMBER: `report.ts` instructs the model "every number you
 * state must come from the stats pack" and "never invent numbers", and nothing
 * enforced either. A draft could state any figure it liked in the executive
 * summary, a finding, a risk rationale or the trajectory, and it would be
 * rendered verbatim into a dashboard a founder might screenshot into a board
 * deck.
 *
 * This module makes that instruction binding. Every numeric token in the
 * narrative must resolve to a value the engine actually computed, within a
 * tolerance. Anything else is an unverified claim and is rejected with a
 * surgical message naming the field, the number, and what was available.
 *
 * The design choice that matters: this is ALLOWLIST-SHAPED. The verifier is
 * given the set of facts the report may talk about, gathered from the same
 * `collectReportData` the renderers use, so the two can never disagree about
 * what is true. It does not attempt to judge whether a number is a *sensible*
 * thing to say — only whether it is a number this run produced.
 */
import type { ReportData } from "./report.js";
import { engagementScore } from "./util/engagement.js";

/**
 * Numbers that are structural rather than statistical: the round count, the
 * severity vocabulary, ordinals, and the version/seed identifiers. These are
 * legitimately hardcoded in prose and are not claims about the run.
 */
const STRUCTURAL = new Set([
  1,
  2,
  3,
  4,
  5, // exactly 3 risks, up to 4 recommendations, etc.
  10,
  100, // percentages and per-100 normalisations
]);

export interface NumericClaim {
  /** Which field of the draft the number appeared in. */
  ref: string;
  /** The literal token as written. */
  token: string;
  /** The numeric value. */
  value: number;
}

/**
 * Identifier-shaped tokens that contain digits but make no claim about the run.
 *
 * The `po_12` case is the obvious one, but usernames are worse: a persona
 * handle is interpolated straight into the narrative, so a run with a persona
 * called `@grace6` produced the token "6" and the verifier rejected a
 * perfectly correct draft. Post authors appear as `u/ines8` and `@elena4`.
 */
const ID_TOKEN = /\b(?:po|ev|p|e|rel|mem|rp|t|sd|w|cm|r)_?\d+\b/gi; // po_12, p3, r1
// `@handle` or `/u/handle` or `u/handle`. The alternatives are listed
// separately rather than as `[@/u]` — inside a character class `u` is a
// LITERAL, so `[@\/u]` matches any word containing the letter u and shredded
// "simulated" into "sim" + "ulated", silently swallowing the numbers after it.
const HANDLE = /(?:@[A-Za-z][\w.-]*|\/?u\/[A-Za-z][\w.-]*)/g;
const ROUND_REF = /\br(?:ound)?\s*[-_]?\d+\b/gi; // r3, round 3, r-3
const BAND_LABEL = /\bP(?:10|50|90)\b/gi;

/** Extract numeric tokens, ignoring ids, handles, round refs, and versions. */
export function extractNumbers(
  text: string,
): { token: string; value: number }[] {
  if (!text) return [];
  const cleaned = text
    // Usernames first: `u/ines8` contains a slash-handle, and `@grace6` a
    // dotted handle. Both are interpolated persona identifiers, not claims.
    .replace(HANDLE, " ")
    .replace(ID_TOKEN, " ")
    .replace(ROUND_REF, " ")
    .replace(BAND_LABEL, " ")
    .replace(/\bv?\d+\.\d+\.\d+\b/g, " ") // semver
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ") // dates
    .replace(/\b\d{1,2}:\d{2}\b/g, " "); // times
  const out: { token: string; value: number }[] = [];
  for (const m of cleaned.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    const token = m[0];
    const value = Number(token.replace(/,/g, ""));
    if (Number.isFinite(value)) out.push({ token, value });
  }
  return out;
}

/**
 * The set of facts the report is allowed to assert, gathered from the same
 * data the renderers use.
 */
export function allowedNumbers(
  d: ReportData,
  rounds: number,
  population: number,
): number[] {
  const vals = new Set<number>([rounds, population, 0, 1, 2, 3]);
  const push = (v: number | undefined | null) => {
    if (typeof v === "number" && Number.isFinite(v)) vals.add(v);
  };

  push(d.totalPosts);
  push(d.totalEng);
  push(d.rows.length);
  push(d.injections.length);
  push(d.focusCurve.length);
  push(d.trends.length);
  push(d.moments.length);
  push(d.chains.length);
  push(d.amp.viralPosts.length);
  push(d.cross.rows.length);
  push(d.cross.maxDivergence?.value ?? null);
  push(d.controversy.score);
  push(d.controversy.drivers.length);
  push(d.factions.polarization);
  push(d.factions.factions.length);
  push(d.arcs.length);
  push(d.mom.firstHalf);
  push(d.mom.secondHalf);
  push(d.mom.pct);
  push(d.projection?.slope ?? null);
  // Entity and persona counts: the scenario recap legitimately states "N
  // personas across M ontology entities", and both appear in the stats pack.
  push(d.entities.length);
  push(d.personas.length);

  for (const f of d.factions.factions) {
    push(f.size);
    push(f.share);
    push(f.posts);
    push(f.engagement);
    push(f.avgStance);
    push(f.quotes.length);
    push(f.leaders.length);
    push(f.sentimentByRound.length);
    for (const r of f.sentimentByRound) push(r.value);
  }
  for (const t of d.trends) {
    push(t.first);
    push(t.last);
    push(t.delta);
    push(t.volume);
    push(t.peakRound);
  }
  for (const a of d.arcs) {
    push(a.posts);
    push(a.engagement);
    push(a.focusStart);
    push(a.focusEnd);
    push(a.delta);
  }
  for (const c of d.chains) {
    push(c.depth);
    push(c.finalSentiment);
    push(c.severity);
    push(c.participants.length);
  }
  for (const v of d.amp.viralPosts) {
    push(v.engagement);
    push(v.round);
    push(v.amplifiers.length);
  }
  for (const r of d.cross.rows) {
    push(r.twitter);
    push(r.reddit);
    push(r.divergence);
    push(r.twPosts);
    push(r.rdPosts);
  }
  for (const c of d.cross.totals ? Object.values(d.cross.totals) : []) push(c);
  for (const row of d.rows) {
    push(row.round);
    push(row.twitter);
    push(row.reddit);
    push(row.engagement);
    push(row.escalations);
    push(row.injections);
    push(row.lurkers);
    for (const e of Object.values(row.sentimentByEntity)) push(e);
  }
  for (const e of d.focusCurve) push(e.value);
  for (const b of d.sensitivity ?? []) {
    push(b.p10);
    push(b.p50);
    push(b.p90);
  }
  for (const p of d.projection?.points ?? []) push(p.value);
  for (const e of d.entities) {
    push(e.salience);
    push(d.mentionCount(e.id));
  }
  // Per-post sentiment and engagement. The risk register is explicitly
  // required to cite concrete posts with their scores, and the quote bank and
  // post index already render these, so excluding them would reject a draft
  // that only says things the report itself displays.
  for (const p of d.posts) {
    for (const m of p.mentions ?? []) push(m.score);
    push(engagementScore(p.metrics));
  }
  for (const q of [
    ...d.quotes.positive,
    ...d.quotes.negative,
    ...d.quotes.mixed,
  ]) {
    push(q.sentiment);
    push(q.engagement);
  }

  return [...vals];
}

/**
 * Round to a precision that absorbs formatting differences: the report prints
 * 0.42 where the engine holds 0.4249, and "24,000" where the engine holds
 * 24000. Anything within this tolerance counts as the same fact.
 */
function near(value: number, allowed: number[], tol: number): boolean {
  for (const a of allowed) {
    const scale = Math.max(1, Math.abs(a));
    if (Math.abs(value - a) <= tol * scale) return true;
  }
  return false;
}

export interface ClaimVerdict {
  ok: boolean;
  claims: NumericClaim[];
  unverified: NumericClaim[];
  /** A short, renderable list of what the run actually contains, for retries. */
  available: string;
}

/**
 * Verify every numeric claim in the narrative fields of a draft.
 *
 * `strict` is false while a draft is still being iterated, so callers can
 * report without rejecting; the server rejects on strict.
 */
export function verifyNumericClaims(
  d: ReportData,
  draft: {
    executiveSummary?: string;
    trajectory?: string;
    scenarioRecap?: string;
    keyFindings?: string[];
    risks?: { rationale?: string; title?: string }[];
    confidence?: { strongSignals?: string[]; contested?: string[] };
  },
  meta: { rounds: number; population: number },
  { tolerance = 0.02 }: { tolerance?: number } = {},
): ClaimVerdict {
  const allowed = allowedNumbers(d, meta.rounds, meta.population);

  const fields: { ref: string; text: string }[] = [
    { ref: "executiveSummary", text: draft.executiveSummary ?? "" },
    { ref: "trajectory", text: draft.trajectory ?? "" },
    { ref: "scenarioRecap", text: draft.scenarioRecap ?? "" },
  ];
  for (const [i, f] of (draft.keyFindings ?? []).entries()) {
    fields.push({ ref: `keyFindings[${i}]`, text: String(f ?? "") });
  }
  for (const [i, r] of (draft.risks ?? []).entries()) {
    fields.push({ ref: `risks[${i}].rationale`, text: r?.rationale ?? "" });
    fields.push({ ref: `risks[${i}].title`, text: r?.title ?? "" });
  }
  for (const [i, s] of (draft.confidence?.strongSignals ?? []).entries()) {
    fields.push({
      ref: `confidence.strongSignals[${i}]`,
      text: String(s ?? ""),
    });
  }
  for (const [i, s] of (draft.confidence?.contested ?? []).entries()) {
    fields.push({ ref: `confidence.contested[${i}]`, text: String(s ?? "") });
  }

  const claims: NumericClaim[] = [];
  const unverified: NumericClaim[] = [];
  for (const f of fields) {
    for (const { token, value } of extractNumbers(f.text)) {
      const claim: NumericClaim = { ref: f.ref, token, value };
      claims.push(claim);
      if (STRUCTURAL.has(value)) continue;
      // Percentages and thousands-separated counts are the same fact scaled.
      const candidates = [value, value / 100, value * 100, Math.round(value)];
      const ok =
        candidates.some((c) => near(c, allowed, tolerance)) ||
        near(value, allowed, tolerance) ||
        // A percentage is legitimate if the underlying ratio is real.
        (Math.abs(value) <= 100 &&
          allowed.some((a) => Math.abs(a - value / 100) <= tolerance));
      if (!ok) unverified.push(claim);
    }
  }

  const available = [
    `posts=${d.totalPosts}`,
    `engagement=${d.totalEng}`,
    `rounds=${meta.rounds}`,
    `population=${meta.population}`,
    d.controversy ? `controversy=${Math.round(d.controversy.score)}` : "",
    d.mom?.pct !== undefined ? `momentum=${Math.round(d.mom.pct)}%` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return { ok: unverified.length === 0, claims, unverified, available };
}
