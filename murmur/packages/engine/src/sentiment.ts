/**
 * Deterministic lexical sentiment scoring. No LLM, no network — a compact
 * curated lexicon with negation and intensifier handling, tuned for
 * tech-community language. Scores are bounded [-1, 1] via tanh.
 */
import type { Entity } from "./types.js";

const LEXICON: Record<string, number> = {
  // positive
  love: 3, loved: 3, loves: 3, loving: 3, lovely: 2, great: 2, amazing: 3, awesome: 3, excellent: 3,
  good: 1, nice: 1, helpful: 2, impressed: 2, impressive: 2, excited: 2, exciting: 2, win: 2,
  winning: 2, improved: 2, improve: 2, fix: 2, fixed: 2, fixes: 2, fixing: 1, solve: 1, solved: 2,
  solves: 2, resolved: 2, fair: 2, transparent: 2, fast: 1, clean: 1, elegant: 2, best: 2,
  favorite: 2, recommend: 2, recommended: 2, thanks: 1, glad: 2, happy: 2, thrilled: 3, solid: 1,
  reliable: 2, reliability: 2, stable: 2, stability: 2, dependable: 2, trust: 2, trusted: 2,
  respect: 2, deserve: 1, deserves: 1, deserved: 1, genius: 3, brilliant: 3, clever: 2, affordable: 2,
  generous: 2, free: 1, forward: 1, promising: 2, hopeful: 2, welcome: 1, useful: 2, intuitive: 2,
  seamless: 2, smooth: 2, upgrade: 1, delight: 3, delighted: 3, perfect: 3, killer: 2, underrated: 2,
  champion: 2, support: 1, renew: 1, renews: 1, renewed: 1, renewal: 1, painless: 2, flawless: 3,
  polished: 2, robust: 2, straightforward: 1, satisfied: 2, satisfying: 2, okay: 1, fine: 1,
  cheap: 1, cheaper: 1,
  // negative
  hate: -3, hated: -3, hates: -3, hating: -3, terrible: -3, awful: -3, worst: -3, bad: -1,
  broken: -2, breaks: -2, broke: -2, breaking: -1, buggy: -2, crash: -2, crashes: -2, crashed: -2,
  crashing: -2, expensive: -2, pricey: -2, overpriced: -3, paywall: -3, greedy: -3, scam: -3,
  scammy: -3, lie: -3, lying: -3, lied: -3, lies: -3, disappointed: -2, disappointing: -2,
  disappoint: -2, disappoints: -2, disappointment: -2, frustrated: -2, frustrating: -2,
  frustration: -2, slow: -1, confusing: -2, confused: -2, unfair: -2, backlash: -3, cancel: -2,
  cancelled: -2, angry: -3, anger: -3, outrage: -3, ripoff: -3, "rip-off": -3, "dark pattern": -3,
  locked: -2, "lock-in": -2, downgrade: -2, chaos: -2, delay: -1, delayed: -1, promise: 0,
  "broke promise": -3, misleading: -3, deceptive: -3, shady: -2, sketchy: -2, worried: -2,
  worry: -2, worries: -2, risk: -1, risky: -2, concerned: -2, concern: -2, concerns: -2,
  concerning: -2, sucks: -3, suck: -3, sucked: -3, trash: -3, garbage: -3, disaster: -3,
  nightmare: -3, mess: -2, messy: -2, regression: -2, regressions: -2, deprecated: -1, forced: -2,
  mandatory: -1, hidden: -1, surprise: -1, bait: -2, "switch": -1, churn: -2, lawsuit: -3,
  fired: -2, layoff: -2, layoffs: -2, outage: -2, outages: -2, downtime: -2, compromised: -3,
  breach: -3, complains: -2, complained: -2, complaining: -2, complaint: -2, complaints: -2,
  regret: -2, regrets: -2, mistake: -2, mistakes: -2, wrong: -1, unacceptable: -3, insulting: -3,
  betrayal: -3, useless: -3, pointless: -2, waste: -2, wasted: -2, annoying: -2, annoyed: -2,
  irritating: -2, irritated: -2, trap: -2, undercut: -1, dealbreaker: -3,
  // multi-word phrases (matched on the raw text in a second pass)
  "no notes": 2, "worth it": 2, "just works": 2, "pleasantly surprised": 2, "cash grab": -3,
  "rug pull": -3, "price hike": -2, "data loss": -3, "tone deaf": -2, "out of touch": -2,
  "red flag": -2, "bait and switch": -3, "deal breaker": -3, "fine print": -2,
};

const INTENSIFIERS = new Set(["very", "extremely", "really", "super", "insanely", "totally", "absolutely", "so", "utterly", "incredibly", "genuinely", "honestly", "truly", "literally", "seriously"]);
const DOWNTONERS = new Set(["slightly", "somewhat", "a", "bit", "kinda", "mildly", "arguably", "fairly", "rather", "pretty", "quite"]);
const NEGATORS = new Set(["not", "no", "never", "isn't", "wasn't", "don't", "doesn't", "didn't", "can't", "won't", "wouldn't", "couldn't", "aren't", "not_"]);

export interface SentimentResult {
  score: number; // [-1, 1]
  hits: number;
}

export function scoreSentiment(text: string): SentimentResult {
  let raw = 0;
  let hits = 0;
  // Sentence-aware scan: negation and intensifier state never leak across a
  // sentence boundary ("Manageable, not existential. Genuinely good move."
  // must score the last sentence positive).
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const words = sentence
      .toLowerCase()
      .replace(/[^a-z0-9'\- ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    let negated = false; // flips only the NEXT content word ("no notes Solid" keeps solid positive)
    let multiplier = 1;
    for (const w of words) {
      if (NEGATORS.has(w)) {
        negated = true;
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
        if (negated) v = -v; // "never crashes" reads positive to the reader
        raw += v;
        hits++;
      }
      // the scope of a negator/intensifier ends at the next word: fillers
      // absorb it, sentiment words consume it
      negated = false;
      multiplier = 1;
    }
  }
  // multi-word phrase pass over the raw text (affirmative slang like
  // "no notes", "just works", "worth it" and doom phrases like "rug pull")
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
