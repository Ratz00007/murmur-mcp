/**
 * The Objection Dossier: validation in both directions.
 *
 * The dossier is the repositioned core deliverable — ranked objections with
 * steelmen and evidence, the counter-case, the weakest claim, and a test plan
 * for real humans — held to the same integrity rules as the report. What is
 * pinned here:
 *
 * 1. A dossier draft with fabricated post ids is REJECTED naming the field.
 * 2. A dossier draft with a fabricated number is REJECTED naming the value.
 * 3. A run-grounded dossier draft is ACCEPTED — the verifier must not reject
 *    a correct draft, which is the false-positive trap in the other direction.
 * 4. The dossier task mints exactly ONE task id: buildDossierTask must not
 *    leave a stray saved report task behind.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as engine from "@murmur/engine";
import { runPipeline } from "../helpers/pipeline.mjs";
import { completeReportTask } from "../helpers/mock-brain.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-dossier-"));

/** A hand-built dossier draft against the run's real posts. */
function goodDossier(postIds: string[]) {
  const [a, b, c] = postIds;
  return {
    objections: [
      {
        label: "Price shock without grandfathering",
        steelman: `Across this run the opposition hardened around the price change itself rather than any single feature: sentiment toward the focus fell while engagement concentrated on a handful of critical voices, and the loudest threads frame the change as a loyalty test the vendor is failing.`,
        blastRadius: "high",
        threatenedDecision: "Raising the Pro plan price on the announced date.",
        postIds: [a, b],
      },
      {
        label: "Migration path is unclear",
        steelman: `Critics repeatedly ask how existing projects move without downtime, and no post in the run answers that question with specifics. An unanswered migration question becomes a churn reason within days of launch.`,
        blastRadius: "medium",
        threatenedDecision: "Forcing existing customers onto the new plan.",
        postIds: [b, c],
      },
      {
        label: "Competitor undercut narrative",
        steelman: `Supporters concede the competitor comparison rather than rebutting it, which cedes the frame. Once the cheaper alternative is the reference price, every later justification reads as an excuse.`,
        blastRadius: "medium",
        threatenedDecision: "Holding the announced price against Nimbus Labs.",
        postIds: [a, c],
      },
      {
        label: "Support load spike",
        steelman: `The run shows confusion clustering in the first two rounds with no official voice present. Unanswered confusion in week one becomes tickets in week two and cancellations in week three.`,
        blastRadius: "low",
        threatenedDecision: "Staffing support at current levels through launch.",
        postIds: [a, b],
      },
    ],
    strongestCritic: { handle: "@critic", sentence: "They are charging us for the privilege of being confused." },
    counterCase: `The change funds the capacity the free tier is consuming, and the run shows a committed supporter bloc that cites reliability rather than price. Grandfathering the loudest critics while holding the line converts the most dangerous objection into a non-event.`,
    weakestClaim: {
      claim: "The opposition will dissipate once the FAQ is published.",
      breakingQuestion: "What would you need to see in the FAQ to change your mind?",
    },
    testPlan: [
      {
        question: "What would make this price acceptable to you?",
        discriminates: "Whether the objection is the number or the surprise.",
        wouldNotShipIf: "Most respondents name a lower number, not better communication.",
      },
    ],
  };
}

describe("objection dossier", () => {
  it("mints exactly one task and stores nothing else", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "dossier-task", rounds: 3, population: 10 });
    const before = run.storage.listTasks(run.worldId).length;
    const task = engine.buildDossierTask(run.storage, run.world, "pricing");
    const after = run.storage.listTasks(run.worldId).length;
    // One minted task, one saved task. An earlier shape of this code called
    // buildReportTask internally and left a stray saved report task behind.
    expect(after - before).toBe(1);
    expect(task.kind).toBe("dossier");
    expect(task.items[0]?.payload).toBeTruthy();
    run.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("rejects fabricated post ids, naming the field", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "dossier-neg-id", rounds: 3, population: 10 });
    const posts = run.storage.listPosts(run.worldId, { limit: 100000 }).filter((p) => p.kind !== "repost");
    const draft = goodDossier(posts.slice(0, 3).map((p) => p.id));
    (draft.objections[0] as { postIds: string[] }).postIds = [posts[0].id, "po_invented"];
    const { rejected } = engine.validateDossierDraft(run.storage, run.world, draft);
    const idErrs = rejected.filter((r) => /unknown post id/i.test(r.message));
    expect(idErrs.length).toBeGreaterThan(0);
    expect(idErrs[0].ref).toBe("objections[0].postIds");
    expect(idErrs[0].message).toContain("po_invented");
    run.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("rejects a fabricated number, naming the value", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "dossier-neg-num", rounds: 3, population: 10 });
    const posts = run.storage.listPosts(run.worldId, { limit: 100000 }).filter((p) => p.kind !== "repost");
    const draft = goodDossier(posts.slice(0, 3).map((p) => p.id));
    draft.counterCase += " A full 888888 users already agreed in the run.";
    const { rejected } = engine.validateDossierDraft(run.storage, run.world, draft);
    const numErrs = rejected.filter((r) => /unverified number/i.test(r.message));
    expect(numErrs.length).toBeGreaterThan(0);
    expect(numErrs[0].message).toContain("888888");
    run.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("accepts a run-grounded draft and renders it", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "dossier-pos", rounds: 3, population: 10 });
    const posts = run.storage.listPosts(run.worldId, { limit: 100000 }).filter((p) => p.kind !== "repost");
    const draft = goodDossier(posts.slice(0, 3).map((p) => p.id));
    const { draft: clean, rejected } = engine.validateDossierDraft(run.storage, run.world, draft);
    expect(rejected.map((r) => `${r.ref}: ${r.message}`)).toEqual([]);
    const md = engine.renderDossierMarkdown(run.world, clean, 1);
    expect(md).toContain("# Objection Dossier");
    expect(md).toContain("## Test plan");
    expect(md).toContain("blast radius: HIGH");
    expect(md).toContain("METHODOLOGY.md");
    run.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("rejects a missing counter-case: adversary-only dossiers talk readers out of good ideas", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, { cwd: dir, seed: "dossier-neg-cc", rounds: 3, population: 10 });
    const posts = run.storage.listPosts(run.worldId, { limit: 100000 }).filter((p) => p.kind !== "repost");
    const draft = goodDossier(posts.slice(0, 3).map((p) => p.id));
    draft.counterCase = "Seems fine.";
    const { rejected } = engine.validateDossierDraft(run.storage, run.world, draft);
    expect(rejected.some((r) => r.ref === "counterCase")).toBe(true);
    run.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);
}, 300000);
