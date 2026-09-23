/**
 * Stage 5 — HTML dashboard renderer. Produces a single self-contained
 * report-N.html next to the Markdown report: inline CSS, inline SVG, zero
 * JavaScript, zero external resources (no CDN, no webfonts, not even a URL —
 * the server ships a strict no-egress guarantee and the dashboard inherits
 * it). The numbers come from the same collectReportData() source of truth as
 * the Markdown renderer, so report-N.md and report-N.html can never disagree.
 */
import type { Post, ReportRecord, World } from "./types.js";
import type { Storage } from "./store/storage.js";
import { engagementPeaks, postSentiment, sentimentCurve, topPostsByEngagement } from "./aggregate.js";
import type { ReportQuote } from "./analytics.js";
import { collectReportData } from "./report.js";
import { engagementScore } from "./util/engagement.js";
import { truncate } from "./util/text.js";

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(2);
}

function sentClass(v: number): "pos" | "neg" | "neu" {
  return v > 0.05 ? "pos" : v < -0.05 ? "neg" : "neu";
}

function sentPill(v: number, label?: string): string {
  const cls = sentClass(v);
  return `<span class="pill ${cls}">${esc(label ?? fmt(v))}</span>`;
}

function sevPill(v: string | undefined): string {
  const s = (v ?? "medium").toLowerCase();
  return `<span class="pill sev-${s}">${esc(s.toUpperCase())}</span>`;
}

function platChip(plat: string): string {
  const p = plat === "tw" ? "tw" : "rd";
  return `<span class="chip plat-${p}">${p === "tw" ? "twitter" : "reddit"}</span>`;
}

// ---------------------------------------------------------------------------
// design system — Murmur Crystal (dark navy + luminous cyan), print-safe
// ---------------------------------------------------------------------------

const STYLES = `
:root{
  --bg:#0a1628;--panel:#0e1e36;--panel2:#132744;--line:#1e3a5f;--line2:#274a75;
  --text:#dbe9f7;--muted:#8aa3c0;--dim:#5f7793;
  --accent:#4da8da;--accent2:#7cc7f0;
  --pos:#3ddc97;--neg:#ff7d8c;--warn:#ffbe5c;--neu:#9db2cc;--rd:#ff9f5c;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--accent2);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 28px 96px}
.topbar{position:sticky;top:0;z-index:9;background:rgba(10,22,40,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.topbar-in{max-width:1080px;margin:0 auto;padding:10px 28px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.wordmark{font-weight:800;letter-spacing:.24em;font-size:12px;color:var(--accent);white-space:nowrap}
.wordmark b{color:var(--text);font-weight:800}
.topbar .crumb{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav{margin-left:auto;display:flex;gap:2px;flex-wrap:wrap}
.nav a{font-size:12px;color:var(--muted);padding:4px 9px;border-radius:99px}
.nav a:hover{color:var(--text);background:var(--panel2);text-decoration:none}
.hero{padding:44px 0 8px}
.hero .q{font-size:25px;line-height:1.4;font-weight:650;margin:0 0 14px;max-width:820px}
.hero .sub{color:var(--muted);font-size:13.5px;display:flex;gap:8px 18px;flex-wrap:wrap}
.hero .sub b{color:var(--text);font-weight:600}
.split{display:flex;height:12px;border-radius:7px;overflow:hidden;margin:18px 0 10px;background:var(--panel2)}
.split i{display:block;height:100%}
.split-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-bottom:8px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.verdict{border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--panel);border-radius:12px;padding:14px 18px;margin:20px 0 0;color:var(--text)}
.verdict .lbl{font-size:11px;letter-spacing:.18em;color:var(--accent);font-weight:700;text-transform:uppercase}
h2.sec{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:54px 0 6px;display:flex;align-items:center;gap:10px}
h2.sec::after{content:"";flex:1;height:1px;background:var(--line)}
h2.sec .n{color:var(--dim);font-weight:600}
.sec-sub{color:var(--muted);font-size:13px;margin:0 0 18px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(136px,1fr));gap:12px;margin-top:20px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi .k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
.kpi .v{font-size:24px;font-weight:700;margin-top:6px;font-family:var(--mono)}
.kpi .v small{font-size:12px;font-weight:500;color:var(--muted);font-family:var(--sans)}
.kpi .v.pos{color:var(--pos)}.kpi .v.neg{color:var(--neg)}.kpi .v.warn{color:var(--warn)}
.meter{height:5px;border-radius:3px;background:var(--panel2);margin-top:10px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:3px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:14px}
.card h3{margin:0 0 6px;font-size:16.5px}
.card .meta{color:var(--muted);font-size:12.5px;display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center}
.summary{font-size:16px;line-height:1.75;color:var(--text);border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--panel);border-radius:12px;padding:20px 24px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:860px){.grid2,.grid3{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.panel h4{margin:0 0 12px;font-size:13px;color:var(--muted);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.chart-note{color:var(--muted);font-size:12.5px;margin-top:10px}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin:10px 0 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--muted);font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line2);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
td.mono,th.mono{font-family:var(--mono)}
.quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:860px){.quotes{grid-template-columns:1fr}}
.qcol h4{margin:0 0 10px;font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
.qcol.pos h4{color:var(--pos)}.qcol.neg h4{color:var(--neg)}.qcol.neu h4{color:var(--neu)}
.quote{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.quote .body{font-size:13.5px;line-height:1.6;color:var(--text)}
.quote .who{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted)}
.quote .who .pid{font-family:var(--mono);color:var(--accent2)}
.pill{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:700;padding:1px 8px;border-radius:99px;border:1px solid}
.pill.pos{color:var(--pos);border-color:var(--pos);background:rgba(61,220,151,.08)}
.pill.neg{color:var(--neg);border-color:var(--neg);background:rgba(255,125,140,.08)}
.pill.neu{color:var(--neu);border-color:var(--neu);background:rgba(157,178,204,.08)}
.pill.sev-high{color:#ff5d70;border-color:#ff5d70;background:rgba(255,93,112,.1)}
.pill.sev-medium{color:var(--warn);border-color:var(--warn);background:rgba(255,190,92,.1)}
.pill.sev-low{color:var(--neu);border-color:var(--neu);background:rgba(157,178,204,.08)}
.chip{display:inline-block;font-size:11px;padding:1px 8px;border-radius:99px;background:var(--panel2);color:var(--muted);border:1px solid var(--line2)}
.chip.plat-tw{color:var(--accent2);border-color:var(--accent)}
.chip.plat-rd{color:var(--rd);border-color:var(--rd)}
.faction .head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.faction .share-bar{height:8px;border-radius:4px;background:var(--panel2);overflow:hidden;margin:10px 0}
.faction .share-bar i{display:block;height:100%}
.faction .leaders{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}
.faction .leaders .chip b{color:var(--text)}
.track{position:relative;height:14px;background:var(--panel2);border-radius:4px;overflow:hidden}
.track .zero{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line2);z-index:1}
.track .half{position:absolute;top:2px;bottom:2px;display:flex}
.track .half.left{left:0;width:50%;justify-content:flex-end}
.track .half.right{left:50%;width:50%;justify-content:flex-start}
.track .half i{display:block;height:100%;border-radius:2px}
.dvg-row{display:grid;grid-template-columns:150px 1fr 120px;gap:12px;align-items:center;margin-bottom:10px}
.dvg-row .name{font-size:13px;color:var(--text);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvg-row .divv{font-family:var(--mono);font-size:12px;color:var(--muted)}
@media(max-width:680px){.dvg-row{grid-template-columns:80px 1fr 70px}}
.stance-row{display:grid;grid-template-columns:52px 1fr;gap:10px;align-items:center;margin:6px 0}
.stance-row .lbl{font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
.stance-row .track{height:10px}
.stance-row .bar{position:absolute;top:2px;bottom:2px;border-radius:2px}
.persona .bio{color:var(--muted);font-size:13px;font-style:italic;margin:4px 0 10px}
.persona .arc{font-weight:650}
.risk .head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.risk .rid{font-family:var(--mono);font-size:12px;color:var(--dim)}
.risk .rationale{margin:8px 0 12px}
.risk .block{border-left:2px solid var(--pos);padding:2px 0 2px 14px;margin:10px 0}
.risk .block.trigger{border-color:var(--warn)}
.risk .block .t{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:2px}
.risk .block.trigger .t{color:var(--warn)}
.rec{display:grid;grid-template-columns:44px 1fr;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:12px}
.rec .num{font-family:var(--mono);font-size:22px;font-weight:700;color:var(--accent)}
.rec h3{margin:0 0 4px;font-size:16px}
.rec .impact{color:var(--muted);font-size:13px;margin-top:8px}
.rec .impact b{color:var(--pos);font-weight:600}
.tl{border-left:2px solid var(--line2);margin:6px 0 0 8px;padding-left:22px}
.tl .moment{position:relative;padding-bottom:16px}
.tl .moment::before{content:"";position:absolute;left:-28px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--bg)}
.tl .moment .r{font-family:var(--mono);font-size:11.5px;color:var(--accent2);font-weight:700}
.tl .moment .kind{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-left:8px}
.tl .moment .tx{font-size:13.5px;color:var(--text);margin-top:2px}
details{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:12px}
details summary{cursor:pointer;padding:14px 20px;font-weight:650;font-size:14px;color:var(--text);list-style:none;display:flex;align-items:center;gap:10px}
details summary::-webkit-details-marker{display:none}
details summary::after{content:"+";margin-left:auto;color:var(--accent);font-weight:700;font-size:16px}
details[open] summary::after{content:"–"}
details .inner{padding:0 20px 18px}
ul.pl{margin:6px 0;padding-left:20px}
ul.pl li{margin:4px 0}
ul.pl.pos li::marker{color:var(--pos)}
ul.pl.neg li::marker{color:var(--neg)}
ul.pl.dim li::marker{color:var(--dim)}
.foot{margin-top:60px;padding-top:18px;border-top:1px solid var(--line);color:var(--dim);font-size:12.5px}
.foot .seed{font-family:var(--mono);color:var(--muted)}
@media print{
  :root{--bg:#fff;--panel:#fff;--panel2:#f2f5f9;--line:#d7dfe9;--line2:#c3cfdc;--text:#16202e;--muted:#54677c;--dim:#7d8ea3}
  body{font-size:12px}
  .topbar{display:none}
  .nav{display:none}
  .card,.panel,.quote,.summary,.verdict,details{break-inside:avoid;border-color:#d7dfe9;background:#fff}
  details{page-break-inside:avoid}
  details:not([open]) .inner{display:none}
}
`;

// ---------------------------------------------------------------------------
// SVG chart builders — pure geometry, no external references
// ---------------------------------------------------------------------------

interface LineSeries {
  name: string;
  color: string;
  points: { round: number; value: number }[];
  width?: number;
}

/** Multi-series sentiment line chart, y fixed to [-1, 1]. */
function sentimentLineChart(series: LineSeries[], rounds: number): string {
  const W = 640;
  const H = 270;
  const L = 48;
  const R = 14;
  const T = 16;
  const B = 36;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (r: number) => L + (rounds <= 1 ? iw / 2 : ((r - 1) / (rounds - 1)) * iw);
  const y = (v: number) => T + ((1 - (v + 1) / 2) * ih);
  const parts: string[] = [];
  for (const gy of [1, 0.5, 0, -0.5, -1]) {
    const yy = y(gy);
    parts.push(`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="${gy === 0 ? "#274a75" : "#1e3a5f"}" stroke-width="${gy === 0 ? 1.5 : 1}"/>`);
    parts.push(`<text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#5f7793" font-family="ui-monospace,Menlo,monospace">${gy > 0 ? "+" : ""}${gy.toFixed(1)}</text>`);
  }
  const step = rounds > 9 ? 2 : 1;
  for (let r = 1; r <= rounds; r += step) {
    parts.push(`<text x="${x(r).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#5f7793" font-family="ui-monospace,Menlo,monospace">r${r}</text>`);
  }
  for (const s of series) {
    if (s.points.length === 0) continue;
    const pts = s.points.map((p) => `${x(p.round).toFixed(1)},${y(p.value).toFixed(1)}`);
    if (s.points.length > 1) {
      parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2.2}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    for (const p of s.points) {
      parts.push(`<circle cx="${x(p.round).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${s.color}"/>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;display:block">${parts.join("")}</svg>`;
}

/** Trajectory chart: the actual curve solid, extrapolated rounds dashed. */
function projectionChart(curve: { round: number; value: number }[], projRounds: { round: number; value: number }[]): string {
  const allRounds = Math.max(1, ...curve.map((p) => p.round), ...projRounds.map((p) => p.round));
  const W = 640;
  const H = 250;
  const L = 48;
  const R = 14;
  const T = 16;
  const B = 36;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (r: number) => L + ((r - 1) / Math.max(1, allRounds - 1)) * iw;
  const y = (v: number) => T + ((1 - (v + 1) / 2) * ih);
  const parts: string[] = [];
  for (const gy of [1, 0.5, 0, -0.5, -1]) {
    const yy = y(gy);
    parts.push(`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="${gy === 0 ? "#274a75" : "#1e3a5f"}" stroke-width="${gy === 0 ? 1.5 : 1}"/>`);
    parts.push(`<text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#5f7793" font-family="ui-monospace,Menlo,monospace">${gy > 0 ? "+" : ""}${gy.toFixed(1)}</text>`);
  }
  for (let r = 1; r <= allRounds; r += allRounds > 9 ? 2 : 1) {
    parts.push(`<text x="${x(r).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#5f7793" font-family="ui-monospace,Menlo,monospace">r${r}</text>`);
  }
  if (curve.length > 0) {
    const last = curve[curve.length - 1];
    parts.push(`<line x1="${x(last.round).toFixed(1)}" y1="${T}" x2="${x(last.round).toFixed(1)}" y2="${T + ih}" stroke="#274a75" stroke-dasharray="3 4" stroke-width="1.2"/>`);
    const pts = curve.map((p) => `${x(p.round).toFixed(1)},${y(p.value).toFixed(1)}`);
    if (curve.length > 1) parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#4da8da" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of curve) parts.push(`<circle cx="${x(p.round).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="#4da8da"/>`);
  }
  if (projRounds.length > 0 && curve.length > 0) {
    const joint = curve[curve.length - 1];
    const pts = [joint, ...projRounds].map((p) => `${x(p.round).toFixed(1)},${y(p.value).toFixed(1)}`);
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#7cc7f0" stroke-width="2" stroke-dasharray="5 5" stroke-linejoin="round"/>`);
    for (const p of projRounds) parts.push(`<circle cx="${x(p.round).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="#0e1e36" stroke="#7cc7f0" stroke-width="1.8"/>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;display:block">${parts.join("")}</svg>`;
}

/** Donut via stroke-dasharray rings (compact + deterministic). */
function donutChart(partsIn: { label: string; value: number; color: string }[], centerTop: string, centerSub: string): string {
  const total = partsIn.reduce((a, p) => a + p.value, 0);
  const C = 2 * Math.PI * 54;
  const cx = 90;
  const cy = 90;
  const rings: string[] = [];
  if (total <= 0) {
    rings.push(`<circle cx="${cx}" cy="${cy}" r="54" fill="none" stroke="#132744" stroke-width="22"/>`);
  } else {
    let acc = 0;
    for (const p of partsIn) {
      if (p.value <= 0) continue;
      const len = (p.value / total) * C;
      // dasharray: [segment, rest], offset rotates the start to the accumulated angle (-90deg top)
      rings.push(
        `<circle cx="${cx}" cy="${cy}" r="54" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
      );
      acc += len;
    }
  }
  return (
    `<svg viewBox="0 0 180 180" role="img" style="width:180px;height:180px;display:block;margin:0 auto">` +
    rings.join("") +
    `<text x="${cx}" y="88" text-anchor="middle" font-size="30" font-weight="700" fill="#dbe9f7" font-family="ui-monospace,Menlo,monospace">${esc(centerTop)}</text>` +
    `<text x="${cx}" y="110" text-anchor="middle" font-size="12" fill="#8aa3c0" font-family="-apple-system,Segoe UI,Roboto,sans-serif">${esc(centerSub)}</text>` +
    `</svg>`
  );
}

/** Engagement-per-round vertical bars. */
function engagementBars(rows: { round: number; engagement: number }[]): string {
  if (rows.length === 0) return "";
  const W = 640;
  const H = 190;
  const L = 40;
  const R = 14;
  const T = 22;
  const B = 30;
  const iw = W - L - R;
  const ih = H - T - B;
  const max = Math.max(...rows.map((r) => r.engagement), 1);
  const bw = Math.min(46, (iw / rows.length) * 0.62);
  const parts: string[] = [];
  parts.push(`<line x1="${L}" y1="${T + ih}" x2="${W - R}" y2="${T + ih}" stroke="#274a75" stroke-width="1.2"/>`);
  parts.push(`<text x="${L - 6}" y="${T + 4}" text-anchor="end" font-size="10.5" fill="#5f7793" font-family="ui-monospace,Menlo,monospace">${max}</text>`);
  rows.forEach((r, i) => {
    const cxi = L + (iw / rows.length) * (i + 0.5);
    const h = max > 0 ? (r.engagement / max) * ih : 0;
    parts.push(`<rect x="${(cxi - bw / 2).toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" fill="#4da8da" opacity="0.85"/>`);
    if (r.engagement > 0) {
      parts.push(`<text x="${cxi.toFixed(1)}" y="${(T + ih - h - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#8aa3c0" font-family="ui-monospace,Menlo,monospace">${r.engagement}</text>`);
    }
    parts.push(`<text x="${cxi.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#5f7793" font-family="ui-monospace,Menlo,monospace">r${r.round}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;display:block">${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// small HTML builders
// ---------------------------------------------------------------------------

function kpi(k: string, v: string, cls = "", meter = -1, meterColor = "#4da8da"): string {
  const m = meter >= 0 ? `<div class="meter"><i style="width:${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%;background:${meterColor}"></i></div>` : "";
  return `<div class="kpi"><div class="k">${esc(k)}</div><div class="v ${cls}">${v}</div>${m}</div>`;
}

function quoteCard(q: ReportQuote, focusName?: string): string {
  const sent = focusName && q.attrSentiment !== undefined ? `toward ${esc(focusName)} ${sentPill(q.attrSentiment)}` : sentPill(q.sentiment);
  return (
    `<div class="quote"><div class="body">&#8220;${esc(truncate(q.body, 220).replace(/\n+/g, " "))}&#8221;</div>` +
    `<div class="who"><span class="pid">${esc(q.id)}</span><b>${esc(q.by)}</b>${platChip(q.plat)}<span>round ${q.round}</span>${sent}${q.engagement !== undefined ? `<span>eng ${q.engagement}</span>` : ""}</div></div>`
  );
}

function postQuoteCard(p: Post, by: string): string {
  const eng = engagementScore(p.metrics);
  return (
    `<div class="quote"><div class="body">&#8220;${esc(truncate(p.body, 200).replace(/\n+/g, " "))}&#8221;</div>` +
    `<div class="who"><span class="pid">${esc(p.id)}</span><b>${esc(by)}</b>${platChip(p.platform === "twitter" ? "tw" : "rd")}<span>round ${p.round}</span>${sentPill(postSentiment(p))}<span>eng ${eng}</span></div></div>`
  );
}

/** CSS diverging bar: sentiment on a [-1,1] track with a center zero line. */
function dvgTrack(twitter: number | null, reddit: number | null): string {
  const tw = twitter ?? 0;
  const rd = reddit ?? 0;
  const twW = Math.min(100, (Math.abs(tw) / 2) * 100).toFixed(1);
  const rdW = Math.min(100, (Math.abs(rd) / 2) * 100).toFixed(1);
  return (
    `<div class="track"><span class="zero"></span>` +
    `<span class="half left"><i style="width:${rdW}%;background:${rd >= 0 ? "#ff9f5c" : "#c96f42"}"></i></span>` +
    `<span class="half right"><i style="width:${twW}%;background:${tw >= 0 ? "#4da8da" : "#33689a"}"></i></span>` +
    `</div>`
  );
}

/** Stance position bar for persona before/after (marker bar from center). */
function stanceTrack(v: number): string {
  const pos = ((v + 1) / 2) * 100;
  const cls = v > 0.05 ? "var(--pos)" : v < -0.05 ? "var(--neg)" : "var(--neu)";
  const left = Math.min(50, pos);
  const width = Math.abs(pos - 50);
  return `<div class="track"><span class="zero"></span><span class="bar" style="left:${left}%;width:${width}%;background:${cls}"></span></div>`;
}

// ---------------------------------------------------------------------------
// the dashboard
// ---------------------------------------------------------------------------

export function renderReportHtml(storage: Storage, world: World, report: ReportRecord): string {
  const D = collectReportData(storage, world, report);
  const d = report.narrative;
  const focusName = D.focusEntity?.name;
  const H: string[] = [];

  // ---- topbar + hero -------------------------------------------------------
  const sup = D.factions.factions.find((f) => f.key === "supporters");
  const opp = D.factions.factions.find((f) => f.key === "opponents");
  const und = D.factions.factions.find((f) => f.key === "undecided");
  H.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`);
  H.push(`<title>${esc(`Murmur — ${world.name}`)}</title><style>${STYLES}</style></head><body>`);
  H.push(
    `<div class="topbar"><div class="topbar-in"><span class="wordmark">MURMUR<b>&nbsp;SIMULATED PERSPECTIVE</b></span>` +
    `<span class="crumb">${esc(world.name)} · report v${report.version}</span>` +
    `<nav class="nav"><a href="#overview">Overview</a><a href="#reaction">Reaction</a><a href="#factions">Factions</a><a href="#platforms">Platforms</a><a href="#people">People</a><a href="#forecast">Simulated projection</a><a href="#risks">Risks</a><a href="#actions">Actions</a><a href="#evidence">Evidence</a></nav></div></div>`
  );
  H.push(`<div class="wrap">`);
  H.push(
    `<header class="hero" id="overview"><h1 class="q">${esc(world.description || report.focus || world.name)}</h1>` +
    `<div class="sub"><span><b>${world.round}</b> rounds</span><span><b>${D.personas.length}</b> personas</span><span><b>${D.entities.length}</b> entities</span>` +
    `<span>seed <b>${esc(world.seed)}</b></span><span>report <b>v${report.version}</b></span><span><b>${esc(D.date)}</b></span><span>focus <b>${esc(report.focus || "general reaction")}</b></span></div></header>`
  );
  const split = [
    sup && sup.size > 0 ? `<i style="width:${(sup.share * 100).toFixed(1)}%;background:var(--pos)" title="${esc(sup.label)}"></i>` : "",
    opp && opp.size > 0 ? `<i style="width:${(opp.share * 100).toFixed(1)}%;background:var(--neg)" title="${esc(opp.label)}"></i>` : "",
    und && und.size > 0 ? `<i style="width:${(und.share * 100).toFixed(1)}%;background:var(--neu)" title="${esc(und.label)}"></i>` : "",
  ].join("");
  H.push(`<div class="split">${split}</div>`);
  H.push(
    `<div class="split-legend">` +
    `<span><i class="dot" style="background:var(--pos)"></i>supporters ${sup ? sup.size : 0}</span>` +
    `<span><i class="dot" style="background:var(--neg)"></i>opponents ${opp ? opp.size : 0}</span>` +
    `<span><i class="dot" style="background:var(--neu)"></i>undecided ${und ? und.size : 0}</span>` +
    `<span>polarization <b>${Math.round(D.factions.polarization * 100)}/100</b></span></div>`
  );
  H.push(`<div class="verdict"><div class="lbl">Verdict</div>${esc(D.factions.verdict)} Controversy reads <b>${esc(D.controversy.label)}</b> (${D.controversy.score}/100).</div>`);

  // ---- KPIs ----------------------------------------------------------------
  const momPct = `${D.mom.pct > 0 ? "+" : ""}${Math.round(D.mom.pct * 100)}%`;
  H.push(`<div class="kpis">`);
  H.push(kpi("Simulated posts", String(D.totalPosts)));
  H.push(kpi("Total engagement", String(D.totalEng)));
  H.push(kpi("Escalation chains", String(D.chains.length)));
  H.push(kpi("Viral posts", String(D.amp.viralPosts.length)));
  H.push(kpi("Controversy", `${D.controversy.score}<small>/100 ${esc(D.controversy.label)}</small>`, D.controversy.score >= 55 ? "neg" : D.controversy.score >= 35 ? "warn" : "pos", D.controversy.score / 100, "#ffbe5c"));
  H.push(kpi("Momentum", `${esc(D.mom.trend)} <small>${momPct}</small>`, D.mom.trend === "accelerating" ? "pos" : D.mom.trend === "cooling" ? "neg" : ""));
  H.push(kpi("Most-discussed", `${D.dominant ? esc(D.dominant.entity) : "—"}`));
  H.push(`</div>`);

  // ---- executive summary + key findings --------------------------------------
  H.push(`<h2 class="sec"><span class="n">01</span>Executive Summary</h2>`);
  H.push(`<div class="summary">${esc(d.executiveSummary)}</div>`);
  if (d.scenarioRecap) {
    H.push(`<p class="sec-sub" style="margin-top:14px">${esc(d.scenarioRecap)}</p>`);
  }
  const findings = d.keyFindings ?? [];
  if (findings.length > 0) {
    H.push(`<div class="panel" style="margin-top:14px"><h4>Key findings</h4><ul class="pl">`);
    for (const f of findings) H.push(`<li>${esc(f)}</li>`);
    H.push(`</ul></div>`);
  }

  // ---- market reaction ---------------------------------------------------------
  H.push(`<h2 class="sec" id="reaction"><span class="n">04</span>Market Reaction</h2>`);
  if (D.charted.length > 0) {
    const colors = ["#4da8da", "#3ddc97", "#ffbe5c"];
    const series = D.charted.map((e, i) => ({ name: e.name, color: colors[i % colors.length], points: sentimentCurve(storage, world, e), width: D.focusEntity && e.id === D.focusEntity.id ? 2.6 : 2 }));
    H.push(`<div class="panel"><h4>Sentiment toward the top entities</h4>${sentimentLineChart(series, world.round)}`);
    H.push(`<div class="legend">${series.map((s, i) => `<span><i class="dot" style="background:${s.color}"></i>${esc(s.name)}${D.focusEntity && s.name === D.focusEntity.name ? " (focus)" : ""}</span>`).join("")}</div></div>`);
  }
  if (D.trends.length > 0) {
    const arrow = (dir: string) => (dir === "up" ? "▲" : dir === "down" ? "▼" : "■");
    const dirCls = (dir: string) => (dir === "up" ? "pos" : dir === "down" ? "neg" : "neu");
    H.push(`<div class="panel" style="margin-top:14px"><h4>Entity trend</h4><table><tr><th>Entity</th><th>Type</th><th class="mono">First</th><th class="mono">Last</th><th class="mono">Δ</th><th>Direction</th><th class="mono">Mentions</th><th class="mono">Peak</th></tr>`);
    for (const t of D.trends) {
      H.push(`<tr><td>${esc(t.entity)}</td><td>${esc(t.type)}</td><td class="mono">${fmt(t.first)}</td><td class="mono">${fmt(t.last)}</td><td class="mono">${fmt(t.delta)}</td><td><span class="pill ${dirCls(t.direction)}">${arrow(t.direction)} ${t.direction}</span></td><td class="mono">${t.volume}</td><td class="mono">${t.peakRound ?? "—"}</td></tr>`);
    }
    H.push(`</table></div>`);
  }
  H.push(
    `<p class="chart-note">Engagement is <b>${esc(D.mom.trend)}</b> — ${D.mom.firstHalf} in the first half of the run vs ${D.mom.secondHalf} in the second (${momPct}).</p>`
  );
  if (D.quotes.positive.length + D.quotes.negative.length + D.quotes.mixed.length > 0) {
    H.push(`<div class="panel" style="margin-top:14px"><h4>What the crowd actually said${focusName ? ` about ${esc(focusName)}` : ""}</h4><div class="quotes">`);
    const col = (cls: string, title: string, qs: ReportQuote[]) =>
      qs.length > 0 ? `<div class="qcol ${cls}"><h4>${esc(title)}</h4>${qs.map((q) => quoteCard(q, focusName)).join("")}</div>` : "";
    H.push(col("pos", "Champions said", D.quotes.positive));
    H.push(col("neg", "Critics said", D.quotes.negative));
    H.push(col("neu", "On the fence", D.quotes.mixed));
    H.push(`</div></div>`);
  }

  // ---- faction map ---------------------------------------------------------------
  H.push(`<h2 class="sec" id="factions"><span class="n">05</span>Faction Map</h2>`);
  const fcolors: Record<string, string> = { supporters: "#3ddc97", opponents: "#ff7d8c", undecided: "#9db2cc" };
  const donutParts = D.factions.factions.filter((f) => f.size > 0).map((f) => ({ label: f.label, value: f.size, color: fcolors[f.key] }));
  H.push(`<div class="grid2" style="grid-template-columns:260px 1fr;align-items:center">`);
  H.push(`<div>${donutChart(donutParts, String(D.personas.length), "personas")}</div>`);
  H.push(
    `<div><p style="margin:0 0 10px">Polarization <b>${Math.round(D.factions.polarization * 100)}/100</b> — ` +
    (D.factions.polarization >= 0.6
      ? "the population has hardened into opposing camps."
      : D.factions.polarization >= 0.35
        ? "camps are forming but the middle is still contested."
        : "the population has not yet hardened.") + `</p>` +
    `<ul class="pl dim">${D.controversy.drivers.map((x) => `<li>${esc(x.label)}</li>`).join("")}</ul></div>`
  );
  H.push(`</div>`);
  for (const f of D.factions.factions) {
    if (f.size === 0) continue;
    H.push(`<div class="card faction" style="margin-top:14px;border-left:3px solid ${fcolors[f.key]}">`);
    H.push(`<div class="head"><h3>${esc(f.label)}</h3><span class="chip">${f.size} ${f.size === 1 ? "persona" : "personas"} · ${Math.round(f.share * 100)}%</span><span class="chip">avg stance ${fmt(f.avgStance)}</span><span class="chip">${f.posts} posts</span><span class="chip">${f.engagement} eng</span></div>`);
    H.push(`<div class="share-bar"><i style="width:${(f.share * 100).toFixed(1)}%;background:${fcolors[f.key]}"></i></div>`);
    if (f.leaders.length > 0) {
      H.push(`<div class="leaders">${f.leaders.map((l) => `<span class="chip"><b>${esc(l.handle)}</b> · ${esc(l.archetype)} · ${l.posts} posts</span>`).join("")}</div>`);
    }
    for (const q of f.quotes) H.push(quoteCard(q, D.factions.focusEntity));
    if (f.sentimentByRound.length >= 2) {
      const a = f.sentimentByRound[0];
      const b = f.sentimentByRound[f.sentimentByRound.length - 1];
      H.push(`<p class="chart-note">Faction sentiment toward ${esc(D.factions.focusEntity)} moved from ${fmt(a.value)} (round ${a.round}) to ${fmt(b.value)} (round ${b.round}).</p>`);
    }
    H.push(`</div>`);
  }

  // ---- platform divergence -----------------------------------------------------------
  H.push(`<h2 class="sec" id="platforms"><span class="n">06</span>Platform Divergence</h2>`);
  H.push(
    `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">` +
    kpi("Twitter posts / eng", `${D.cross.totals.twitterPosts} <small>/ ${D.cross.totals.twitterEngagement}</small>`) +
    kpi("Reddit posts / eng", `${D.cross.totals.redditPosts} <small>/ ${D.cross.totals.redditEngagement}</small>`) +
    kpi("Escalations tw / rd", `${D.cross.totals.twitterEscalations} <small>/ ${D.cross.totals.redditEscalations}</small>`) +
    `</div>`
  );
  const withBoth = D.cross.rows.filter((r) => r.twitter !== null && r.reddit !== null);
  if (withBoth.length > 0) {
    H.push(`<div class="panel" style="margin-top:14px"><h4>Sentiment by venue <span style="float:right;font-weight:400;text-transform:none;letter-spacing:0">reddit ← · → twitter</span></h4>`);
    for (const r of D.cross.rows) {
      H.push(`<div class="dvg-row"><span class="name">${esc(r.entity)}</span>${dvgTrack(r.twitter, r.reddit)}<span class="divv">Δ ${r.divergence.toFixed(2)} · ${r.twPosts}/${r.rdPosts} posts</span></div>`);
    }
    H.push(`</div>`);
    if (D.cross.maxDivergence && D.cross.maxDivergence.value >= 0.2) {
      H.push(`<p class="chart-note">The largest split is <b>${esc(D.cross.maxDivergence.entity)}</b> (Δ ${D.cross.maxDivergence.value.toFixed(2)} between platforms) — the same story is landing differently on Twitter than on Reddit.</p>`);
    }
  }

  // ---- persona spotlight ---------------------------------------------------------------
  if (D.arcs.length > 0) {
    H.push(`<h2 class="sec" id="people"><span class="n">07</span>Persona Spotlight</h2>`);
    H.push(`<div class="grid3">`);
    for (const a of D.arcs) {
      H.push(`<div class="card persona">`);
      H.push(`<h3>${esc(a.name)} <span style="color:var(--muted);font-weight:400;font-size:13px">${esc(a.handle)}</span></h3>`);
      H.push(`<div class="meta"><span class="chip">${esc(a.archetype)}</span><span class="chip">${a.posts} posts</span><span class="chip">${a.engagement} eng</span><span class="pill ${sentClass(a.delta)} arc">${esc(a.arcLabel)}</span></div>`);
      H.push(`<p class="bio">${esc(a.bio)}</p>`);
      H.push(`<div class="stance-row"><span class="lbl">before</span>${stanceTrack(a.focusStart)}</div>`);
      H.push(`<div class="stance-row"><span class="lbl">after</span>${stanceTrack(a.focusEnd)}</div>`);
      H.push(`<p class="chart-note">stance ${fmt(a.focusStart)} → ${fmt(a.focusEnd)}${a.delta !== 0 ? ` (shift ${fmt(a.delta)})` : ""}</p>`);
      if (a.signatureQuote) H.push(quoteCard(a.signatureQuote, focusName));
      H.push(`</div>`);
    }
    H.push(`</div>`);
  }

  // ---- simulated projection ------------------------------------------------------------------
  H.push(`<h2 class="sec" id="forecast"><span class="n">08</span>Trajectory Simulated Projection</h2>`);
  if (D.projection && D.focusEntity) {
    const actual = D.projection.points.filter((p) => !p.projected);
    const proj = D.projection.points.filter((p) => p.projected);
    if (D.ensemble && D.ensemble.length > 0) {
      // Ensemble UQ: seeded P10–P90 band replaces the single extrapolated line.
      const runs = world.config.ensemble?.runCount ?? 5;
      const svgW = 640, svgH = 200, padL = 34, padR = 10, padT = 10, padB = 22;
      const rounds = D.ensemble.map((b) => b.round);
      const r0 = Math.min(...rounds), r1 = Math.max(...rounds);
      const x = (r: number) => padL + (r1 === r0 ? (svgW - padL - padR) / 2 : ((r - r0) / (r1 - r0)) * (svgW - padL - padR));
      const y = (v: number) => padT + ((1 - Math.max(-1, Math.min(1, v))) / 2) * (svgH - padT - padB);
      const lo = D.ensemble.map((b) => `${x(b.round).toFixed(1)},${y(b.p10).toFixed(1)}`).join(" ");
      const hi = [...D.ensemble].reverse().map((b) => `${x(b.round).toFixed(1)},${y(b.p90).toFixed(1)}`).join(" ");
      const p50 = D.ensemble.map((b) => `${x(b.round).toFixed(1)},${y(b.p50).toFixed(1)}`).join(" ");
      const recPts = actual.map((p) => `${x(p.round).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
      const axis = [1, 0, -1].map((v) => `<text x="6" y="${Number((y(v) + 3).toFixed(1))}" font-size="10" fill="var(--dim)">${v > 0 ? "+1" : String(v)}</text>`).join("");
      const labels = rounds.map((r) => `<text x="${x(r).toFixed(1)}" y="${svgH - 6}" font-size="10" fill="var(--dim)" text-anchor="middle">r${r}</text>`).join("");
      H.push(
        `<div class="panel"><h4>Outlook — ${esc(D.focusEntity.name)} <span style="float:right;font-weight:400;text-transform:none;letter-spacing:0">shaded = P10–P90 ensemble · line = recorded + P50</span></h4>` +
          `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}">` +
          `<line x1="${padL}" y1="${y(0).toFixed(1)}" x2="${svgW - padR}" y2="${y(0).toFixed(1)}" stroke="var(--line2)" stroke-width="1"/>` +
          `<polygon points="${lo} ${hi}" fill="var(--accent)" fill-opacity="0.18"/>` +
          `<polyline points="${recPts}" fill="none" stroke="var(--accent2)" stroke-width="2"/>` +
          `<polyline points="${p50}" fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="5 4"/>` +
          axis + labels +
          `</svg></div>`
      );
      const last = D.ensemble[D.ensemble.length - 1];
      const opened = D.ensemble.some((b) => b.p10 !== b.p90);
      H.push(
        `<p class="chart-note">Simulated projection — seeded ensemble of ${runs} runs (least-squares trend with per-run slope jitter): recorded rounds carry no band (every run shares the recorded history); the band opens on projected rounds. ` +
          (opened ? `Round ${last.round}: P10 ${fmt(last.p10)} · P50 ${fmt(last.p50)} · P90 ${fmt(last.p90)}. ` : "") +
          `Spread reflects model jitter only — a simulated perspective, not a claim about the future.</p>`
      );
    } else {
      H.push(`<div class="panel"><h4>Outlook — ${esc(D.focusEntity.name)} <span style="float:right;font-weight:400;text-transform:none;letter-spacing:0">dashed = extrapolated</span></h4>${projectionChart(actual, proj)}</div>`);
      H.push(
        `<p class="chart-note">Simulated projection — single-run least-squares trend for <b>${esc(D.focusEntity.name)}</b> (no new external events; no uncertainty band): slope ${D.projection.slope >= 0 ? "+" : ""}${D.projection.slope.toFixed(2)} per round → ` +
          proj.map((p) => `round ${p.round} ≈ ${fmt(p.value)}`).join(", ") +
          `. Direction: <b>${D.projection.direction}</b>.</p>`
      );
    }
  }
  H.push(`<div class="summary" style="margin-top:14px">${esc(d.trajectory)}</div>`);

  // ---- risk register ----------------------------------------------------------------------------
  H.push(`<h2 class="sec" id="risks"><span class="n">09</span>Risk Register</h2>`);
  for (const [i, r] of (d.risks ?? []).entries()) {
    H.push(`<div class="card risk">`);
    H.push(`<div class="head"><span class="rid">R${i + 1}</span><h3 style="margin:0">${esc(r.title)}</h3>${sevPill(r.severity)}<span class="chip">likelihood ${esc((r.likelihood ?? "medium").toLowerCase())}</span></div>`);
    H.push(`<p class="rationale">${esc(r.rationale)}</p>`);
    if (r.mitigation) H.push(`<div class="block"><div class="t">Mitigation</div>${esc(r.mitigation)}</div>`);
    if (r.trigger) H.push(`<div class="block trigger"><div class="t">Early-warning trigger</div>${esc(r.trigger)}</div>`);
    const evPosts = (r.postIds ?? []).map((pid) => storage.getPost(world.id, pid)).filter((p): p is Post => p !== null);
    if (evPosts.length > 0) {
      H.push(`<div class="t" style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:12px 0 6px">Evidence from the run</div>`);
      for (const p of evPosts) H.push(postQuoteCard(p, D.handles.get(p.personaId) ?? p.personaId));
    }
    H.push(`</div>`);
  }

  // ---- recommendations ------------------------------------------------------------------------------
  if ((d.recommendations ?? []).length > 0) {
    H.push(`<h2 class="sec" id="actions"><span class="n">10</span>Recommendations</h2>`);
    for (const [i, r] of (d.recommendations ?? []).entries()) {
      H.push(`<div class="rec"><div class="num">${String(i + 1).padStart(2, "0")}</div><div><h3>${esc(r.title)}</h3><p style="margin:4px 0 0">${esc(r.action)}</p><p class="impact"><b>Expected impact</b> — ${esc(r.expectedImpact)}</p></div></div>`);
    }
  }

  // ---- confidence & limitations ------------------------------------------------------------------------
  H.push(`<h2 class="sec"><span class="n">11</span>Confidence &amp; Limitations</h2>`);
  H.push(`<div class="grid2">`);
  H.push(`<div class="panel"><h4>Strong signals</h4><ul class="pl pos">${(d.confidence?.strongSignals ?? []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`);
  const contested = d.confidence?.contested ?? [];
  H.push(`<div class="panel"><h4>Contested</h4>${contested.length > 0 ? `<ul class="pl neg">${contested.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : `<p class="chart-note">No contested findings — the population did not split on the same evidence.</p>`}</div>`);
  H.push(`</div>`);
  const limitations = d.limitations && d.limitations.length > 0 ? d.limitations : [
    `The simulated population is ${D.personas.length} personas — directional, not a census; treat percentages as tendencies.`,
    "Sentiment is lexical over simulated text; irony and coded language can under- or over-score.",
    "Extrapolations assume no new external events; real launches rarely get that courtesy.",
  ];
  H.push(`<div class="panel" style="margin-top:14px"><h4>Limitations</h4><ul class="pl dim">${limitations.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`);

  // ---- timeline ------------------------------------------------------------------------------------------
  if (D.moments.length > 0) {
    H.push(`<h2 class="sec"><span class="n">—</span>Timeline of the Run</h2>`);
    H.push(`<div class="tl">`);
    for (const m of D.moments) {
      H.push(`<div class="moment"><span class="r">round ${m.round}</span><span class="kind">${esc(m.kind)}</span><div class="tx">${esc(m.text)}${m.postIds.length > 0 ? ` <span class="pid" style="font-family:var(--mono);color:var(--accent2);font-size:12px">${m.postIds.map((id) => esc(id)).join(" ")}</span>` : ""}</div></div>`);
    }
    H.push(`</div>`);
  }

  // ---- appendices --------------------------------------------------------------------------------------------
  H.push(`<h2 class="sec" id="evidence"><span class="n">A–E</span>Evidence &amp; Appendices</h2>`);
  H.push(`<details><summary>Appendix A — Round-by-round statistics</summary><div class="inner">`);
  H.push(`<table><tr><th>Round</th><th class="mono">Twitter</th><th class="mono">Reddit</th><th class="mono">Engagement</th><th class="mono">Escalations</th><th class="mono">Injections</th><th class="mono">Lurkers</th></tr>`);
  for (const r of D.rows) {
    H.push(`<tr><td class="mono">r${r.round}</td><td class="mono">${r.twitter}</td><td class="mono">${r.reddit}</td><td class="mono">${r.engagement}</td><td class="mono">${r.escalations}</td><td class="mono">${r.injections}</td><td class="mono">${r.lurkers}</td></tr>`);
  }
  H.push(`</table>`);
  H.push(`<div style="margin-top:14px">${engagementBars(D.rows)}</div>`);
  const peaks = engagementPeaks(D.rows);
  if (peaks.length > 0) H.push(`<p class="chart-note">Engagement peaks (mean + 2σ): rounds ${peaks.map((p) => `r${p}`).join(", ")}.</p>`);
  H.push(`</div></details>`);

  H.push(`<details><summary>Appendix B — Escalation chains</summary><div class="inner">`);
  if (D.chains.length > 0) {
    for (const c of D.chains.slice(0, 4)) {
      H.push(`<h4 style="margin:14px 0 8px;font-size:13px;color:var(--muted)">Chain <span class="pid" style="font-family:var(--mono);color:var(--accent2)">${esc(c.rootId)}</span> · depth ${c.depth} · final ${fmt(c.finalSentiment)} · severity ${c.severity.toFixed(2)}</h4>`);
      H.push(`<div class="tl">`);
      for (const pid of c.path) {
        const p = storage.getPost(world.id, pid);
        if (!p) continue;
        H.push(`<div class="moment"><span class="r">${esc(pid)}</span><div class="tx"><b>${esc(D.handles.get(p.personaId) ?? p.personaId)}</b>: &#8220;${esc(truncate(p.body, 140))}&#8221;</div></div>`);
      }
      H.push(`</div>`);
    }
  } else {
    H.push(`<p class="chart-note">No escalation chains formed this run — disagreement stayed at post level instead of threading into reply spirals. That caps how fast either camp can recruit: intensity has nowhere to compound.</p>`);
  }
  H.push(`</div></details>`);

  H.push(`<details><summary>Appendix C — Amplification</summary><div class="inner">`);
  if (D.amp.viralPosts.length > 0) {
    H.push(`<table><tr><th>Post</th><th>By</th><th class="mono">Round</th><th class="mono">Eng</th><th>Amplified by</th></tr>`);
    for (const v of D.amp.viralPosts) {
      H.push(`<tr><td class="mono">${esc(v.id)}</td><td>${esc(v.by)}</td><td class="mono">${v.round}</td><td class="mono">${v.engagement}</td><td>${v.amplifiers.length > 0 ? esc(v.amplifiers.join(", ")) : "organic reach"}</td></tr>`);
    }
    H.push(`</table>`);
  } else {
    H.push(`<p class="chart-note">No post crossed the virality threshold this run — reach stayed inside the follow graph.</p>`);
  }
  H.push(`<p class="chart-note">Organic (engine-simulated bystander) engagement share: <b>${Math.round(D.amp.organicEngagementShare * 100)}%</b> — the rest came from activated personas engaging each other's content.</p>`);
  H.push(`</div></details>`);

  H.push(`<details><summary>Appendix D — Post index (top 25 by engagement)</summary><div class="inner">`);
  H.push(`<table><tr><th>Id</th><th>By</th><th>Plat</th><th class="mono">R</th><th class="mono">Sentiment</th><th class="mono">Eng</th><th>Excerpt</th></tr>`);
  for (const { post, sentiment } of topPostsByEngagement(storage, world, 25)) {
    const eng = engagementScore(post.metrics);
    H.push(`<tr><td class="mono">${esc(post.id)}</td><td>${esc(D.handles.get(post.personaId) ?? post.personaId)}</td><td>${post.platform === "twitter" ? "tw" : "rd"}</td><td class="mono">${post.round}</td><td>${sentPill(sentiment)}</td><td class="mono">${eng}</td><td style="color:var(--muted)">${esc(truncate(post.body, 90))}</td></tr>`);
  }
  H.push(`</table></div></details>`);

  H.push(`<details><summary>Appendix E — Methodology &amp; reproducibility</summary><div class="inner">`);
  H.push(
    `<p style="font-size:13.5px">Each round the engine activated a weighted subset of the ${D.personas.length}-persona population, composed personalized feeds from the follow graph and platform mechanics, and the host LLM wrote posts, replies and votes in character. ` +
    `Organic engagement, virality, stance migration (10%/round toward expressed sentiment), pairwise influence over the follow graph (Deffuant bounded confidence: ε=${world.config.dynamics?.epsilon ?? 0.4}, μ=${world.config.dynamics?.mu ?? 0.2}, ${(world.config.dynamics?.abstentionChance ?? 0.1) * 100}% chance of slight disengagement beyond ε) and escalation chains are deterministic functions of the recorded run. ` +
    `Sentiment is a lexical score over real post text, attributed to entities by mention. The report narrative was drafted by the host coding agent against the statistics pack; every quoted post id resolves to a stored post.</p>`
  );
  H.push(
    `<p class="chart-note"><b>Reproduce:</b> initialize a world with seed <span class="seed">${esc(world.seed)}</span>, attach the same seeds, and drive the same host model through the plan/submit protocol. The engine's state — and therefore every number in this report — replays identically.</p>`
  );
  H.push(`<p class="chart-note"><b>Top voices:</b> ${D.topBoard.map((l) => `${esc(l.handle)} (${esc(l.archetype)}, ${l.posts} posts, ${l.engagementReceived} eng)`).join(" · ")}</p>`);
  H.push(`</div></details>`);

  // ---- footer ----------------------------------------------------------------------------------------------
  H.push(
    `<footer class="foot">Murmur simulated perspective dashboard · deterministic statistics by the engine, narrative by the host coding agent · generated ${esc(D.date)} from world <b>${esc(world.slug)}</b> · report v${report.version} · ` +
    `this file is self-contained (inline CSS + SVG, no external requests) and safe to commit, share or print.</footer>`
  );
  H.push(`</div></body></html>`);
  return H.join("\n");
}


