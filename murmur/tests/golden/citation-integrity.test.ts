/**
 * Citation integrity — a rendered report may only cite what the world actually
 * stored, and every headline number it quotes must recompute from storage/
 * analytics to the same value. Deterministic: one seeded pipeline, then four
 * independent checks over the rendered Markdown.
 *
 * (a) every po_N cited in the rendered Markdown resolves to a stored post
 * (b) quoted text fragments match the stored post bodies (same truncation)
 * (c) cited headline stats (polarization, top-post engagement) recompute to
 *     the same values from storage/analytics
 * (d) injecting a fabricated po_999 citation makes the checker throw
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as engine from "@murmur/engine";
import { runPipeline } from "../helpers/pipeline.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cite-"));

/** Every po_N token in the markdown, deduped, in first-seen order. */
function citedIds(md: string): string[] {
  return [...new Set([...md.matchAll(/\bpo_\d+\b/g)].map((m) => m[0]))];
}

/** (a) — throw if any cited post id does not resolve in storage. */
function assertResolves(md: string, storage: engine.Storage, worldId: string): void {
  const missing = citedIds(md).filter((id) => !storage.getPost(worldId, id));
  if (missing.length > 0) throw new Error(`unresolved post citation(s): ${missing.join(", ")}`);
}

/**
 * (b) + the per-quote engagement citation — every quoteLine block and every
 * escalation-chain line must reproduce the stored body under the renderer's
 * own truncation, and any "engagement N" in a quote header must recompute.
 */
function assertQuotesMatch(
  md: string,
  storage: engine.Storage,
  worldId: string
): { quotes: number; chains: number } {
  const lines = md.split("\n");
  let quotes = 0;
  let chains = 0;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^> \*\*(po_\d+)\*\* · /);
    if (head) {
      const id = head[1];
      let j = i + 1;
      if (lines[j] === ">") j++; // quoteLine's separator line
      const frag = lines[j] !== undefined && lines[j].startsWith("> ") ? lines[j].slice(2) : null;
      expect(frag, `quote block for ${id} must carry a fragment`).not.toBeNull();
      const post = storage.getPost(worldId, id);
      expect(post, `quoted post ${id} must resolve`).not.toBeNull();
      const expected = engine.truncate(post!.body, 220).replace(/\n+/g, " ");
      if (frag !== expected) {
        throw new Error(`quote fragment mismatch for ${id}:\n  rendered: ${frag}\n  stored:   ${expected}`);
      }
      const eng = lines[i].match(/· engagement (-?\d+)/);
      if (eng) {
        const recomputed = engine.engagementScore(post!.metrics);
        if (recomputed !== Number(eng[1])) {
          throw new Error(`engagement mismatch for ${id}: rendered ${eng[1]}, recomputed ${recomputed}`);
        }
      }
      quotes++;
    }
    const chain = lines[i].match(/^[ \t]*[→↳] \*\*(po_\d+)\*\* .*: "(.*)"$/);
    if (chain) {
      const id = chain[1];
      const post = storage.getPost(worldId, id);
      expect(post, `chained post ${id} must resolve`).not.toBeNull();
      const expected = engine.truncate(post!.body, 140);
      if (chain[2] !== expected) {
        throw new Error(`chain excerpt mismatch for ${id}:\n  rendered: ${chain[2]}\n  stored:   ${expected}`);
      }
      chains++;
    }
  }
  return { quotes, chains };
}


/**
 * (c) — polarization and the Appendix C/D engagement tables must recompute
 * from analytics/storage to the exact rendered values.
 */
function assertHeadlineStats(md: string, storage: engine.Storage, world: engine.World): void {
  // --- polarization ---------------------------------------------------------
  // The faction pie title names the focus the renderer actually used.
  const pie = md.match(/[ \t]+title "Population split - (.+)"\n/);
  expect(pie, "faction pie title must be rendered").not.toBeNull();
  const focusName = pie![1];
  const focus = storage.listEntities(world.id).find((e) => e.name === focusName) ?? null;
  const recomputed = engine.factionAnalysis(storage, world, focus);
  const renderedPolarizations = [...md.matchAll(/polarization[^0-9]*(\d+)\/100/gi)].map((m) => Number(m[1]));
  expect(renderedPolarizations.length, "at least one polarization stat must be rendered").toBeGreaterThanOrEqual(1);
  for (const rendered of renderedPolarizations) {
    expect(Math.round(recomputed.polarization * 100), "polarization must recompute to the rendered value").toBe(rendered);
  }

  // --- Appendix D: top-post engagement -------------------------------------
  const appD = md.split("## Appendix D — Post Index (evidence)")[1];
  expect(appD, "Appendix D must be rendered").toBeTruthy();
  const rows = appD!.split("\n").filter((l) => /^\| po_\d+ \|/.test(l));
  expect(rows.length, "Appendix D must list top posts").toBeGreaterThanOrEqual(6);
  const renderedRows = rows.map((l) => {
    const parts = l.split("|"); // | id | by | plat | R | sentiment | engagement | excerpt |
    if (parts.length !== 9) throw new Error(`malformed Appendix D row: ${l}`);
    return { id: parts[1].trim(), engagement: Number(parts[6].trim()) };
  });
  const recomputedTop = engine.topPostsByEngagement(storage, world, 25);
  expect(renderedRows.map((r) => r.id), "Appendix D order must match recomputed top posts").toEqual(
    recomputedTop.map((r) => r.post.id)
  );
  for (const r of renderedRows) {
    const post = storage.getPost(world.id, r.id);
    expect(post).not.toBeNull();
    expect(engine.engagementScore(post!.metrics), `engagement for ${r.id} must recompute`).toBe(r.engagement);
  }

  // --- Appendix C: viral posts (present only if any crossed the threshold) --
  const appC = md.split("## Appendix C — Amplification")[1]?.split("## Appendix D")[0] ?? "";
  const viralRows = appC.split("\n").filter((l) => /^\| `po_\d+` \|/.test(l));
  const threshold = world.config.engagement.viralityThreshold * Math.max(1, storage.countPersonas(world.id) / 24);
  for (const l of viralRows) {
    const parts = l.split("|"); // | `id` | by | round | engagement | amplifiers | excerpt |
    if (parts.length !== 8) throw new Error(`malformed Appendix C row: ${l}`);
    const id = parts[1].trim().replace(/`/g, "");
    const engagement = Number(parts[4].trim());
    const post = storage.getPost(world.id, id);
    expect(post).not.toBeNull();
    expect(engine.engagementScore(post!.metrics), `viral engagement for ${id} must recompute`).toBe(engagement);
    expect(engagement, `viral post ${id} must have crossed the recomputed threshold`).toBeGreaterThanOrEqual(threshold);
  }
}


describe("citation integrity", () => {
  let run: Awaited<ReturnType<typeof runPipeline>>;
  let md: string;
  let dir: string;

  beforeAll(async () => {
    dir = tmp();
    run = await runPipeline(engine, { cwd: dir, seed: "cite-integrity", rounds: 4, population: 12 });
    md = run.markdown;
  }, 60_000);

  afterAll(() => {
    if (run) run.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("(a) every po_N cited in the rendered markdown resolves to a stored post", () => {
    const ids = citedIds(md);
    expect(ids.length, "the report must cite posts at all").toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      expect(run.storage.getPost(run.worldId, id), `citation ${id} must resolve`).not.toBeNull();
    }
    expect(() => assertResolves(md, run.storage, run.worldId)).not.toThrow();
  });

  it("(b) quoted text fragments match the stored post bodies", () => {
    const { quotes, chains } = assertQuotesMatch(md, run.storage, run.worldId);
    // every risk renders a quoteLine per cited post (2-3 risks × 2-3 posts)
    expect(quotes, "quote blocks must be present to verify").toBeGreaterThanOrEqual(6);
    expect(chains).toBeGreaterThanOrEqual(0);
  });

  it("(c) headline stats (polarization, top-post engagement) recompute to the same values", () => {
    assertHeadlineStats(md, run.storage, run.world);
  });

  it("(d) a fabricated po_999 citation makes the checker fail", () => {
    // inject a fabricated evidence block
    const injected =
      md + "\n\n> **po_999** · @ghost · twitter · round 9 · sentiment +0.00 · engagement 99\n>\n> fabricated evidence\n";
    expect(() => assertResolves(injected, run.storage, run.worldId)).toThrow(/po_999/);
    // tamper in place: swap the first backticked citation for po_999
    const tampered = md.replace(/`po_\d+`/, "`po_999`");
    expect(tampered, "a real backticked citation must exist to tamper with").not.toBe(md);
    expect(() => assertResolves(tampered, run.storage, run.worldId)).toThrow(/po_999/);
    // and the quote checker rejects a fabricated quote block too
    const fakeQuote = md + "\n\n> **po_999** · @ghost · twitter · round 9 · sentiment +0.00\n>\n> not a real post\n";
    expect(() => assertQuotesMatch(fakeQuote, run.storage, run.worldId)).toThrow(/po_999|resolve/);
  });
});
