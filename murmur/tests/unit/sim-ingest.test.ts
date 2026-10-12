/**
 * Sim ingest validation: the rules that decide whether a host LLM's generation
 * is accepted, held for surgical retry, or dropped.
 *
 * The plan/submit protocol only works if a rejection names the exact field at
 * fault. When it does not, the host model resubmits the same broken generation
 * forever and the round never advances — which looks like a hang, not an error.
 * So these tests are as much about the MESSAGES as the accept/reject decision:
 * every rule asserts the field and the wording, because that text is the only
 * thing steering the retry.
 *
 * Two behaviours are pinned that a reader might otherwise assume are bugs:
 *
 *   - The sticky hold. A rejection is remembered on the task, so a later
 *     submission that fixes only some personas still holds the round while an
 *     unfixed rejection stands. That is the mechanism which stops a host from
 *     "fixing" one persona and silently advancing the round over the rest.
 *   - `finalize: true` advances the round and records the still-missing personas
 *     as LURKERS rather than failing, because a persona that never acted is a
 *     legitimate population observation, not an error.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Storage, nowIso, openDatabase } from "@murmur/engine";
import type { GenerationTask, Persona, SimAction, SimGeneration, World } from "@murmur/engine";
import { submitGenerations } from "../../packages/engine/src/sim/ingest.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-ingest-"));

interface Fx {
  db: Storage;
  world: World;
  taskId: string;
  /** The persona ids activated in this batch, in task order. */
  activated: string[];
  personas: Map<string, Persona>;
  dir: string;
}

/**
 * A world with a fixed population: p_1..p_3 are twitter-only, p_4..p_6
 * reddit-only.
 *
 * The batch task is composed BY HAND rather than through `buildSimBatch`,
 * because activation is a weighted sample that only ever draws ~40% of the
 * population: the test could not otherwise know which personas were in the
 * batch, and a rejection could not be attributed to the persona that caused
 * it. Composing the task directly makes the activated set exactly the
 * population, which is what these tests are about. The real composer is
 * covered by the pipeline and batch tests.
 */
function fixture(over: { rounds?: number; threadDepth?: number } = {}): Fx {
  const dir = tmp();
  const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
  const world = db.createWorld({ name: "ingest world", seed: "ingest-1" });
  db.insertEntities(world.id, [
    { name: "Acme Cloud", type: "org", description: "d", salience: 0.9, anchors: [], motives: [] },
  ]);
  const entities = db.listEntities(world.id);
  const acme = entities[0].id;
  const mk = (i: number, platform: Persona["platform"]): Omit<Persona, "id" | "worldId" | "createdAt"> => ({
    name: `P${i}`,
    handle: `@p${i}`,
    archetype: "casual",
    bio: "bio",
    traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
    stances: { [acme]: 0.4 },
    platform,
    activity: 0.5,
    communityIds: platform === "reddit" ? ["c_dev"] : [],
    follows: [],
  });
  const inserted = db.insertPersonas(world.id, [
    mk(1, "twitter"),
    mk(2, "twitter"),
    mk(3, "twitter"),
    mk(4, "reddit"),
    mk(5, "reddit"),
    mk(6, "reddit"),
  ]);
  const current = db.getWorld(world.id)!;
  db.updateWorld(world.id, {
    config: {
      ...current.config,
      rounds: over.rounds ?? 1,
      platforms: {
        ...current.config.platforms,
        reddit: {
          ...current.config.platforms.reddit,
          threadDepth: over.threadDepth ?? current.config.platforms.reddit.threadDepth,
        },
      },
    },
  });
  db.setStage(world.id, "configured");
  const w = db.getWorld(world.id)!;

  // Every persona is activated for round 1.
  const task: GenerationTask = {
    id: db.nextTaskId(w.id),
    worldId: w.id,
    kind: "sim",
    round: 1,
    instructions: "test task",
    outputSchema: { type: "array" },
    items: inserted.map((p) => ({
      id: `persona-${p.id}`,
      label: p.name,
      tokens: 10,
      payload: { persona: { id: p.id } },
    })),
    createdAt: nowIso(),
  };
  db.saveTask(task);
  return {
    db,
    world: w,
    taskId: task.id,
    activated: inserted.map((p) => p.id),
    personas: new Map(inserted.map((p) => [p.id, p])),
    dir,
  };
}

function submit(fx: Fx, subs: SimGeneration[], opts: { finalize?: boolean } = {}) {
  return submitGenerations(fx.db, fx.db.getWorld(fx.world.id)!, fx.taskId, subs, opts);
}

/** Mint a fresh round-1 task — the retry after a hold re-plans the batch. */
function newTask(fx: Fx, round: number): string {
  const task: GenerationTask = {
    id: fx.db.nextTaskId(fx.world.id),
    worldId: fx.world.id,
    kind: "sim",
    round,
    instructions: "test task",
    outputSchema: { type: "array" },
    items: fx.activated.map((id) => ({ id: `persona-${id}`, label: id, tokens: 10, payload: { persona: { id } } })),
    createdAt: nowIso(),
  };
  fx.db.saveTask(task);
  return task.id;
}

/** Pick the first activated persona on the given platform. */
function onPlatform(fx: Fx, platform: Persona["platform"], skip?: string): string {
  const id = fx.activated.find((p) => fx.personas.get(p)!.platform === platform && p !== skip);
  if (!id) throw new Error(`no activated persona on ${platform}`);
  return id;
}

function cleanup(fx: Fx) {
  fx.db.close();
  fs.rmSync(fx.dir, { recursive: true, force: true });
}

/** All personas present but silent, except the ones named. */
function onlyAct(fx: Fx, actives: Record<string, SimAction[]>, extra: SimGeneration[] = []): SimGeneration[] {
  return [
    ...fx.activated.map((id) => ({ persona: id, actions: actives[id] ?? [] })),
    ...extra,
  ];
}

describe("sim ingest — persona resolution", () => {
  it("accepts a generation addressed by persona id or by handle", () => {
    const fx = fixture();
    const [id] = fx.activated;
    const handle = fx.personas.get(id)!.handle;
    const r = submit(fx, [{ persona: handle, actions: [{ type: "post", body: "Acme Cloud is great" }] }]);
    expect(r.rejected.filter((e) => e.field === "persona")).toEqual([]);
    expect(r.appliedPersonas).toContain(id);
    cleanup(fx);
  });

  it("rejects an unknown persona and names the field, the value and the remedy", () => {
    const fx = fixture();
    const r = submit(fx, onlyAct(fx, {}).concat([{ persona: "p_999", actions: [] }]));
    const err = r.rejected.find((e) => e.field === "persona")!;
    expect(err.ref).toContain("generations[6]");
    expect(err.message).toContain("unknown persona");
    expect(err.message).toContain("p_999");
    expect(err.hint).toContain("task items");
    cleanup(fx);
  });

  it("rejects a persona who exists but was not activated this round", () => {
    const fx = fixture();
    // A seventh persona outside the batch must not be able to act.
    fx.db.insertPersonas(fx.world.id, [
      {
        name: "Outsider",
        handle: "@outsider",
        archetype: "casual",
        bio: "b",
        traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
        stances: {},
        platform: "twitter",
        activity: 0.5,
        communityIds: [],
        follows: [],
      },
    ] as never);
    const outsider = fx.db.listPersonas(fx.world.id).find((p) => p.handle === "@outsider")!.id;
    const r = submit(fx, [{ persona: outsider, actions: [] }]);
    const err = r.rejected.find((e) => e.field === "persona")!;
    expect(err.message).toContain("not activated in this batch");
    expect(err.hint).toContain("only personas listed in the task");
    cleanup(fx);
  });

  it("rejects a duplicate submission for the same persona", () => {
    const fx = fixture();
    const [id] = fx.activated;
    const r = submit(fx, [
      { persona: id, actions: [] },
      { persona: id, actions: [] },
    ]);
    const err = r.rejected.find((e) => e.message.includes("already applied"))!;
    expect(err.message).toContain(id);
    cleanup(fx);
  });

  it("throws on a task that does not exist or does not belong to this world", () => {
    const fx = fixture();
    expect(() => submitGenerations(fx.db, fx.world, "t_nope", [], {})).toThrow(/unknown sim task/);
    cleanup(fx);
  });
});

describe("sim ingest — action count and shape", () => {
  it("rejects more than three actions in one generation", () => {
    const fx = fixture();
    const [id] = fx.activated;
    const r = submit(fx, [
      {
        persona: id,
        actions: [
          { type: "post", body: "one" },
          { type: "post", body: "two" },
          { type: "post", body: "three" },
          { type: "post", body: "four" },
        ],
      },
    ]);
    const err = r.rejected.find((e) => e.field === "actions")!;
    expect(err.message).toContain("4 actions (max 3)");
    cleanup(fx);
  });

  it("rejects a missing or non-string action type", () => {
    const fx = fixture();
    const [id] = fx.activated;
    const r = submit(fx, [{ persona: id, actions: [{ body: "no type" } as unknown as SimAction] }]);
    const err = r.rejected.find((e) => e.field === "type")!;
    expect(err.message).toBe("missing action type");
    cleanup(fx);
  });

  it("rejects an unknown action type and echoes it back", () => {
    const fx = fixture();
    const [id] = fx.activated;
    const r = submit(fx, [{ persona: id, actions: [{ type: "boost" } as unknown as SimAction] }]);
    const err = r.rejected.find((e) => e.message.includes("unknown action type"))!;
    expect(err.message).toContain('"boost"');
    cleanup(fx);
  });

  it("treats a non-array actions field as an empty (lurk) generation rather than an error", () => {
    // Forgiving on shape, strict on content: a host that returns a bare persona
    // is treated as having chosen not to act, not as having failed.
    const fx = fixture();
    const [id] = fx.activated;
    const r = submit(fx, [{ persona: id, actions: "nope" as unknown as SimAction[] }]);
    expect(r.rejected).toEqual([]);
    expect(r.lurkers).toContain(id);
    cleanup(fx);
  });
});

describe("sim ingest — platform conformance", () => {
  it("rejects a twitter-only persona posting to reddit", () => {
    const fx = fixture();
    const tw = onPlatform(fx, "twitter");
    const r = submit(fx, [
      { persona: tw, actions: [{ type: "post", platform: "reddit", title: "t", body: "b" }] },
    ]);
    const err = r.rejected.find((e) => e.field === "platform")!;
    expect(err.message).toBe("persona is twitter-only");
    cleanup(fx);
  });

  it("rejects a reddit-only persona posting to twitter", () => {
    const fx = fixture();
    const rd = onPlatform(fx, "reddit");
    const r = submit(fx, [
      { persona: rd, actions: [{ type: "post", platform: "twitter", body: "b" }] },
    ]);
    const err = r.rejected.find((e) => e.field === "platform")!;
    expect(err.message).toBe("persona is reddit-only");
    cleanup(fx);
  });

  it("rejects a reddit-only persona using a twitter-only action", () => {
    const fx = fixture();
    const rd = onPlatform(fx, "reddit");
    for (const type of ["reply", "quote", "like", "repost"] as const) {
      const r = submit(fx, [{ persona: rd, actions: [{ type, parent: "po_x", body: "b" } as SimAction] }]);
      const err = r.rejected.find((e) => e.field === "type")!;
      expect(err.message, `action ${type}`).toContain("is a twitter action");
    }
    cleanup(fx);
  });

  it("rejects a twitter-only persona using a reddit-only action", () => {
    const fx = fixture();
    const tw = onPlatform(fx, "twitter");
    for (const type of ["comment", "upvote", "downvote"] as const) {
      const r = submit(fx, [{ persona: tw, actions: [{ type, parent: "po_x", body: "b" } as SimAction] }]);
      const err = r.rejected.find((e) => e.field === "type")!;
      expect(err.message, `action ${type}`).toContain("is a reddit action");
    }
    cleanup(fx);
  });
});

describe("sim ingest — character limits", () => {
  it("enforces the twitter post limit and reports the actual length", () => {
    const fx = fixture();
    const tw = onPlatform(fx, "twitter");
    const limit = fx.world.config.platforms.twitter.postCharLimit;
    const r = submit(fx, [
      { persona: tw, actions: [{ type: "post", body: "x".repeat(limit + 1) }] },
    ]);
    const err = r.rejected.find((e) => e.field === "body")!;
    expect(err.message).toBe(`${limit + 1} chars (max ${limit})`);
    cleanup(fx);
  });

  it("requires a non-empty twitter post body", () => {
    // A whitespace-only body is not content: `str()` trims before testing, so
    // a model that pads to hit a length floor is rejected.
    const fx = fixture();
    const tw = onPlatform(fx, "twitter");
    for (const body of ["", "   "]) {
      const r = submit(fx, [{ persona: tw, actions: [{ type: "post", body }] }]);
      expect(r.rejected.some((e) => e.message === "post body required"), `body=${JSON.stringify(body)}`).toBe(true);
    }
    cleanup(fx);
  });

  it("enforces the twitter reply limit", () => {
    const fx = fixture({ rounds: 2 });
    const tw = onPlatform(fx, "twitter");
    const other = onPlatform(fx, "twitter", tw);
    const limit = fx.world.config.platforms.twitter.replyCharLimit;
    const seeded = submit(fx, [{ persona: tw, actions: [{ type: "post", body: "seed" }] }]);
    expect(seeded.postsCreated).toBe(1);
    const root = fx.db.listPosts(fx.world.id, { personaId: tw })[0];

    // Round 1 advanced, so the reply has to go through a round-2 task.
    const taskId = newTask(fx, 2);
    const r = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      taskId,
      [{ persona: other, actions: [{ type: "reply", parent: root.id, body: "y".repeat(limit + 5) }] }],
      { finalize: true }
    );
    const err = r.rejected.find((e) => e.field === "body")!;
    expect(err.message).toContain(`max ${limit} chars`);
    cleanup(fx);
  });

  it("requires a reddit title and body, and enforces both limits", () => {
    const fx = fixture();
    const rd = onPlatform(fx, "reddit");
    const cfg = fx.world.config.platforms.reddit;

    const noTitle = submit(fx, [{ persona: rd, actions: [{ type: "post", platform: "reddit", body: "b" }] }]);
    expect(noTitle.rejected.some((e) => e.message === "reddit post requires a title")).toBe(true);

    // Deliberately invalid: the missing body is what is under test, so the
    // literal is cast at exactly this spot rather than loosening SimAction.
    const noBody = submit(fx, [{ persona: rd, actions: [{ type: "post", platform: "reddit", title: "t" } as SimAction] }]);
    expect(noBody.rejected.some((e) => e.message === "reddit post requires a body")).toBe(true);

    const longTitle = submit(fx, [
      { persona: rd, actions: [{ type: "post", platform: "reddit", title: "t".repeat(cfg.titleCharLimit + 1), body: "b" }] },
    ]);
    expect(longTitle.rejected.some((e) => e.message.includes(`max ${cfg.titleCharLimit}`))).toBe(true);

    const longBody = submit(fx, [
      { persona: rd, actions: [{ type: "post", platform: "reddit", title: "t", body: "b".repeat(cfg.bodyCharLimit + 1) }] },
    ]);
    expect(longBody.rejected.some((e) => e.message.includes(`max ${cfg.bodyCharLimit}`))).toBe(true);
    cleanup(fx);
  });

  it("enforces the reddit comment limit", () => {
    const fx = fixture({ rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    const other = onPlatform(fx, "reddit", rd);
    const limit = fx.world.config.platforms.reddit.commentCharLimit;
    submit(fx, [{ persona: rd, actions: [{ type: "post", platform: "reddit", title: "t", body: "b" }] }]);
    const root = fx.db.listPosts(fx.world.id, { personaId: rd })[0];
    const taskId = newTask(fx, 2);
    const r = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      taskId,
      [{ persona: other, actions: [{ type: "comment", parent: root.id, body: "z".repeat(limit + 1) }] }],
      { finalize: true }
    );
    expect(r.rejected.some((e) => e.field === "body" && e.message.includes(`max ${limit} chars`))).toBe(true);
    cleanup(fx);
  });
});

describe("sim ingest — parent resolution", () => {
  it("rejects a missing, empty or unknown parent id with a distinguishable message", () => {
    const fx = fixture();
    const tw = onPlatform(fx, "twitter");
    const missing = submit(fx, [{ persona: tw, actions: [{ type: "like", parent: "" }] }]);
    expect(missing.rejected.some((e) => e.message === "parent post id required")).toBe(true);

    const unknown = submit(fx, [{ persona: tw, actions: [{ type: "like", parent: "po_nope" }] }]);
    const err = unknown.rejected.find((e) => e.message.includes("parent post not found"))!;
    expect(err.message).toContain("po_nope");
    cleanup(fx);
  });

  it("rejects a reply whose parent lives on the other platform", () => {
    const fx = fixture({ rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    const other = onPlatform(fx, "twitter");
    submit(fx, [{ persona: rd, actions: [{ type: "post", platform: "reddit", title: "t", body: "b" }] }]);
    const redditPost = fx.db.listPosts(fx.world.id, { personaId: rd })[0];
    const r = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 2),
      [{ persona: other, actions: [{ type: "reply", parent: redditPost.id, body: "b" }] }],
      { finalize: true }
    );
    expect(r.rejected.some((e) => e.message.includes("is not a twitter post"))).toBe(true);
    cleanup(fx);
  });

  it("rejects a comment whose parent lives on the other platform", () => {
    const fx = fixture({ rounds: 2 });
    const tw = onPlatform(fx, "twitter");
    const other = onPlatform(fx, "reddit");
    submit(fx, [{ persona: tw, actions: [{ type: "post", body: "seed" }] }]);
    const twitterPost = fx.db.listPosts(fx.world.id, { personaId: tw })[0];
    const r = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 2),
      [{ persona: other, actions: [{ type: "comment", parent: twitterPost.id, body: "b" }] }],
      { finalize: true }
    );
    expect(r.rejected.some((e) => e.message.includes("is not a reddit post/comment"))).toBe(true);
    cleanup(fx);
  });
});

describe("sim ingest — reddit thread depth cap", () => {
  /**
   * Grow a comment chain `depth` levels below a root post, three actions per
   * round (the engine's own per-persona cap), advancing the world between
   * rounds. Returns the id of the deepest comment.
   */
  function chain(fx: Fx, author: string, depth: number): { root: string; leaf: string } {
    const rootId = fx.db.insertPost({
      id: "po_chain_root",
      worldId: fx.world.id,
      round: 0,
      personaId: author,
      platform: "reddit",
      kind: "post",
      parentId: null,
      threadId: "po_chain_root",
      communityId: "c_dev",
      title: "root",
      body: "root body",
      metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
      mentions: [],
      origin: "generated",
    }).id;
    // The chain is written straight into storage rather than driven through
    // submitGenerations: the depth cap is what is under test, and posting the
    // chain through the API would mean fighting the 3-action-per-round limit
    // and advancing the world between steps.
    let parent = rootId;
    for (let i = 0; i < depth; i++) {
      const next = `po_chain_${i}`;
      fx.db.insertPost({
        id: next,
        worldId: fx.world.id,
        round: 1,
        personaId: author,
        platform: "reddit",
        kind: "comment",
        parentId: parent,
        threadId: rootId,
        communityId: "c_dev",
        title: null,
        body: `depth ${i}`,
        metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
        mentions: [],
        origin: "generated",
      });
      parent = next;
    }
    return { root: rootId, leaf: parent };
  }

  it("rejects a comment on a parent already at the cap", () => {
    const cap = 3;
    const fx = fixture({ threadDepth: cap, rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    // root + cap comments: the leaf sits `cap` levels down, so a reply to it
    // would be level cap+1.
    const { leaf } = chain(fx, rd, cap);
    const r = submit(fx, [{ persona: rd, actions: [{ type: "comment", parent: leaf, body: "too deep" }] }]);
    const err = r.rejected.find((e) => e.field === "parent")!;
    expect(err.message).toBe(`thread depth cap ${cap} reached — reply shallower`);
    cleanup(fx);
  });

  it("accepts a comment on a parent exactly one level inside the cap", () => {
    const cap = 3;
    const fx = fixture({ threadDepth: cap, rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    const { leaf } = chain(fx, rd, cap);
    const parentOfLeaf = fx.db.getPost(fx.world.id, leaf)!.parentId!;
    const r = submit(fx, [{ persona: rd, actions: [{ type: "comment", parent: parentOfLeaf, body: "deep but legal" }] }]);
    expect(r.rejected, "the boundary is inclusive-below, not off by one").toEqual([]);
    expect(fx.db.listPosts(fx.world.id, { kinds: ["comment"] }).length).toBe(cap + 1);
    cleanup(fx);
  });

  it("counts depth through the whole chain, not just the immediate parent's own field", () => {
    // A post carries no cached depth, so the validator walks parentId. If it
    // only looked one level up, an arbitrarily deep chain would never be
    // caught and the cap would be decorative.
    const cap = 2;
    const fx = fixture({ threadDepth: cap, rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    const { leaf } = chain(fx, rd, 5);
    const r = submit(fx, [{ persona: rd, actions: [{ type: "comment", parent: leaf, body: "deep" }] }]);
    expect(r.rejected.some((e) => e.message.includes(`thread depth cap ${cap}`))).toBe(true);
    cleanup(fx);
  });

  it("does not apply the depth cap to a top-level comment", () => {
    const fx = fixture({ threadDepth: 1, rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    const { root } = chain(fx, rd, 0);
    const r = submit(fx, [{ persona: rd, actions: [{ type: "comment", parent: root, body: "first reply" }] }]);
    expect(r.rejected).toEqual([]);
    cleanup(fx);
  });
});

describe("sim ingest — sticky hold", () => {
  it("holds the round when any item is rejected and does not advance", () => {
    const fx = fixture();
    const bad = fx.activated[0];
    const r = submit(fx, onlyAct(fx, { [bad]: [{ type: "post", body: "x".repeat(400) }] }));
    expect(r.advanced).toBe(false);
    expect(r.round).toBeNull();
    expect(r.stats).toBeNull();
    expect(r.next).toContain("round held");
    expect(fx.db.getWorld(fx.world.id)!.round).toBe(0);
    cleanup(fx);
  });

  it("keeps holding while an earlier, already-rejected persona is still unfixed", () => {
    const fx = fixture();
    const [a, b] = fx.activated;
    // Round 1 attempt: a is invalid, b is valid.
    const first = submit(fx, onlyAct(fx, { [b]: [{ type: "post", body: "Acme Cloud is fine" }] }, [
      { persona: a, actions: [{ type: "post", body: "x".repeat(400) }] },
    ]));
    expect(first.advanced).toBe(false);
    const priorRejects = first.rejected.length;
    expect(priorRejects).toBeGreaterThan(0);

    // The host retries with b's generation REPLACED by a silent one and never
    // mentions a again. a's unfixed rejection is still on the task, so the
    // round must stay held — otherwise the host could skip a and advance.
    const second = submit(fx, onlyAct(fx, {}));
    expect(second.advanced).toBe(false);
    expect(second.rejected.length, "the sticky rejection is carried forward").toBeGreaterThanOrEqual(priorRejects);
    expect(second.rejected.some((e) => e.ref.includes(a))).toBe(true);
    cleanup(fx);
  });

  it("releases the hold once the previously-rejected persona is fixed", () => {
    const fx = fixture({ rounds: 1 });
    const [a] = fx.activated;
    const first = submit(fx, onlyAct(fx, {}, [{ persona: a, actions: [{ type: "post", body: "x".repeat(400) }] }]));
    expect(first.advanced).toBe(false);

    // The retry is a fresh round-1 task (the world never advanced), and a is
    // now valid. The hold releases and the round completes.
    const second = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 1),
      fx.activated.map((id) => ({ persona: id, actions: id === a ? [{ type: "post", body: "Acme Cloud is fine" }] : [] })),
      {}
    );
    expect(second.rejected).toEqual([]);
    expect(second.advanced).toBe(true);
    expect(second.round).toBe(1);
    expect(second.completed).toBe(true);
    expect(fx.db.getWorld(fx.world.id)!.round).toBe(1);
    cleanup(fx);
  });

  it("records the sticky hold on the task so a later reader can see why", () => {
    const fx = fixture();
    const [a] = fx.activated;
    submit(fx, onlyAct(fx, {}, [{ persona: a, actions: [{ type: "post", body: "x".repeat(400) }] }]));
    const verdict = fx.db.getTaskVerdicts(fx.world.id, fx.taskId)!;
    expect(verdict.rejected.length).toBeGreaterThan(0);
    const row = fx.db.db.prepare("SELECT status FROM generations WHERE world_id=? AND id=?").get(fx.world.id, fx.taskId) as { status: string };
    expect(row.status).toBe("held");
    cleanup(fx);
  });
});

describe("sim ingest — finalize produces lurkers", () => {
  it("advances past personas that never acted and records them as lurkers", () => {
    const fx = fixture();
    const [a, b] = fx.activated;
    // a acts, b never speaks, and two more personas are simply absent.
    const r = submit(fx, [{ persona: a, actions: [{ type: "post", body: "Acme Cloud is fine" }] }], { finalize: true });
    expect(r.advanced).toBe(true);
    expect(r.appliedPersonas).toEqual([a]);
    expect(r.lurkers).toContain(b);
    expect(r.lurkers.length).toBe(fx.activated.length - 1);
    expect(fx.db.getWorld(fx.world.id)!.round).toBe(1);
    cleanup(fx);
  });

  it("advances a round whose only rejection is unfixed, and keeps the rejection visible", () => {
    const fx = fixture();
    const [a] = fx.activated;
    const r = submit(fx, onlyAct(fx, {}, [{ persona: a, actions: [{ type: "post", body: "x".repeat(400) }] }]), {
      finalize: true,
    });
    expect(r.advanced).toBe(true);
    expect(r.rejected.length, "finalize advances, it does not launder the error").toBeGreaterThan(0);
    expect(r.lurkers).toContain(a);
    cleanup(fx);
  });

  it("completes the world and points at the report when the last round is finalized", () => {
    const fx = fixture({ rounds: 1 });
    const [a] = fx.activated;
    const r = submit(fx, [{ persona: a, actions: [] }], { finalize: true });
    expect(r.advanced).toBe(true);
    expect(r.completed).toBe(true);
    expect(r.next).toContain("report_plan");
    expect(fx.db.getWorld(fx.world.id)!.stage).toBe("completed");
    cleanup(fx);
  });

  it("an empty action array is a lurk, not a rejection", () => {
    const fx = fixture();
    const r = submit(fx, onlyAct(fx, {}));
    expect(r.rejected).toEqual([]);
    expect(r.advanced).toBe(true);
    expect(r.lurkers.sort()).toEqual([...fx.activated].sort());
    cleanup(fx);
  });
});

describe("sim ingest — applied actions", () => {
  it("creates a post with mentions resolved and a deterministic world-scoped id", () => {
    const fx = fixture();
    const [a] = fx.activated;
    const r = submit(fx, onlyAct(fx, { [a]: [{ type: "post", body: "Acme Cloud is great" }] }));
    expect(r.postsCreated).toBe(1);
    const post = fx.db.listPosts(fx.world.id, { personaId: a })[0];
    expect(post.id).toBe("po_1");
    expect(post.mentions).toHaveLength(1);
    expect(post.mentions[0].score).toBeGreaterThan(0);
    expect(post.threadId).toBe(post.id);
    expect(post.metrics.impressions).toBeGreaterThan(0);
    cleanup(fx);
  });

  it("bumps the parent metric for like and upvote", () => {
    const fx = fixture({ rounds: 2 });
    const tw = onPlatform(fx, "twitter");
    const tw2 = onPlatform(fx, "twitter", tw);
    const rd = onPlatform(fx, "reddit");
    const rd2 = onPlatform(fx, "reddit", rd);
    const seeded = submit(fx, [
      { persona: tw, actions: [{ type: "post", body: "Acme Cloud is great" }] },
      { persona: rd, actions: [{ type: "post", platform: "reddit", title: "t", body: "b" }] },
    ]);
    expect(seeded.postsCreated).toBe(2);
    const twPost = fx.db.listPosts(fx.world.id, { personaId: tw })[0];
    const rdPost = fx.db.listPosts(fx.world.id, { personaId: rd })[0];

    const r = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 2),
      [
        { persona: tw2, actions: [{ type: "like", parent: twPost.id }] },
        { persona: rd2, actions: [{ type: "upvote", parent: rdPost.id }] },
      ],
      { finalize: true }
    );
    expect(r.rejected).toEqual([]);
    expect(fx.db.getPost(fx.world.id, twPost.id)!.metrics.likes).toBe(1);
    expect(fx.db.getPost(fx.world.id, rdPost.id)!.metrics.upvotes).toBe(1);
    cleanup(fx);
  });

  it("records a downvote on a reddit post as a negative metric, not a positive one", () => {
    const fx = fixture({ rounds: 2 });
    const rd = onPlatform(fx, "reddit");
    const rd2 = onPlatform(fx, "reddit", rd);
    submit(fx, [{ persona: rd, actions: [{ type: "post", platform: "reddit", title: "t", body: "b" }] }]);
    const target = fx.db.listPosts(fx.world.id, { personaId: rd })[0];
    const r = submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 2),
      [{ persona: rd2, actions: [{ type: "downvote", parent: target.id }] }],
      { finalize: true }
    );
    expect(r.rejected).toEqual([]);
    // downvotes is a SUBTRACTIVE term in engagementScore, so misfiling it as
    // an upvote would make a hostile post look popular.
    expect(fx.db.getPost(fx.world.id, target.id)!.metrics.downvotes).toBe(1);
    expect(fx.db.getPost(fx.world.id, target.id)!.metrics.upvotes).toBe(0);
    cleanup(fx);
  });

  it("turns a repost with a note into a quote", () => {
    const fx = fixture({ rounds: 2 });
    const tw = onPlatform(fx, "twitter");
    const tw2 = onPlatform(fx, "twitter", tw);
    submit(fx, [{ persona: tw, actions: [{ type: "post", body: "Acme Cloud is great" }] }]);
    const target = fx.db.listPosts(fx.world.id, { personaId: tw })[0];
    submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 2),
      [{ persona: tw2, actions: [{ type: "repost", parent: target.id, note: "worth reading" }] }],
      { finalize: true }
    );
    const quote = fx.db.listPosts(fx.world.id, { kinds: ["quote"] })[0];
    expect(quote, "a repost carrying a note becomes a quote, not a repost").toBeTruthy();
    expect(quote.body).toBe("worth reading");
    expect(quote.parentId).toBe(target.id);
    expect(fx.db.getPost(fx.world.id, target.id)!.metrics.reposts).toBe(1);
    cleanup(fx);
  });

  it("turns a repost with no note into a repost carrying the parent's text", () => {
    const fx = fixture({ rounds: 2 });
    const tw = onPlatform(fx, "twitter");
    const tw2 = onPlatform(fx, "twitter", tw);
    submit(fx, [{ persona: tw, actions: [{ type: "post", body: "Acme Cloud is great" }] }]);
    const target = fx.db.listPosts(fx.world.id, { personaId: tw })[0];
    submitGenerations(
      fx.db,
      fx.db.getWorld(fx.world.id)!,
      newTask(fx, 2),
      [{ persona: tw2, actions: [{ type: "repost", parent: target.id }] }],
      { finalize: true }
    );
    const repost = fx.db.listPosts(fx.world.id, { kinds: ["repost"] })[0];
    expect(repost).toBeTruthy();
    expect(repost.body).toContain("Acme Cloud is great");
    cleanup(fx);
  });

  it("throws when the task round no longer matches the world", () => {
    const fx = fixture({ rounds: 2 });
    const a = fx.activated[0];
    submit(fx, onlyAct(fx, { [a]: [{ type: "post", body: "x" }] }));
    // The world is now at round 1, so re-submitting the round-1 task must be
    // refused rather than silently re-running the round.
    expect(() => submit(fx, onlyAct(fx, { [a]: [{ type: "post", body: "y" }] }))).toThrow(/does not match world state/);
    cleanup(fx);
  });
});
