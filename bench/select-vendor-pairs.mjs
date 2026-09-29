/**
 * MurmurBench-0 — vendor-anchored pair selection.
 *
 * The previous approach searched Reddit for announcements and failed: Reddit
 * threads about a price change link to NEWS ARTICLES about the change, not to
 * the vendor's own changelog, and news coverage is itself a reaction. Filtering
 * publishers one at a time was whack-a-mole.
 *
 * This inverts the search. For each VENDOR with a real public changelog, find
 * the REACTION threads that name them, then fetch the announcement from the
 * vendor's own domain. Both halves are first-party or primary, and neither
 * depends on a list of publishers.
 *
 * The vendor list is fixed here, in advance, and is a list of vendors that
 * document changes publicly — not a list chosen for how the simulation would
 * score on them. Subreddits and the query terms are equally fixed. No
 * objection content is read by this file; it only reads post titles, bodies,
 * link domains, and comment counts.
 *
 * Usage: node bench/select-vendor-pairs.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchPostsByPhrase } from "./lib/arctic-shift.mjs";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESET = process.argv.includes("--reset");

/**
 * Vendors whose changes are announced on their own domain. The announcement
 * host is declared here rather than discovered, so a thread can never supply
 * the blind input — the pairing is by vendor, not by whatever URL a bystander
 * happened to post.
 *
 * Chosen for two properties and no others: (1) the change is documented on the
 * vendor's own domain, and (2) the change is public and old enough that a
 * reaction thread exists in the archive. No vendor is included or excluded
 * because of how the simulation is expected to score on it — that would be the
 * post-hoc selection the pre-registration exists to prevent, and no objection
 * content has been read while assembling this list.
 */
const VENDORS = [
  {
    name: "ONLYOFFICE",
    // verified first-party blog post about a licence change
    announcement: "https://www.onlyoffice.com/blog/2026/03/onlyoffice-flags-license-violations-in-euro-office-project-by-nextcloud-and-ionos",
    subreddits: ["linux", "opensourcesucks", "fedora"],
    term: "onlyoffice",
  },
  {
    name: "Flathub",
    announcement: "https://docs.flathub.org/blog/enhanced-license-compliance-tools",
    subreddits: ["linux", "flatpak", "linux"],
    term: "flathub",
  },
  {
    name: "Hetzner",
    announcement: "https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/",
    subreddits: ["sysadmin", "selfhosted", "devops"],
    term: "hetzner",
  },
  {
    name: "Scaleway",
    announcement: "https://www.scaleway.com/en/blog/a-transparent-update-on-scaleway-pricing/",
    subreddits: ["sysadmin", "selfhosted", "devops"],
    term: "scaleway",
  },
  {
    // First-party announcement of a premium price increase. A specific
    // resource page, not a blog index, so it states the change itself.
    name: "Bitwarden",
    announcement: "https://bitwarden.com/resources/january-2026-spotlight-enhanced-premium-plan",
    subreddits: ["privacy", "selfhosted", "linux", "Passwords"],
    term: "bitwarden",
  },
  {
    // First-party release post announcing an end-of-life for a Hub version.
    name: "Nextcloud",
    announcement: "https://nextcloud.com/blog/september-updates-for-nextcloud-hub-25-autumn-26-winter-26-spring/",
    subreddits: ["linux", "selfhosted", "nextcloud"],
    term: "nextcloud",
  },
  {
    name: "Proton",
    announcement: "https://proton.me/blog",
    subreddits: ["privacy", "linux", "VPN"],
    term: "proton",
  },
  {
    name: "Synology",
    announcement: "https://www.synology.com/en-global/releaseNote/DSM",
    subreddits: ["synology", "selfhosted", "sysadmin"],
    term: "synology",
  },
  {
    name: "JetBrains",
    announcement: "https://www.jetbrains.com/community/feed/",
    subreddits: ["intellijidea", "javafx", "programming", "java"],
    term: "jetbrains",
  },
  {
    name: "Mullvad",
    announcement: "https://mullvad.net/en/blog",
    subreddits: ["privacy", "VPN", "linux"],
    term: "mullvad",
  },
];

const TARGET_N = 5;
/**
 * Collect candidates for EVERY vendor, then let the verification step decide
 * which survive. Stopping at TARGET_N candidates was wrong: verification
 * rejects roughly half of them, so collecting exactly five yielded three
 * verified pairs and the vendors after the fifth were never even searched.
 */
const CANDIDATE_SLACK = 3;
const CANDIDATE_BUDGET = TARGET_N * CANDIDATE_SLACK;
/**
 * At most one reaction thread per vendor.
 *
 * Without this the benchmark measures a single event several times: all 7
 * ONLYOFFICE candidates come from the same licence dispute, so scoring them
 * would weight one announcement five times and tell us nothing about the other
 * three vendors. One thread per vendor, so recall is measured across distinct
 * changes rather than across one change's comment volume.
 */
const MAX_PER_VENDOR = 1;
const MIN_COMMENTS = 10;
const SEAL_EPOCH = 1790560176;
const AFTER_EPOCH = SEAL_EPOCH - 365 * 86400;

/** A reaction thread discusses the change; it is not the change. */
const NOT_A_REACTION = /^(?:i|we)\s+(?:built|made|created|launched|am)\b|check\s+it\s+out|my\s+(?:saas|tool|app|product|extension)\b/i;

function threadVerdict(p, vendor) {
  if (p.removed_by_category || p.removed_by) return "removed_or_quarantined";
  if ((p.num_comments ?? 0) < MIN_COMMENTS) return "fewer_than_10_comments";
  if (p.created_utc >= SEAL_EPOCH) return "created_after_protocol_seal";
  if (p.created_utc < AFTER_EPOCH) return "outside_declared_lookback_window";
  const text = `${p.title ?? ""}\n${p.selftext ?? ""}`;
  if (!new RegExp(vendor.term, "i").test(text)) return "thread_does_not_name_the_vendor";
  if (NOT_A_REACTION.test((p.title ?? "").trim())) return "self_promotion_not_a_reaction";
  return null;
}

async function main() {
  if (RESET) rmSync(join(HERE, "data-vendor"), { recursive: true, force: true });
  mkdirSync(join(HERE, "data-vendor"), { recursive: true });

  const pairs = [];
  const dropped = [];
  const queryLog = [];

  for (const v of VENDORS) {
    if (pairs.length >= CANDIDATE_BUDGET) break;
    const seen = new Set();
    let taken = 0;
    for (const sub of v.subreddits) {
      if (taken >= MAX_PER_VENDOR) break;
      const label = `r/${sub} "${v.term}" (${v.name})`;
      process.stdout.write(`${label} … `);
      const { posts, status } = await searchPostsByPhrase(sub, v.term, { limit: 100, afterEpoch: AFTER_EPOCH });
      console.log(`${posts.length} candidates`);

      for (const p of posts) {
        if (taken >= MAX_PER_VENDOR) break;
        if (seen.has(p.id)) continue;
        const reason = threadVerdict(p, v);
        if (reason) {
          if (!seen.has(p.id)) dropped.push({ query: label, id: p.id, reason, title: (p.title ?? "").replace(/\s+/g, " ").slice(0, 80) });
          seen.add(p.id);
          continue;
        }
        seen.add(p.id);
        taken++;
        pairs.push({
          observation_id: `v${pairs.length + 1}`,
          vendor: v.name,
          query: label,
          // GROUND TRUTH side
          reaction: {
            platform: "reddit",
            permalink: `https://www.reddit.com${p.permalink}`,
            link_id: p.id,
            subreddit: p.subreddit,
            created_utc: p.created_utc,
            created_iso: new Date(p.created_utc * 1000).toISOString(),
            num_comments: p.num_comments,
            title: p.title,
            selftext: p.selftext ?? "",
          },
          // BLIND INPUT side — from the vendor's own domain, never from a thread
          announcement: { url: v.announcement, text: null },
        });
      }
      queryLog.push({ query: label, http_status: status, candidates: posts.length });
      await sleep(3500);
    }
  }

  const out = {
    protocol: "PROTOCOL.md (sealed e700a3e, amended 79045c2/42ef5d5/7157960)",
    method: "vendor-anchored: the reaction names a vendor; the announcement comes from that vendor's own domain",
    seal_epoch: SEAL_EPOCH,
    generated_at: new Date().toISOString(),
    target_n: TARGET_N,
    pair_count: pairs.length,
    query_log: queryLog,
    pairs,
    dropped,
  };
  writeFileSync(join(HERE, "data-vendor", "pairs.json"), JSON.stringify(out, null, 2));

  console.log(`\n--- vendor-anchored pairs ---`);
  console.log(`pairs: ${pairs.length}/${TARGET_N}   dropped: ${dropped.length}`);
  for (const p of pairs) {
    console.log(`  ${p.observation_id}  ${p.vendor.padEnd(12)} r/${p.reaction.subreddit.padEnd(16)} ${String(p.reaction.num_comments).padStart(4)}c  "${(p.reaction.title || "").replace(/\s+/g, " ").slice(0, 60)}"`);
  }
  const byReason = {};
  for (const d of dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  console.log(`\ndrops by reason:`);
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}

await main();


