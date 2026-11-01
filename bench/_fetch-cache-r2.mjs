/**
 * r2 helper — fetch the three pass-2-unreachable announcements into the
 * announcement cache so the 2b run can proceed cache-first:
 *   1. hashicorp.com BSL post (Akamai 429s against node fetch in passes 1-2)
 *   2. lists.centos.org CentOS Stream announce post (new vendor: CentOS Project)
 *   3. blog.heroku.com next-chapter post (new vendor: Heroku)
 * Same politeness (>=1s gap, descriptive UA) and the same cache format the
 * pass-2 script writes/parses. One retrieval attempt per URL, plus a single
 * browser-style-UA retry for hashicorp.com only, disclosed in the report.
 * Usage: node bench/_fetch-cache-r2.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sleep.mjs";
import { htmlToText } from "./lib/announcement-screen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, "data-hn", "announcement-cache");

const TARGETS = [
  { vendor: "HashiCorp", url: "https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license", topicHint: /business source license/i },
  { vendor: "CentOS_Project", url: "https://lists.centos.org/pipermail/centos-announce/2020-December/048208.html", topicHint: /centos stream/i },
  { vendor: "Heroku", url: "https://blog.heroku.com/next-chapter", topicHint: /free (?:plan|tier)|eco dyno/i },
];

let lastCallAt = 0;
async function gap() {
  const d = Date.now() - lastCallAt;
  if (d < 1500) await sleep(1500 - d);
  lastCallAt = Date.now();
}

function dayEpoch(s) {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function pubDate(url, rawHtml) {
  let m = rawHtml.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
        || rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);
  if (m) return { epoch: dayEpoch(m[1]), source: "html_meta_article_published_time" };
  m = rawHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (m) return { epoch: dayEpoch(m[1]), source: "json_ld_datePublished" };
  m = url.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);
  if (m) return { epoch: dayEpoch(`${m[1]}-${m[2]}-${m[3]}`), source: "url_path_date" };
  m = rawHtml.match(/<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i);
  if (m) return { epoch: dayEpoch(m[1]), source: "html_time_datetime" };
  return { epoch: null, source: "not_stated_on_page" };
}

function cacheName(vendor, url) {
  const slug = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase().replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
  return `${vendor.replace(/[^a-z0-9]+/gi, "_")}-${slug}.txt`;
}

async function get(url, ua) {
  await gap();
  const res = await fetch(url, { headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, text: await res.text(), finalUrl: res.url };
}

const BENCH_UA = "murmur-bench/0.2 (non-commercial research evaluation; +https://github.com/Ratz00007/murmur-mcp)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 murmur-bench-research-fetch";

for (const t of TARGETS) {
  let r = await get(t.url, BENCH_UA);
  let uaNote = "bench_ua";
  if (!r.ok && t.vendor === "HashiCorp") {
    console.log(`${t.vendor}: bench-UA attempt failed (${r.status}); single browser-UA retry`);
    r = await get(t.url, BROWSER_UA);
    uaNote = "browser_ua_single_retry";
  }
  if (!r.ok) {
    console.log(`${t.vendor}: FAILED ${r.status}`);
    continue;
  }
  const text = htmlToText(r.text);
  const pub = pubDate(t.url, r.text);
  const name = cacheName(t.vendor, t.url);
  writeFileSync(join(CACHE_DIR, name), `url: ${t.url}\nfinal_url: ${r.finalUrl}\nscreened_for: ${t.vendor}\npub_date: ${pub.epoch !== null ? new Date(pub.epoch * 1000).toISOString() : "not stated"} (${pub.source})\nfetch_ua: ${uaNote}\n${"-".repeat(60)}\n${text.slice(0, 20000)}`);
  console.log(`${t.vendor}: cached ${name} (${text.length} chars, pub ${pub.source} ${pub.epoch ? new Date(pub.epoch * 1000).toISOString().slice(0, 10) : "n/a"})`);
  const window = text.slice(0, 20000);
  const m = window.match(t.topicHint);
  console.log(`   topic hint ${m ? "HIT: " + JSON.stringify(window.slice(Math.max(0, m.index - 60), m.index + 160).replace(/\s+/g, " ")) : "miss"}`);
}
