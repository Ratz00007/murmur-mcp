/** Deterministic extractive digests for seed material. */
import { splitSentences, topKeywords, truncate } from "../util/text.js";

export const MAX_SEED_BYTES = 50 * 1024 * 1024; // 50 MB per world, PRD F1

/**
 * Extractive digest: sentence-level keyword scoring with position and length
 * bonuses, top sentences re-ordered into original reading order. Fully
 * deterministic — same input, same digest, always.
 */
export function makeDigest(text: string, maxChars = 1800): string {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return clean;
  const sentences = splitSentences(clean).filter((s) => s.length >= 20);
  if (sentences.length === 0) return truncate(clean, maxChars);
  const kw = new Map(topKeywords(clean, 60));
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().match(/[a-z0-9'#+.-]+/g) ?? [];
    let score = 0;
    for (const w of words) score += kw.get(w) ?? 0;
    score = score / Math.sqrt(words.length || 1);
    if (i < 2) score *= 1.35; // lead sentences carry the thesis
    if (s.length > 350) score *= 0.7; // avoid run-on boilerplate
    return { s, i, score };
  });
  const take = scored
    .slice()
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 10)
    .reduce<{ s: string; i: number }[]>((acc, x) => {
      const used = acc.reduce((n, y) => n + y.s.length + 1, 0);
      if (used + x.s.length <= maxChars || acc.length === 0) acc.push(x);
      return acc;
    }, [])
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  let digest = take.join(" ");
  if (digest.length > maxChars) digest = truncate(digest, maxChars);
  return digest;
}

export interface SeedCoverage {
  seeds: number;
  totalBytes: number;
  largest: number;
  notes: string[];
}

export function coverageStats(sizes: number[]): SeedCoverage {
  const total = sizes.reduce((a, b) => a + b, 0);
  const notes: string[] = [];
  if (sizes.length === 0) notes.push("No seeds yet — attach material with seed_add_files / seed_add_url / seed_add_text.");
  if (total === 0) notes.push("All seeds are empty.");
  else if (total < 2048) notes.push("Small corpus (< 2 KB) — extraction may be thin; consider adding more material.");
  if (total > MAX_SEED_BYTES) notes.push(`Corpus exceeds the ${Math.round(MAX_SEED_BYTES / 1024 / 1024)} MB envelope; later seeds will still ingest but digests are compressed.`);
  if (sizes.some((s) => s === 0)) notes.push("One or more seeds yielded no extractable text (possibly a scanned/image PDF) — ask the host agent to read the file and pass text via seed_add_text.");
  return { seeds: sizes.length, totalBytes: total, largest: sizes.length ? Math.max(...sizes) : 0, notes };
}
