/**
 * MurmurBench-0 — pre-registered thread selection.
 *
 * A transcription of PROTOCOL.md §4 as amended 2026-09-28. The queries, sort
 * order, sample size, and exclusion rules are frozen; changing one requires a
 * visible `PROTOCOL AMENDED` commit. Every DROP is logged with its reason —
 * threads are never silently discarded.
 *
 * Usage: node bench/select.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchPostsByPhrase } from "./lib/arctic-shift.mjs";
import { screenAnnouncement } from "./lib/prescreen.mjs";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESET = process.argv.includes("--reset");

/**
 * PROTOCOL.md §4 as amended 2026-09-28.
 *
 * The original five queries were drawn before any retrieval was tested and
 * yielded 3 candidates, 0 of which passed the announcement screen: dev
 * workflow subreddits (r/programming, r/webdev) are where people ASK about
 * pricing, not where companies announce it. Subreddits were re-chosen on
 * measured yield — comment counts and titles only, no comment body and no
 * objection content was read during the survey.
 *
 * Kept from the original: SaaS pricing, API deprecation, license change.
 * Added: consumer price-hike threads (the same ICP scenario, higher volume)
 * and telemetry/terms-of-service policy changes.
 */
const QUERIES = [
  { subreddit: "sysadmin", title: "price" },
  { subreddit: "selfhosted", title: "price" },
  { subreddit: "CordCutters", title: "price" },
  { subreddit: "linux", title: "telemetry" },
  { subreddit: "SaaS", title: "pricing" },
];

const PER_QUERY_LIMIT = 100; // retrieval depth; §4 takes the first QUALIFYING result
const TARGET_N = 5;
const MIN_COMMENTS = 10; // §4: at least 10 comments
const SEAL_EPOCH = 1790560176; // §4: created before this protocol was sealed
const LOOKBACK_DAYS = 365; // declared in advance; API accepts `after`, rejects `before`
const AFTER_EPOCH = SEAL_EPOCH - LOOKBACK_DAYS * 86400;

/** §4 mechanical rules. Returns a drop reason, or null when the shape passes. */
function mechanicalVerdict(p) {
  if (p.removed_by_category || p.removed_by) return "removed_or_quarantined";
  if (!p.is_self) return "announcement_behind_external_link";
  if ((p.num_comments ?? 0) < MIN_COMMENTS) return "fewer_than_10_comments";
  if (p.created_utc >= SEAL_EPOCH) return "created_after_protocol_seal";
  if (p.created_utc < AFTER_EPOCH) return "outside_declared_lookback_window";
  return null;
}

/** §5: the blind input handed to BOTH arms — title + body, nothing else. */
function blindArtifact(p) {
  return `TITLE: ${p.title}\n\nBODY:\n${p.selftext ?? ""}`.trim();
}

async function main() {
  if (RESET) rmSync(join(HERE, "data"), { recursive: true, force: true });
  mkdirSync(join(HERE, "data"), { recursive: true });

  const selected = [];
  const dropped = [];
  const queryLog = [];

  for (const q of QUERIES) {
    if (selected.length >= TARGET_N) break;
    const label = `r/${q.subreddit} "${q.title}"`;
    process.stdout.write(`${label} … `);

    const { posts, status } = await searchPostsByPhrase(q.subreddit, q.title, {
      limit: PER_QUERY_LIMIT,
      afterEpoch: AFTER_EPOCH,
    });
    let mechCount = 0;
    let semCount = 0;
    console.log(`${posts.length} candidates`);

    for (const p of posts) {
      if (selected.length >= TARGET_N) break;

      const mech = mechanicalVerdict(p);
      if (mech) {
        dropped.push({ query: label, id: p.id, title: (p.title ?? "").replace(/\s+/g, " ").slice(0, 90), num_comments: p.num_comments, reason: mech });
        continue;
      }
      mechCount++;

      // §4's semantic half: is this a party ANNOUNCING a change?
      const sem = screenAnnouncement(p.title, p.selftext);
      if (!sem.pass) {
        semCount++;
        dropped.push({ query: label, id: p.id, title: (p.title ?? "").replace(/\s+/g, " ").slice(0, 90), num_comments: p.num_comments, reason: sem.reason });
        continue;
      }

      // §4: first qualifying result from each query, in query order.
      if (selected.some((s) => s.query === label)) {
        dropped.push({ query: label, id: p.id, title: (p.title ?? "").replace(/\s+/g, " ").slice(0, 90), reason: "not_first_qualifying_in_query" });
        continue;
      }

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

    queryLog.push({ query: label, http_status: status, candidates: posts.length, passed_mechanical: mechCount, failed_semantic: semCount });
    await sleep(3000);
  }

  const out = {
    protocol: "PROTOCOL.md (sealed e700a3e, amended 79045c2)",
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

  writeFileSync(join(HERE, "data", "selection.json"), JSON.stringify(out, null, 2));

  console.log(`\n--- selection sealed ---`);
  console.log(`selected: ${selected.length}/${TARGET_N}   dropped: ${dropped.length}`);
  for (const s of selected) {
    console.log(`  ${s.observation_id}  r/${s.subreddit.padEnd(12)} ${String(s.num_comments).padStart(4)}c  ${s.created_iso.slice(0, 10)}  ${(s.title || "").replace(/\s+/g, " ").slice(0, 62)}`);
  }
  const byReason = {};
  for (const d of dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  console.log(`\ndrops by reason:`);
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
}

await main();
