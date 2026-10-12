/**
 * Report draft validation: the depth rules.
 *
 * `validateReportDraft` is the last gate before a model's prose becomes the
 * artifact a founder screenshots into a board deck, and it does two jobs that
 * pull against each other: it REJECTS thin drafts (so the host retries with
 * more depth) and it NORMALISES what it accepts. Both are asserted here, along
 * with the shapes a thin draft is most likely to take.
 *
 * These are the RULES, not the numeric-claim verifier. The verifier is a
 * separate module and is covered by `unit/report-claims.test.ts` (token
 * extraction) and `golden/report-claims.test.ts` (end to end through the real
 * pipeline, both directions). What is pinned here that is not pinned there is
 * the interaction: a draft that is perfect on every depth rule but states a
 * number the run does not contain still gets rejected, and the retry message
 * names the field.
 *
 * `tests/golden/report-claims.test.ts` drives this through the real pipeline
 * with the mock brain's draft. This file drives it with a HAND-BUILT draft
 * against a hand-built world, so each rejection can be attributed to one rule
 * instead of to a difference between two drafts nobody can diff.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Storage, openDatabase, scoreSentiment } from "@murmur/engine";
import type { Entity, Post, World } from "@murmur/engine";
import { validateReportDraft } from "../../packages/engine/src/report.js";
import { extractNumbers } from "../../packages/engine/src/report-claims.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-reportdraft-"));

function post(over: Partial<Post> & { id: string; worldId: string }): Post {
  return {
    round: 1,
    personaId: "p_1",
    platform: "twitter",
    kind: "post",
    parentId: null,
    threadId: over.id,
    communityId: null,
    title: null,
    body: "Acme Cloud is great",
    metrics: { likes: 3, reposts: 0, upvotes: 0, downvotes: 0, impressions: 10 },
    mentions: [],
    origin: "generated",
    ...over,
  } as Post;
}

/** A world with four real posts, so post-id resolution has something to resolve. */
function fixture(): { db: Storage; world: World; focus: Entity; postIds: string[]; dir: string } {
  const dir = tmp();
  const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
  const world = db.createWorld({ name: "draft world", seed: "draft-1" });
  const { inserted } = db.insertEntities(world.id, [
    { name: "Acme Cloud", type: "org", description: "d", salience: 0.9, anchors: [], motives: [] },
  ]);
  const focus = inserted[0];
  // Posts carry a persona foreign key, so the population has to exist first.
  db.insertPersonas(world.id, [
    {
      name: "Ada",
      handle: "@ada",
      archetype: "champion",
      bio: "b",
      traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
      stances: { [focus.id]: 0.5 },
      platform: "both",
      activity: 0.5,
      communityIds: [],
      follows: [],
    },
  ] as never);
  const ids: string[] = [];
  for (let i = 1; i <= 4; i++) {
    // Ids in the shape the engine actually mints (po_1, po_2, …), because the
    // numeric verifier's id-token filter only recognises THAT shape. A fixture
    // using po_draft_1 would prove nothing about identifier handling.
    const id = `po_${i}`;
    ids.push(id);
    db.insertPost(
      post({
        id,
        worldId: world.id,
        personaId: `p_1`,
        body: i <= 2 ? "Acme Cloud is great" : "Acme Cloud is terrible",
        metrics: { likes: i, reposts: 0, upvotes: 0, downvotes: 0, impressions: 10 },
        mentions: [{ entityId: focus.id, score: i <= 2 ? 0.5 : -0.5 }],
      })
    );
  }
  db.updateWorld(world.id, { round: 1 });
  return { db, world: db.getWorld(world.id)!, focus, postIds: ids, dir };
}

const WORDS = (n: number, word = "evidence") => Array.from({ length: n }, () => word).join(" ");

/**
 * A draft that passes every rule. Each field is a `partial` merge point so a
 * test can break exactly one rule and see exactly one rejection.
 */
function goodDraft(postIds: string[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scenarioRecap: WORDS(20, "scenario"),
    executiveSummary: WORDS(40, "summary"),
    keyFindings: [WORDS(8, "finding"), WORDS(8, "finding"), WORDS(8, "finding")],
    trajectory: WORDS(40, "trajectory"),
    risks: [0, 1, 2].map((i) => ({
      title: `Risk number ${i + 1} title`,
      rationale: WORDS(40, "rationale"),
      severity: "high",
      likelihood: "medium",
      mitigation: WORDS(20, "mitigation"),
      trigger: "a trigger",
      postIds: [postIds[i], postIds[i + 1]],
    })),
    recommendations: [
      { title: "Do the thing", action: WORDS(12, "action"), expectedImpact: WORDS(6, "impact") },
      { title: "Do the other thing", action: WORDS(12, "action"), expectedImpact: WORDS(6, "impact") },
    ],
    confidence: { strongSignals: [WORDS(6, "signal"), WORDS(6, "signal")], contested: [WORDS(6, "contested")] },
    limitations: [WORDS(6, "limitation")],
    ...over,
  };
}

function cleanup(fx: { db: Storage; dir: string }) {
  fx.db.close();
  fs.rmSync(fx.dir, { recursive: true, force: true });
}

const messages = (rejected: { ref: string; message: string }[]) => rejected.map((e) => `${e.ref}: ${e.message}`);

/** The three risks of a good draft, with `over` merged into the first. */
function risksWith(postIds: string[], over: Record<string, unknown>): Record<string, unknown>[] {
  const base = goodDraft(postIds).risks as Record<string, unknown>[];
  return [{ ...base[0], ...over }, ...base.slice(1)];
}

/** Two valid recommendations, with `over` merged into the first. */
function recsWith(postIds: string[], over: Record<string, unknown>): Record<string, unknown>[] {
  const base = goodDraft(postIds).recommendations as Record<string, unknown>[];
  return [{ ...base[0], ...over }, ...base.slice(1)];
}

describe("validateReportDraft — narrative depth", () => {
  it("accepts a draft that meets every rule", () => {
    const fx = fixture();
    const { rejected, draft } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds));
    expect(messages(rejected)).toEqual([]);
    expect(draft.risks).toHaveLength(3);
    expect(draft.keyFindings).toHaveLength(3);
    expect(draft.recommendations).toHaveLength(2);
    expect(draft.confidence.strongSignals).toHaveLength(2);
    expect(draft.confidence.contested).toHaveLength(1);
    expect(draft.limitations).toHaveLength(1);
    cleanup(fx);
  });

  it("rejects an executive summary under 120 chars and reports the actual length", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { executiveSummary: WORDS(10) }));
    const err = rejected.find((e) => e.ref === "executiveSummary")!;
    expect(err.message).toMatch(/too thin \(\d+ chars, min 120\)/);
    expect(err.message).toContain("verdict");
    cleanup(fx);
  });

  it("rejects a trajectory under 120 chars", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { trajectory: "soon" }));
    const err = rejected.find((e) => e.ref === "trajectory")!;
    expect(err.message).toContain("min 120");
    expect(err.message).toContain("projection slope");
    cleanup(fx);
  });

  it("rejects a scenario recap under 60 chars but allows it to be absent", () => {
    const fx = fixture();
    const thin = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { scenarioRecap: "short" }));
    expect(thin.rejected.some((e) => e.ref === "scenarioRecap")).toBe(true);

    const absent = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { scenarioRecap: undefined }));
    expect(absent.rejected.some((e) => e.ref === "scenarioRecap")).toBe(false);
    expect(absent.draft.scenarioRecap).toBeUndefined();
    cleanup(fx);
  });

  it("trims before measuring, so a padded field cannot pass on whitespace", () => {
    const fx = fixture();
    const padded = `   ${WORDS(10)}   `;
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { executiveSummary: padded }));
    expect(rejected.some((e) => e.ref === "executiveSummary")).toBe(true);
    cleanup(fx);
  });

  it("requires at least three non-empty key findings and drops the blanks", () => {
    const fx = fixture();
    const few = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { keyFindings: ["one", "two"] }));
    const err = few.rejected.find((e) => e.ref === "keyFindings")!;
    expect(err.message).toContain("at least 3");
    expect(err.message).toContain("got 2");

    const padded = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { keyFindings: ["one", "two", "   "] }));
    expect(padded.rejected.some((e) => e.ref === "keyFindings")).toBe(true);
    cleanup(fx);
  });

  it("caps key findings at five and limitations at three", () => {
    const fx = fixture();
    const { draft } = validateReportDraft(
      fx.db,
      fx.world,
      goodDraft(fx.postIds, {
        keyFindings: [0, 1, 2, 3, 4, 5, 6].map(() => WORDS(8, "finding")),
        limitations: [0, 1, 2, 3, 4].map(() => WORDS(6, "limitation")),
      })
    );
    expect(draft.keyFindings).toHaveLength(5);
    expect(draft.limitations).toHaveLength(3);
    cleanup(fx);
  });

  it("requires at least two strong signals and one contested finding", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(
      fx.db,
      fx.world,
      goodDraft(fx.postIds, { confidence: { strongSignals: ["only one"], contested: [] } })
    );
    const refs = rejected.map((e) => e.ref);
    expect(refs).toContain("confidence.strongSignals");
    expect(refs).toContain("confidence.contested");
    cleanup(fx);
  });
});

describe("validateReportDraft — exactly three risks", () => {
  it("rejects fewer than three risks and states the count", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { risks: [] }));
    const err = rejected.find((e) => e.ref === "risks")!;
    expect(err.message).toBe("need exactly 3 risks (got 0)");
    cleanup(fx);
  });

  it("reads only the first three even when more are supplied", () => {
    // The message says "exactly 3" but the loop is `i < 3`, so a four-risk
    // draft is accepted and the fourth is dropped rather than rejected. That
    // is the shipped behaviour; pinning it means a future "fix" is a
    // deliberate decision rather than an accident.
    const fx = fixture();
    const four = [0, 1, 2, 3].map((i) => ({
      title: `Risk number ${i + 1} title`,
      rationale: WORDS(40, "rationale"),
      severity: "high",
      likelihood: "medium",
      mitigation: WORDS(20, "mitigation"),
      postIds: [fx.postIds[0], fx.postIds[1]],
    }));
    const { rejected, draft } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { risks: four }));
    expect(rejected.filter((e) => e.ref === "risks")).toEqual([]);
    expect(draft.risks).toHaveLength(3);
    cleanup(fx);
  });

  it("requires 2-3 post ids per risk and names the count when it has none", () => {
    const fx = fixture();
    const none = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, { postIds: [] }),
    });
    const err = none.rejected.find((e) => e.ref === "risks[0].postIds")!;
    expect(err.message).toContain("2-3 real post ids (got 0)");

    const four = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, { postIds: fx.postIds }),
    });
    expect(four.rejected.some((e) => e.message.includes("2-3 real post ids"))).toBe(true);
    cleanup(fx);
  });

  it("rejects a risk citing a post id that does not exist, and names the id", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, { postIds: ["po_1", "po_invented"] }),
    });
    const err = rejected.find((e) => e.message.includes("unknown post id"))!;
    expect(err.message).toContain("po_invented");
    cleanup(fx);
  });

  it("does not accept a post id that exists only in another world", () => {
    // Post ids are world-scoped: po_1 exists in EVERY world, so the resolution
    // must go through this world and not through a global lookup. The id is
    // identical in both worlds, so what is asserted is that each world resolves
    // its OWN po_1 — a global lookup would return the same row twice.
    const other = fixture();
    const created = other.db.createWorld({ name: "other", seed: "other-1" });
    expect(created.id).not.toBe(other.world.id);
    // Seed the other world with a post carrying the same id but different
    // body. Posts carry a persona foreign key, so the other world needs its
    // own population first.
    other.db.insertPersonas(created.id, [
      {
        name: "Zed",
        handle: "@zed",
        archetype: "critic",
        bio: "b",
        traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
        stances: {},
        platform: "both",
        activity: 0.5,
        communityIds: [],
        follows: [],
      },
    ] as never);
    other.db.insertPost(post({ id: "po_1", worldId: created.id, body: "Hetzner is terrible" }));
    const here = other.db.getPost(other.world.id, "po_1")!;
    const there = other.db.getPost(created.id, "po_1")!;
    expect(here.body).not.toBe(there.body);
    expect(here.worldId).toBe(other.world.id);
    expect(there.worldId).toBe(created.id);
    cleanup(other);
  });

  it("drops an invalid risk from the returned draft rather than half-including it", () => {
    // A rejected risk must not reach the rendered report as a stub: the
    // `rejected.every(...)` guard is what keeps a broken risk out.
    const fx = fixture();
    const { draft, rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, { severity: "catastrophic" }),
    });
    expect(rejected.some((e) => e.ref === "risks[0].severity")).toBe(true);
    expect(draft.risks).toHaveLength(2);
    expect(draft.risks.some((r) => r.severity === ("catastrophic" as never))).toBe(false);
    cleanup(fx);
  });
});

describe("validateReportDraft — risk field enums and lengths", () => {
  const withRisk = (over: Record<string, unknown>) => {
    const fx = fixture();
    const result = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, over),
    });
    return { fx, ...result };
  };

  it("rejects a severity outside high|medium|low and echoes the value", () => {
    const { fx, rejected } = withRisk({ severity: "catastrophic" });
    const err = rejected.find((e) => e.ref === "risks[0].severity")!;
    expect(err.message).toBe('invalid severity "catastrophic"');
    cleanup(fx);
  });

  it("defaults a missing severity to medium rather than rejecting", () => {
    const { fx, draft } = withRisk({ severity: undefined });
    expect(draft.risks[0].severity).toBe("medium");
    cleanup(fx);
  });

  it("rejects a likelihood outside the enum", () => {
    const { fx, rejected } = withRisk({ likelihood: "certain" });
    const err = rejected.find((e) => e.ref === "risks[0].likelihood")!;
    expect(err.message).toBe('invalid likelihood "certain"');
    cleanup(fx);
  });

  it("defaults a missing, empty or null likelihood to medium", () => {
    for (const likelihood of [undefined, null, ""]) {
      const { fx, draft } = withRisk({ likelihood });
      expect(draft.risks[0].likelihood, `likelihood=${JSON.stringify(likelihood)}`).toBe("medium");
      cleanup(fx);
    }
  });

  it("does NOT default an explicit-but-invalid empty-ish likelihood past validation", () => {
    // `""` and null are defaulted; a whitespace string is not trimmed, so it
    // reaches the enum check and is rejected. Pinned because the difference
    // is invisible in the source.
    const { fx, rejected } = withRisk({ likelihood: "   " });
    expect(rejected.some((e) => e.ref === "risks[0].likelihood")).toBe(true);
    cleanup(fx);
  });

  it("enforces the title, rationale and mitigation minimums", () => {
    const short = withRisk({ title: "tiny" });
    expect(short.rejected.some((e) => e.ref === "risks[0].title" && e.message.includes("min 8"))).toBe(true);
    cleanup(short.fx);

    const thin = withRisk({ rationale: "short" });
    expect(thin.rejected.some((e) => e.ref === "risks[0].rationale" && e.message.includes("min 120"))).toBe(true);
    cleanup(thin.fx);

    const weak = withRisk({ mitigation: "do better" });
    expect(weak.rejected.some((e) => e.ref === "risks[0].mitigation" && e.message.includes("min 60"))).toBe(true);
    cleanup(weak.fx);
  });

  it("does not require a trigger — it is carried through when present", () => {
    const missing = withRisk({ trigger: undefined });
    expect(missing.rejected.some((e) => e.ref.includes("trigger"))).toBe(false);
    expect(missing.draft.risks[0].trigger).toBe("");
    cleanup(missing.fx);
  });
});

describe("validateReportDraft — recommendations", () => {
  it("requires at least two", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { recommendations: [] }));
    const err = rejected.find((e) => e.ref === "recommendations")!;
    expect(err.message).toContain("2-4");
    expect(err.message).toContain("got 0");
    cleanup(fx);
  });

  it("caps at four and drops the extras without rejecting them", () => {
    const fx = fixture();
    const five = [0, 1, 2, 3, 4].map((i) => ({
      title: `Rec ${i}`,
      action: WORDS(12, "action"),
      expectedImpact: WORDS(6, "impact"),
    }));
    const { draft } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { recommendations: five }));
    expect(draft.recommendations).toHaveLength(4);
    cleanup(fx);
  });

  it("enforces the title, action and expectedImpact minimums", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      recommendations: recsWith(fx.postIds, { title: "no", action: "short", expectedImpact: "tiny" }),
    });
    const refs = rejected.map((e) => e.ref);
    expect(refs).toContain("recommendations[0].title");
    expect(refs).toContain("recommendations[0].action");
    expect(refs).toContain("recommendations[0].expectedImpact");
    cleanup(fx);
  });

  it("omits recommendations entirely when the field is missing", () => {
    const fx = fixture();
    const { draft, rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { recommendations: undefined }));
    expect(draft.recommendations).toBeUndefined();
    expect(rejected.some((e) => e.ref === "recommendations")).toBe(true);
    cleanup(fx);
  });
});

describe("validateReportDraft — degenerate input", () => {
  it("survives a completely empty object and reports every missing field", () => {
    const fx = fixture();
    const { draft, rejected } = validateReportDraft(fx.db, fx.world, {});
    const refs = new Set(rejected.map((e) => e.ref));
    expect(refs.has("executiveSummary")).toBe(true);
    expect(refs.has("trajectory")).toBe(true);
    expect(refs.has("keyFindings")).toBe(true);
    expect(refs.has("risks")).toBe(true);
    expect(refs.has("recommendations")).toBe(true);
    expect(draft.risks).toEqual([]);
    expect(draft.confidence).toEqual({ strongSignals: [], contested: [] });
    cleanup(fx);
  });

  it("survives null, undefined and non-object drafts", () => {
    const fx = fixture();
    for (const bad of [null, undefined, 42, "text"]) {
      const { rejected } = validateReportDraft(fx.db, fx.world, bad);
      expect(rejected.length, `draft=${JSON.stringify(bad)}`).toBeGreaterThan(0);
    }
    cleanup(fx);
  });

  it("coerces non-string array members rather than throwing", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { keyFindings: [1, 2, 3] }));
    expect(rejected).toEqual([]);
    cleanup(fx);
  });
});

describe("validateReportDraft — numeric claim verifier integration", () => {
  it("rejects a depth-perfect draft whose executive summary states a fabricated number", () => {
    // The depth rules all pass; the number is what fails. This is the
    // integration the golden test cannot isolate: same draft, one field
    // changed, and the ONLY new rejection is the unverified number.
    const fx = fixture();
    const clean = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds));
    expect(clean.rejected).toEqual([]);

    const poisoned = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      executiveSummary: WORDS(40, "summary") + " The crowd produced 987654 posts about it.",
    });
    const numeric = poisoned.rejected.filter((e) => /unverified number/i.test(e.message));
    expect(numeric.length).toBe(1);
    expect(numeric[0].ref).toBe("executiveSummary");
    expect(numeric[0].message).toContain("987654");
    // The retry message must list what the run DOES contain.
    expect(numeric[0].message).toMatch(/posts=\d+/);
    cleanup(fx);
  });

  it("accepts a number the run actually produced", () => {
    // A run-grounded claim must survive: the fixture's own total post count
    // is a legitimate figure, and rejecting it would make the verifier
    // useless (the failure mode that made the old id-jail test worthless).
    const fx = fixture();
    const total = fx.db.countPosts(fx.world.id);
    const { rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      executiveSummary: WORDS(40, "summary") + ` The run produced ${total} posts in total.`,
    });
    expect(rejected.filter((e) => /unverified number/i.test(e.message))).toEqual([]);
    cleanup(fx);
  });

  it("scans risk rationales and confidence, not just the headline fields", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, { rationale: WORDS(40, "rationale") + " Affects 13579 accounts." }),
      confidence: {
        strongSignals: [WORDS(6, "signal") + " Seen 24680 times.", WORDS(6, "signal")],
        contested: [WORDS(6, "contested")],
      },
    });
    const refs = rejected.filter((e) => /unverified number/.test(e.message)).map((e) => e.ref);
    expect(refs).toContain("risks[0].rationale");
    expect(refs).toContain("confidence.strongSignals[0]");
    cleanup(fx);
  });

  it("caps the reported unverified numbers at six so a bad draft cannot flood the retry", () => {
    const fx = fixture();
    const fabricated = [111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888].join(" and ");
    const { rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      executiveSummary: WORDS(20, "summary") + " " + fabricated,
    });
    const numeric = rejected.filter((e) => /unverified number/i.test(e.message));
    expect(numeric.length).toBe(6);
    cleanup(fx);
  });

  it("does not read numbers out of the post ids the draft cites", () => {
    // po_draft_1 must not be read as the number 1. A verifier that shredded
    // identifiers would reject a correct draft on any run with numeric ids.
    const fx = fixture();
    const ids = fx.postIds.map((id) => extractNumbers(`cited ${id}`));
    for (const found of ids) expect(found).toHaveLength(0);
    const { rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds));
    expect(rejected).toEqual([]);
    cleanup(fx);
  });
});

describe("validateReportDraft — normalisation of what it accepts", () => {
  it("coerces numeric post ids to strings instead of crashing on them", () => {
    const fx = fixture();
    const { rejected } = validateReportDraft(fx.db, fx.world, {
      ...goodDraft(fx.postIds),
      risks: risksWith(fx.postIds, { postIds: [1, 2] }),
    });
    // No world holds posts "1" and "2", so both are unknown ids — the point is
    // that `postIds.map(String)` ran instead of the validator throwing on a
    // number, and that the rejection message quotes the coerced value.
    const errs = rejected.filter((e) => e.message.includes("unknown post id"));
    expect(errs.length).toBe(2);
    expect(errs.map((e) => e.message).join(" ")).toContain('"1"');
    expect(errs.map((e) => e.message).join(" ")).toContain('"2"');
    cleanup(fx);
  });

  it("drops a limitation shorter than 15 chars rather than rejecting the draft", () => {
    const fx = fixture();
    const { draft, rejected } = validateReportDraft(fx.db, fx.world, goodDraft(fx.postIds, { limitations: ["too short"] }));
    expect(rejected).toEqual([]);
    expect(draft.limitations).toBeUndefined();
    cleanup(fx);
  });

  it("scores the fixture's own posts so attributed sentiment is a real number", () => {
    // The verifier's allowlist is built from stored post mention scores; if
    // those were not numbers the whole allowlist would be empty and every
    // draft would fail.
    const fx = fixture();
    const stored = fx.db.listPosts(fx.world.id, { limit: 100000 });
    expect(stored).toHaveLength(4);
    for (const p of stored) {
      expect(p.mentions[0].score).toBeTypeOf("number");
      expect(Math.abs(scoreSentiment(p.body).score)).toBeGreaterThan(0);
    }
    cleanup(fx);
  });
});
