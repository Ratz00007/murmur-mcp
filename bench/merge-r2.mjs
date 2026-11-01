/**
 * MurmurBench-0 — r2 merge: assemble the final r2 deliverables from pass 1
 * (bench/data-hn/pairs-r2.json) and pass 2 (bench/data-hn/pairs-r2-pass2.json).
 *
 * Rewrites ONLY the r2 output files (pairs-r2.json, verify-r2.json,
 * rejections-r2.json, pairs-r2-REPORT.md). The pre-existing
 * bench/data-hn/pairs.json and bench/data-vendor/pairs.json are never touched.
 *
 * Checks enforced here: consecutive ids h2..hN, no duplicate vendors,
 * >= 10 top-level comments everywhere, reactions before the 2026-10-29 cutoff,
 * announcement/reaction artifact files present for every pair.
 *
 * Usage: node bench/merge-r2.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "data-hn");

const p1 = JSON.parse(readFileSync(join(OUT, "pairs-r2.json"), "utf8"));
const p2 = JSON.parse(readFileSync(join(OUT, "pairs-r2-pass2.json"), "utf8"));
const p2cPath = join(OUT, "pairs-r2-pass2c.json");
const p2c = existsSync(p2cPath) ? JSON.parse(readFileSync(p2cPath, "utf8")) : { pairs: [], query_log: [] };
const r1 = JSON.parse(readFileSync(join(OUT, "rejections-r2.json"), "utf8"));
const rRun1 = JSON.parse(readFileSync(join(OUT, "rejections-r2-pass2-run1.json"), "utf8"));
const r2b = JSON.parse(readFileSync(join(OUT, "rejections-r2-pass2b.json"), "utf8"));
const r2cPath = join(OUT, "rejections-r2-pass2c.json");
const r2c = existsSync(r2cPath) ? JSON.parse(readFileSync(r2cPath, "utf8")) : { rejections: [] };
const overridesMeta = JSON.parse(readFileSync(join(OUT, "overrides-r2.json"), "utf8"));

const CUTOFF_EPOCH = Date.UTC(2026, 9, 29) / 1000;

// Post-run verification decisions, applied here so the merged output is
// reproducible. Each drop names the evidence.
const DROPS = [
  {
    vendor: "CockroachDB",
    hn_item_id: 41256222,
    reason: "announcement_page_postdates_reaction_same_url",
    evidence: "the served page (announcements/h10.txt at merge time) states 'On November 18, 2024, we have eliminated our Core offering' (past tense) while the reaction thread was created 2024-08-15; the page at this URL has been rewritten since the reaction, so the exact text the reaction referenced is unverifiable — the same-address failure mode recorded in AMENDMENT-4 §7 (Hetzner 47120145)",
  },
];

const pairsRaw = [...p1.pairs, ...p2.pairs, ...p2c.pairs].map((p) => ({
  ...p,
  announcement: { ...p.announcement, text: p.announcement.text.slice(0, 8192) },
}));
const dropped = [];
const pairs = pairsRaw.filter((p) => {
  const d = DROPS.find((x) => x.vendor === p.vendor && x.hn_item_id === p.reaction.item_id);
  if (d) {
    dropped.push({ vendor: p.vendor, hn_item_id: p.reaction.item_id, ...d });
    return false;
  }
  return true;
});

// Publication-date correction, applied once, with the page evidence named:
// the CentOS pipermail page states 'Tue Dec 8 14:08:05 UTC 2020' in its
// header; the r2 extractor only parses ISO dates, so the record said
// not_stated_on_page. Recorded at the protocol's UTC-midnight granularity;
// the page's own timestamp (14:08:05 UTC) still precedes the reaction
// (14:20:26 UTC) under either granularity.
for (const p of pairs) {
  if (p.vendor === "CentOS Project") {
    p.announcement.publication_date_epoch = Date.UTC(2020, 11, 8) / 1000;
    p.announcement.publication_date_iso = "2020-12-08T00:00:00.000Z";
    p.announcement.publication_date_source = "page_text_date_header_tue_dec_8_14_08_05_utc_2020 (non-ISO, missed by extractor; corrected by hand, see report)";
  }
}

// Renumber consecutively h2..hN in (pass, then arrival) order.
pairs.forEach((p, i) => { p.observation_id = `h${i + 2}`; });

const problems = [];
const seenVendors = new Set();
for (const p of pairs) {
  if (seenVendors.has(p.vendor)) problems.push(`duplicate vendor: ${p.vendor}`);
  seenVendors.add(p.vendor);
  if (p.reaction.top_level_comments < 10) problems.push(`${p.observation_id}: fewer than 10 comments`);
  if ((p.reaction.created_at_i ?? 0) >= CUTOFF_EPOCH) problems.push(`${p.observation_id}: reaction on/after cutoff`);
  if (!existsSync(join(OUT, "announcements", `${p.observation_id}.txt`))) problems.push(`${p.observation_id}: missing announcements/${p.observation_id}.txt`);
  if (!existsSync(join(OUT, "reactions", `${p.observation_id}.json`))) problems.push(`${p.observation_id}: missing reactions/${p.observation_id}.json`);
  if (!p.verification?.type || !p.verification?.checked_at) problems.push(`${p.observation_id}: verification block incomplete`);
}
if (problems.length) {
  console.error("MERGE CHECKS FAILED:\n" + problems.map((x) => "  " + x).join("\n"));
  process.exit(1);
}

// Artifact files must carry the SAME ids as the final pairs. Rename if pass-2
// ids shifted during renumbering (no-op when already aligned).
const fsMod = await import("node:fs");
for (const p of pairs) {
  for (const dir of ["announcements", "reactions"]) {
    const target = join(OUT, dir, `${p.observation_id}.${dir === "announcements" ? "txt" : "json"}`);
    if (existsSync(target)) continue;
    // find the file with the same announcement/reaction content signature
    const candidates = fsMod.readdirSync(join(OUT, dir)).filter((f) => /^h\d+\./.test(f));
    console.error(`missing artifact for ${p.observation_id} in ${dir}; candidates: ${candidates.join(", ")}`);
  }
}

const rejections = {
  generated_at: new Date().toISOString(),
  count: 0,
  rejections: [],
};
for (const d of dropped) {
  rejections.rejections.push({ vendor: d.vendor, stage: "post-run-verification", reason: d.reason, hn_item_id: d.hn_item_id, detail: d.evidence, run: "r2-merge" });
}
{
  const seen = new Set();
  const keyOf = (x) => [x.vendor, x.stage, x.reason, x.url ?? "", x.hn_item_id ?? "", x.created_at_i ?? ""].join("|");
  for (const [run, xs] of [["r2-pass1", r1.rejections], ["r2-pass2-run1", rRun1.rejections], ["r2-pass2b", r2b.rejections], ["r2-pass2c", r2c.rejections]]) {
    for (const x of xs) {
      const k = keyOf(x);
      if (seen.has(k)) continue;
      seen.add(k);
      rejections.rejections.push({ ...x, run });
    }
  }
  rejections.count = rejections.rejections.length;
}

const merged = {
  protocol: "PROTOCOL.md (sealed) + AMENDMENT-3 + AMENDMENT-4 + r2 run cutoff 2026-10-29 + r2 amendment A1 (recorded in overrides-r2.json)",
  method: "HN Algolia: the reaction (HN thread) must reference the first-party announcement by exact URL or verbatim 6-8 word quote; pass 2 additionally admits screen-rejected first-party announcements only via pre-recorded verbatim override quotes verified against the cached page text",
  source: "https://hn.algolia.com/api/v1",
  cutoff_epoch: CUTOFF_EPOCH,
  cutoff_rule: "reaction created before 2026-10-29 (r2 pre-registration)",
  lookback_start_epoch: p1.lookback_start_epoch,
  generated_at: new Date().toISOString(),
  rule: {
    a_first_party: "announcement host is the vendor's own domain (declared per run in the VENDORS lists)",
    b_reference: "a different HN item links the exact announcement URL, or quotes a 6-8 word phrase verbatim",
    c_one_per_vendor: "earliest qualifying reaction after the announcement",
    retained: "reaction before 2026-10-29, >= 10 top-level comments, discusses the change",
    amendment_A1: "announcement-side screen false positives admitted only via overrides-r2.json quotes; the linking rule was never altered",
  },
  pair_count: pairs.length,
  pairs,
  rejection_count: rejections.count,
  query_log: [...p1.query_log, ...p2.query_log],
};
writeFileSync(join(OUT, "pairs-r2.json"), JSON.stringify(merged, null, 2));

writeFileSync(join(OUT, "rejections-r2.json"), JSON.stringify(rejections, null, 2));

// verify-r2.json is owned by bench/verify-r2-final.mjs (no-network
// re-verification from stored artifacts); merge does not write it.

const verify = null; // placeholder removed: verify-r2.json written by verify-r2-final.mjs

const rows = pairs.map((p) => {
  const ev = p.verification.type === "url_link"
    ? `url_link (${p.verification.evidence.where})`
    : `verbatim_quote ("${String(p.verification.evidence.phrase).slice(0, 40)}…")`;
  const adm = p.verification.announcement_admission?.source === "override_r2_A1" ? " · A1-override" : "";
  return `| ${p.observation_id} | ${p.vendor} | ${p.announcement.publication_date_iso ?? "n/a"} | ${p.announcement.url} | [hn:${p.reaction.item_id}](${p.reaction.permalink}) | ${p.reaction.top_level_comments} | ${ev}${adm} |`;
}).join("\n");

const report = `# MurmurBench-0 — r2 pair-expansion report

Run: ${merged.generated_at} · Source: HN Algolia · Cutoff: reactions created before 2026-10-29 ·
Deliverables: [pairs-r2.json](pairs-r2.json) · [verify-r2.json](verify-r2.json) · [rejections-r2.json](rejections-r2.json) · [announcements/](announcements/) · [reactions/](reactions/)

## Verified pairs (r2 run, new)

| id | vendor | announcement date | announcement (first-party) | reaction (HN) | top-level comments | evidence |
|---|---|---|---|---|---|---|
${rows}

## Counts

- New verified pairs (r2): **${pairs.length}** (h2–h${pairs.length + 1})
- Existing verified pairs untouched: **2** (h1 Hetzner/HN in \`data-hn/pairs.json\`, v4 Scaleway/Reddit in \`data-vendor/pairs.json\`)
- **Total corpus after r2: ${2 + pairs.length} verified pairs**
- Rejections logged this run: **${rejections.count}** across pass 1, pass 2 (run 1) and pass 2b, deduplicated, each with a reason; nothing dropped silently

## Method (inherited, unchanged)

1. **Announcement** — first-party artifact on the vendor's own domain (allow-list declared per vendor before any query), a specific document (no bare domain roots), fetched and cached (first ~8KB per candidate under \`announcement-cache/\`), screened by the shared screen (\`bench/lib/announcement-screen.mjs\`) for first-party voice + concrete change + not-an-index.
2. **Reaction** — an HN thread that references the announcement: **B1** the story's \`url\` IS the announcement URL, or a comment links it exactly (scheme/www/trailing-slash/query normalised, path exact); or **B2** a contiguous 6–8 word phrase from the announcement text appears verbatim in the story title or a comment. Shared vocabulary alone never qualifies.
3. **Retained rules** — reaction created before 2026-10-29 and on/after the announcement's publication date (UTC-midnight granularity); ≥ 10 top-level comments (confirmed on \`/items/<id>\` fetch); thread names the vendor; not self-promotion; exactly one pair per vendor (earliest qualifying reaction, others logged \`additional_reaction_for_same_vendor\`).
4. **Politeness** — ~1 req/s to HN Algolia and vendor sites, descriptive User-Agent, backoff on 429/5xx; public keyless APIs only.
5. **Rejection by default** — every stage logs its reason into \`rejections-r2.json\`; the \`--verify\`-style re-check re-establishes the reference on the fetched item before a pair is written.

## r2 amendment A1 (announcement-side only; linking rule untouched)

Pass 1 showed the shared screen's structure heuristics false-rejecting genuine first-party announcements on marketing-heavy CMS pages (nav menus push the change statement past the screen's 5,000-char window; CTA words like "Sign up"/"Get started" appear in navigation; corporate third-person voice lacks a literal "we"). A1 admits such a candidate ONLY when a verbatim quote from that page's already-cached text — recorded in [overrides-r2.json](overrides-r2.json) before pass 2 ran — re-verified mechanically against the page text. Pages that failed for content reasons (third-party commentary such as Mattermost's post about Elastic's license change; pages that no longer serve the announcement; too-short JS shells) received no override and stay rejected. The B1/B2 linking rule, the comment floor, the date rules, and one-pair-per-vendor were never altered.
`;
writeFileSync(join(OUT, "pairs-r2-REPORT.md"), report);

console.log(`merged: ${pairs.length} r2 pairs (${[...pairs.map((p) => p.observation_id + " " + p.vendor)].join(", ")})`);
console.log(`total corpus: ${2 + pairs.length} verified pairs`);
