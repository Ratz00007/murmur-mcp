/**
 * Report draft numeric integrity, end to end through the real pipeline.
 *
 * The negative control is the point: a draft that invents a figure in its
 * executive summary must be REJECTED with a message naming the field and the
 * number, and a draft whose numbers all come from the run must be ACCEPTED.
 *
 * This extends citation integrity from post ids to numbers. Before it,
 * `report.ts` instructed the model "never invent numbers" and no code enforced
 * it, so any figure the model liked would be rendered verbatim into the
 * dashboard a founder might screenshot into a board deck.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runPipeline } from "../helpers/pipeline.mjs";
import { completeReportTask } from "../helpers/mock-brain.mjs";
import {
  validateReportDraft,
  buildReportTask,
} from "../../packages/engine/src/report.js";
import type { Storage } from "../../packages/engine/src/store/storage.js";
import type { World } from "../../packages/engine/src/types.js";
import * as engine from "@murmur/engine";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-claims-"));

describe("report numeric claim integrity", () => {
  it("rejects a draft that states a number the run does not contain", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, {
      cwd: dir,
      seed: "claims-negative",
      rounds: 3,
      population: 12,
    });
    const storage = run.storage as unknown as Storage;
    const world = run.world as unknown as World;

    // Rebuild the task so the mock brain drafts against this exact run, then
    // corrupt one figure in a field the verifier watches. 999999 is not a
    // value any 12-person, 3-round run holds.
    const task = buildReportTask(
      storage,
      world,
      "community reaction to the pricing change",
    );
    const good = completeReportTask(task as never) as Record<string, unknown>;
    const poisoned = {
      ...good,
      executiveSummary:
        "Across this run 999999 simulated posts moved sentiment hard against the change, " +
        "and the opposition bloc grew faster than the field expected in the first three rounds.",
    };

    const { rejected } = validateReportDraft(storage, world, poisoned);
    const numeric = rejected.filter((r) =>
      /unverified number/i.test(r.message),
    );

    expect(numeric.length).toBeGreaterThan(0);
    expect(numeric[0].ref).toBe("executiveSummary");
    expect(numeric[0].message).toContain("999999");
    // The retry message must tell the author what IS available, not just that
    // something is wrong.
    expect(numeric[0].message).toMatch(/posts=/);

    (run as { close?: () => void }).close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("accepts the mock brain's own draft, which is generated from the same run", async () => {
    const dir = tmp();
    const run = await runPipeline(engine, {
      cwd: dir,
      seed: "claims-positive",
      rounds: 3,
      population: 12,
    });
    const storage = run.storage as unknown as Storage;
    const world = run.world as unknown as World;

    const task = buildReportTask(
      storage,
      world,
      "community reaction to the pricing change",
    );
    const draft = completeReportTask(task as never);
    const { rejected } = validateReportDraft(storage, world, draft);

    const numeric = rejected.filter((r) =>
      /unverified number/i.test(r.message),
    );
    // The mock brain writes from the stats pack, so nothing should be flagged.
    // A failure here means the verifier is too strict and would reject correct
    // drafts in production — the same false-positive risk that made the old
    // jail test worthless.
    expect(numeric.map((r) => `${r.ref}: ${r.message}`)).toEqual([]);

    (run as { close?: () => void }).close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);
}, 150000);
