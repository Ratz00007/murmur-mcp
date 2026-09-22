/**
 * Deterministic lexical sentiment scoring. No LLM, no network — a compact
 * curated lexicon with negation and intensifier handling, tuned for
 * tech-community language. Scores are bounded [-1, 1] via tanh.
 */
import type { Entity } from "./types.js";

const LEXICON: Record<string, number> = {
  // positive
  love: 3, loved: 3, great: 2, amazing: 3, awesome: 3, excellent: 3, good: 1, nice: 1, helpful: 2,
  impressed: 2, impressive: 2, excited: 2, exciting: 2, win: 2, winning: 2, improved: 2, improve: 2,
  fair: 2, transparent: 2, fast: 1, clean: 1, elegant: 2, best: 2, favorite: 2, recommend: 2,
  recommended: 2, thanks: 1, glad: 2, happy: 2, thrilled: 3, solid: 1, reliable: 2, trust: 2,
  trusted: 2, respect: 2, genius: 3, brilliant: 3, clever: 2, affordable: 2, generous: 2, free: 1,
  forward: 1, promising: 2, hopeful: 2, welcome: 1, useful: 2, intuitive: 2, seamless: 2, smooth: 2,
  upgrade: 1, delight: 3, delighted: 3, perfect: 3, killer: 2, underrated: 2, champion: 2, support: 1,
  // negative
  hate: -3, hated: -3, terrible: -3, awful: -3, worst: -3, bad: -1, broken: -2, buggy: -2,
  expensive: -2, overpriced: -3, paywall: -3, greedy: -3, scam: -3, lie: -3, lying: -3, lied: -3,
  disappointed: -2, disappointing: -2, frustrated: -2, frustrating: -2, slow: -1, confusing: -2,
  unfair: -2, backlash: -3, cancel: -2, cancelled: -2, angry: -3, outrage: -3, ripoff: -3,
  "rip-off": -3, "dark pattern": -3, locked: -2, downgrade: -2, chaos: -2, delay: -1, delayed: -1,
  promise: 0, "broke promise": -3, misleading: -3, deceptive: -3, shady: -2, sketchy: -2,
  worried: -2, worry: -2, risk: -1, risky: -2, concerned: -2, sucks: -3, suck: -3, trash: -3,
  garbage: -3, disaster: -3, nightmare: -3, mess: -2, regression: -2, deprecated: -1,
  forced: -2, mandatory: -1, hidden: -1, surprise: -1, bait: -2, "switch": -1, churn: -2,
  lawsuit: -3, fired: -2, layoff: -2, layoffs: -2, outage: -2, compromised: -3, breach: -3,
};

const INTENSIFIERS = new Set(["very", "extremely", "really", "super", "insanely", "totally", "absolutely", "so", "utterly", "incredibly"]);
const DOWNTONERS = new Set(["slightly", "somewhat", "a", "bit", "kinda", "mildly", "arguably"]);
const NEGATORS = new Set(["not", "no", "never", "isn't", "wasn't", "don't", "doesn't", "didn't", "can't", "won't", "wouldn't", "couldn't", "aren't", "not_"]);

export interface SentimentResult {
  score: number; // [-1, 1]
  hits: number;
}

export function scoreSentiment(text: string): SentimentResult {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let raw = 0;
  let hits = 0;
  let negated = 0;
  let multiplier = 1;
  for (const w of words) {
    if (NEGATORS.has(w)) {
      negated = 3;
      continue;
    }
    if (INTENSIFIERS.has(w)) {
      multiplier = 1.5;
      continue;
    }
    if (DOWNTONERS.has(w)) {
      multiplier = 0.6;
      continue;
    }
    const base = LEXICON[w];
    if (base !== undefined && base !== 0) {
      let v = base * multiplier;
      if (negated > 0) v = -v;
      raw += v;
      hits++;
      multiplier = 1;
    }
    if (negated > 0) negated--;
    if (INTENSIFIERS.has(w) || DOWNTONERS.has(w)) {
      // multiplier consumed only by the next sentiment word
    } else {
      multiplier = 1;
    }
  }
  // multi-word phrase pass (e.g. "dark pattern", "rip-off" handled by tokenization)
  const joined = text.toLowerCase();
  for (const [phrase, v] of Object.entries(LEXICON)) {
    if (phrase.includes(" ") && joined.includes(phrase)) {
      raw += v;
      hits++;
    }
  }
  const score = hits === 0 ? 0 : Math.tanh(raw / 3);
  return { score: clampScore(score), hits };
}

function clampScore(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

export interface Mention {
  entityId: string;
  score: number;
}

/** Which entities does this text mention, and what sentiment does the text carry? */
export function entityMentions(text: string, entities: Entity[]): Mention[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const globalScore = scoreSentiment(text).score;
  const out: Mention[] = [];
  for (const e of entities) {
    const name = e.name.trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}($|[^a-z0-9])`, "i");
    if (re.test(lower)) {
      out.push({ entityId: e.id, score: round2(globalScore) });
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
