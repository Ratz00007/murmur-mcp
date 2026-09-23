/** Text + token-budget utilities. All deterministic. */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function round2Safe(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cheap token estimate (~4 chars/token for English). Deliberately
 * conservative for mixed content; used for budget enforcement, not billing.
 */
export function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function estTokensJson(v: unknown): number {
  return estTokens(JSON.stringify(v));
}

export function nowIso(): string {
  return new Date().toISOString();
}

const STOPWORDS = new Set(
  ("a an the and or but if while of to in on for with without at by from as is are was were be been being this that " +
    "these those it its we you they he she i our your their his her them us not no nor so than then there here what " +
    "which who whom when where why how all any both each few more most other some such only own same too very can " +
    "will just don should now about into over after before under above out off again further once do does did doing " +
    "have has had having would could may might must shall also however therefore per via etc new get got make made " +
    "use used using one two three new like due within across between because during through against among upon")
    .split(" ")
    .filter(Boolean),
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'#+.\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function keywordFreq(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens(text)) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

export function topKeywords(text: string, k: number): [string, number][] {
  return [...keywordFreq(text).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k);
}

/** Approximate sentence split on terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Truncate on a word boundary with an ellipsis. */
export function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "world"
  );
}

/** Escape a label for safe use inside a Mermaid node definition. */
export function escapeMermaid(s: string): string {
  return truncate(s.replace(/["\\<>{}\n\r]/g, " ").replace(/\s+/g, " ").trim(), 60);
}

/** Format a sentiment value as a compact human string. */
export function sentimentLabel(v: number): string {
  if (v <= -0.6) return "very negative";
  if (v <= -0.2) return "negative";
  if (v < 0.2) return "neutral";
  if (v < 0.6) return "positive";
  return "very positive";
}

export function stanceBar(v: number, width = 20): string {
  const w = clamp(v, -1, 1);
  // negative: left red blocks; positive: right green blocks; neutral dot in middle
  const mid = Math.floor(width / 2);
  const filled = Math.round(Math.abs(w) * mid);
  const empty = mid - filled;
  if (w < 0) return `${"█".repeat(filled)}${"·".repeat(empty)}|${"·".repeat(mid)}`;
  return `${"·".repeat(mid)}|${"·".repeat(empty)}${"█".repeat(filled)}`;
}

/** Deterministic stable stringification (sorted object keys). */
export function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}
