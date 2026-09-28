/**
 * MurmurBench-0 — pre-registered thread selection.
 *
 * A transcription of PROTOCOL.md §4. The queries, sort order, sample size,
 * and inclusion/exclusion rules below are frozen; changing one requires a
 * visible `PROTOCOL AMENDED` commit. Every DROP is logged with its reason —
 * threads are never silently discarded.
 *
 * Usage: node bench/select.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchPostsByPhrase } from "./lib/arctic-shift.mjs";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** PROTOCOL.md §4 — frozen queries, run verbatim, in this order. */
const QUERIES = [
  { subreddit: "SaaS", title: "price increase" },
  { subreddit: "programming", title: "api deprecation" },
  { subreddit: "webdev", title: "pricing" },
  { subreddit: "sysadmin", title: "license change" },
  { subreddit: "selfhosted", title: "subscription" },
];

const PER_QUERY_LIMIT = 5; // §4: first 5 results per query
const TARGET_N = 5;
const MIN_COMMENTS = 10; // §4: at least 10 comments
const SEAL_EPOCH = 1790560176; // §4: created before this protocol was sealed

/**
 * Retrieval window. The API accepts `after` but rejects `before`, so the
 * window is [SEAL_EPOCH - LOOKBACK, SEAL_EPOCH) and the upper bound is
 * enforced locally. Twelve months is declared in advance so the window
 * cannot be tuned to taste after seeing results.
 */
const LOOKBACK_DAYS = 365;
const AFTER_EPOCH = SEAL_EPOCH - LOOKBACK_DAYS * 86400;

/**
 * §4 inclusion rules. Returns null when the thread qualifies, else a drop
 * reason drawn from the closed set frozen in the protocol.
 */
function inclusionVerdict(p) {
  if (p.removed_by_category || p.removed_by) return "removed_or_quarantined";
  if (!p.is_self) return "announcement_behind_external_link";
  const text = `${p.title ?? ""}\n${p.selftext ?? ""}`.trim();
  if (text.length < 120) return "no_identifiable_change_in_post";
  if ((p.num_comments ?? 0) < MIN_COMMENTS) return "fewer_than_10_comments";
  if (p.created_utc >= SEAL_EPOCH) return "created_after_protocol_seal";
  return null;
}

/** §5: the blind input handed to BOTH arms — title + body, nothing else. */
function blindArtifact(p) {
  return `TITLE: ${p.title}\n\nBODY:\n${p.selftext ?? ""}`.trim();
}

async function main() {
  const selected = [];
  const dropped = [];
  const queryLog = [];

  for (const q of QUERIES) {
    if (selected.length >= TARGET_N) break;
    const label = `r/${q.subreddit} "${q.title}"`;
    process.stdout.write(`${label} … `);

    const { posts, status } = await searchPostsByPhrase(q.subreddit, q.title, {
      limit: 100,
      afterEpoch: AFTER_EPOCH,
    });
    queryLog.push({ query: label, http_status: status, candidates: posts.length });
    console.log(`${posts.length} candidates`);

    // §4: first qualifying result from each query, in query order.
    let took = false;
    for (const p of posts) {
      if (selected.length >= TARGET_N) break;
      const reason = inclusionVerdict(p);
      if (reason) {
        dropped.push({
          query: label,
          id: p.id,
          title: (p.title ?? "").replace(/\s+/g, " ").slice(0, 90),
          created_utc: p.created_utc,
          num_comments: p.num_comments,
          reason,
        });
        continue;
      }
      if (took) {
        dropped.push({ query: label, id: p.id, reason: "not_first_qualifying_in_query" });
        continue;
      }
      took = true;
      selected.push({
        observation_id: `t${selected.length + 1}`,
        query: label,
        source: "arctic-shift",
        permalink: `https://www.reddit.com${p.permalink}`,
        link_id: p.id,
        subreddit: p.subreddit,
        created_utc: p.created_utc,
        created_iso: new Date(p.created_utc * 1000).toISOString(),
        num_comments: p.num_comments,
        title: p.title,
        blind_artifact: blindArtifact(p),
      });
    }
    await sleep(3000);
  }

  const out = {
    protocol: "PROTOCOL.md (sealed, commit e700a3e)",
    seal_epoch: SEAL_EPOCH,
    lookback_days: LOOKBACK_DAYS,
    after_epoch: AFTER_EPOCH,
    generated_at: new Date().toISOString(),
    target_n: TARGET_N,
    selected_count: selected.length,
    query_log: queryLog,
    selected,
    dropped,
  };

  mkdirSync(join(HERE, "data"), { recursive: true });
  writeFileSync(join(HERE, "data", "selection.json"), JSON.stringify(out, null, 2));

  console.log(`\n--- selection sealed ---`);
  console.log(`selected: ${selected.length}/${TARGET_N}   dropped: ${dropped.length}`);
  for (const s of selected) {
    console.log(`  ${s.observation_id}  r/${s.subreddit}  ${s.num_comments}c  ${s.created_iso.slice(0, 10)}  ${s.permalink}`);
  }
  const byReason = {};
  for (const d of dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  console.log(`\ndrops by reason:`);
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
}

await main();
