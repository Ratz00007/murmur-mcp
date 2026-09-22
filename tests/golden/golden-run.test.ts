/**
 * Golden-run tests: the full five-stage pipeline driven by the deterministic
 * mock brain. Asserts byte-identical replay (the reproducibility promise),
 * PRD acceptance criteria, and the F5 injection effect.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as engine from "@murmur/engine";
import { runPipeline } from "../helpers/pipeline.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-golden-"));

describe("golden run", () => {
  it("replays byte-identically (determinism contract)", async () => {
    const dirA = tmp();
    const dirB = tmp();
    const runA = await runPipeline(engine, { cwd: dirA, seed: "golden-42", rounds: 4, population: 12 });
    const runB = await runPipeline(engine, { cwd: dirB, seed: "golden-42", rounds: 4, population: 12 });
    expect(runA.dump()).toBe(runB.dump());
    expect(runA.world.round).toBe(4);
    runA.close();
    runB.close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  it("meets the pipeline acceptance criteria (F1-F6)", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "golden-acc", rounds: 5, population: 12 });
    try {
      // F2: 10-30 entities extracted, zero rejects
      expect(run.entityCount).toBeGreaterThanOrEqual(10);
      expect(run.entityCount).toBeLessThanOrEqual(30);
      // F4: population stored
      expect(run.storage.countPersonas(run.worldId)).toBe(12);
      // F5: posts exist across platforms, all rounds completed
      expect(run.world.round).toBe(5);
      const posts = run.storage.listPosts(run.worldId, {});
      expect(posts.length).toBeGreaterThan(10);
      const platforms = new Set(posts.map((p) => p.platform));
      expect(platforms.has("twitter")).toBe(true);
      expect(platforms.has("reddit")).toBe(true);
      // NFR: every batch task stayed under the response budget
      for (const t of run.batchTokens) expect(t).toBeLessThanOrEqual(12000);
      // F3: mermaid graph written
      const slug = run.world.slug;
      expect(fs.existsSync(path.join(dir, ".murmur", slug, "graph.mmd"))).toBe(true);
      // F6: report written, versioned, with required sections
      expect(fs.existsSync(run.reportPath)).toBe(true);
      expect(run.markdown).toContain("# Murmur Prediction Report");
      expect(run.markdown).toContain("```mermaid");
      expect(run.markdown).toContain("## At a Glance");
      expect(run.markdown).toContain("## 9. Risk Register");
      expect(run.markdown).toContain("## 5. Faction Map");
      expect(run.markdown).toContain("## 10. Recommendations");
      expect(run.markdown).toContain("## Appendix A — Round-by-Round Statistics");
      expect(run.markdown).toContain("## 11. Confidence & Limitations");
      expect(run.markdown).toContain("xychart-beta");
      expect(run.markdown).toContain("Mitigation —");
      // every round recorded stats
      for (let r = 1; r <= 5; r++) {
        expect(engine.roundSummary(run.storage, run.world, r)).not.toBeNull();
      }
    } finally {
      run.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("F5: an injected event measurably shifts the next sentiment reading", async () => {
    const dirBase = tmp();
    const dirInject = tmp();
    const base = await runPipeline(engine, { cwd: dirBase, seed: "golden-inj", rounds: 4, population: 12 });
    const inj = await runPipeline(engine, {
      cwd: dirInject,
      seed: "golden-inj",
      rounds: 4,
      population: 12,
      injectAtRound: 3,
      injectText: "Acme Cloud raises the Pro plan price by 40% overnight",
    });
    try {
      const baseS = engine.roundSummary(base.storage, base.world, 3)!.sentimentByEntity;
      const injS = engine.roundSummary(inj.storage, inj.world, 3)!.sentimentByEntity;
      const key = "Acme Cloud";
      const delta = Math.abs((injS[key] ?? 0) - (baseS[key] ?? 0));
      expect(delta).toBeGreaterThanOrEqual(0.1);
      // and at least one round-3 post reacts to the event text
      const reacting = inj.storage
        .listPosts(inj.worldId, { minRound: 3, maxRound: 3 })
        .filter((p) => p.body.includes("40%"));
      expect(reacting.length).toBeGreaterThanOrEqual(1);
    } finally {
      base.close();
      inj.close();
      fs.rmSync(dirBase, { recursive: true, force: true });
      fs.rmSync(dirInject, { recursive: true, force: true });
    }
  });

  it("resumes after a simulated crash (reopen the store at the stage boundary)", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "golden-resume", rounds: 3, population: 10 });
    const slug = run.world.slug;
    const roundBefore = run.world.round;
    run.close(); // "crash"
    const ws = new engine.Workspace(dir);
    const storage = new engine.Storage(engine.openDatabase(ws.dbPath));
    const world = storage.getWorld(slug)!;
    expect(world.round).toBe(roundBefore);
    expect(world.stage).toBe("reported"); // full pipeline incl. report — resumable at this boundary
    const status = engine.worldStatus(storage, world);
    expect(status.counts.posts).toBeGreaterThan(0);
    expect(status.next).toContain("interview");
    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
