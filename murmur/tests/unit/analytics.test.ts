/**
 * Analytics: the pure, deterministic read layer the report narrative is written
 * around. Every function here is a pure function of stored world state — no LLM,
 * no clock, no randomness — which is exactly what makes it cheap to pin.
 *
 * The fixtures are hand-built rather than pipeline-produced so each assertion
 * states its own arithmetic: a faction split of 3/1/2 with a known polarization
 * formula, a known engagement total, a known controversy weighting. A test that
 * runs the pipeline and compares one run's output to itself proves nothing.
 *
 * Two behaviours here are pinned deliberately rather than assumed correct:
 *
 *   - `momentum` splits at `Math.floor(n / 2)`, so an ODD-length series
 *     OVERLAPS: the middle row counts in both halves. That is the shipped
 *     behaviour and the report renders both numbers, so it is pinned as-is
 *     rather than "fixed" here.
 *   - `amplification.organicEngagementShare` is `null` below ten organic
 *     reposts. The golden test proves a real run lands below that; this file
 *     proves the function is capable of returning a NUMBER at all, which the
 *     suppression makes easy to break silently.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Storage, openDatabase, sentimentCurve } from "@murmur/engine";
import type { Entity, Persona, Post, World } from "@murmur/engine";
import {
  allEscalations,
  amplification,
  attributedSentiment,
  controversyIndex,
  crossPlatform,
  entityTrends,
  factionAnalysis,
  momentum,
  personaArcs,
  projectCurve,
  quoteBank,
  startStances,
  type TimelineRow,
} from "../../packages/engine/src/analytics.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-analytics-"));

function newWorld(seed = "analytics-1"): { db: Storage; world: World; dir: string } {
  const dir = tmp();
  const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
  const world = db.createWorld({ name: "analytics world", seed });
  return { db, world, dir };
}

function persona(over: Partial<Persona> & { id: string }): Omit<Persona, "worldId" | "createdAt"> {
  const suffix = over.id.replace(/^p_/, "");
  return {
    name: `P${suffix}`,
    handle: `@p${suffix}`,
    archetype: "casual",
    bio: "bio",
    traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
    stances: {},
    platform: "both",
    activity: 0.5,
    communityIds: [],
    follows: [],
    ...over,
  } as Omit<Persona, "worldId" | "createdAt">;
}

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
    metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
    mentions: [],
    origin: "generated",
    body: "",
    ...over,
  } as Post;
}

/**
 * A 3-round world: 6 personas, 2 entities, one post per persona per round on
 * both platforms, and a round_stats event per round so the timeline, mover and
 * escalation readers all have data.
 */
function fixture(): { db: Storage; world: World; focus: Entity; other: Entity; dir: string } {
  const { db, world, dir } = newWorld();
  const { inserted } = db.insertEntities(world.id, [
    { name: "Acme Cloud", type: "org", description: "the company", salience: 0.9, anchors: [], motives: [] },
    { name: "Nimbus Labs", type: "org", description: "the rival", salience: 0.7, anchors: [], motives: [] },
  ]);
  const focus = inserted[0];
  const other = inserted[1];

  db.insertPersonas(
    world.id,
    [
      persona({ id: "p_1", stances: { [focus.id]: 0.8 } }),
      persona({ id: "p_2", stances: { [focus.id]: 0.5 } }),
      persona({ id: "p_3", stances: { [focus.id]: 0.4 } }),
      persona({ id: "p_4", stances: { [focus.id]: -0.7 } }),
      persona({ id: "p_5", stances: { [focus.id]: -0.4 } }),
      persona({ id: "p_6", stances: { [focus.id]: 0.05 } }), // inside the ±0.2 deadband → undecided
    ].map((p) => p as Omit<Persona, "worldId" | "createdAt">)
  );

  for (let r = 1; r <= 3; r++) {
    for (let i = 1; i <= 6; i++) {
      const tw = post({
        id: `po_tw_${r}_${i}`,
        worldId: world.id,
        round: r,
        personaId: `p_${i}`,
        platform: "twitter",
        body: i <= 3 ? "Acme Cloud great reliability" : "Acme Cloud terrible paywall ripoff",
        metrics: { likes: i, reposts: 0, upvotes: 0, downvotes: 0, impressions: 10 },
        mentions: [{ entityId: focus.id, score: i <= 3 ? 0.6 : -0.7 }],
      });
      const rd = post({
        id: `po_rd_${r}_${i}`,
        worldId: world.id,
        round: r,
        personaId: `p_${i}`,
        platform: "reddit",
        kind: "post",
        body: i <= 3 ? "Acme Cloud good news" : "Acme Cloud bad news",
        metrics: { likes: 0, reposts: 0, upvotes: i, downvotes: 0, impressions: 5 },
        mentions: [{ entityId: focus.id, score: i <= 3 ? 0.4 : -0.5 }],
      });
      db.insertPost(tw);
      db.insertPost(rd);
    }
    db.addEvent(
      world.id,
      r,
      "round_stats",
      {
        stats: {
          round: r,
          postsByPlatform: { twitter: 6, reddit: 6 },
          actions: { posts: 12, replies: 0, comments: 0, reposts: 0, quotes: 0, votes: 0 },
          engagement: { likes: 21, reposts: 0, upvotes: 21, downvotes: 0, impressions: 90 },
          sentimentByEntity: { "Acme Cloud": r <= 2 ? 0.5 : 0.2 },
          topMovers: r === 1 ? [{ personaId: "p_1", entity: "Acme Cloud", from: 0.5, to: 0.8 }] : [],
          escalations: r === 2 ? [{ rootId: "po_tw_2_1", path: ["po_tw_2_1", "po_tw_2_2"], depth: 2, participants: ["p_1", "p_2"], finalSentiment: -0.8, severity: 1.4 }] : [],
          newViral: [],
          injections: [],
          activated: ["p_1"],
          lurkers: [],
        },
      },
      "world"
    );
  }
  db.updateWorld(world.id, { round: 3 });
  return { db, world: db.getWorld(world.id)!, focus, other, dir };
}

describe("attributedSentiment", () => {
  const { db, world, focus, other, dir } = fixture();
  // The rival's praise sits in a FOLLOWING sentence, not the anchor: that is
  // the only position the other-entity exclusion can act on. Putting "Nimbus
  // Labs is great" in the same sentence as the focus would leave the anchor
  // sentence in the window no matter what, which is why the naive version of
  // this test passes for the wrong reason.
  const acmePost = post({
    id: "po_attr_1",
    worldId: world.id,
    body: "Acme Cloud is great. Nimbus Labs is terrible. Nimbus Labs is awful.",
    mentions: [],
  });
  db.insertPost(acmePost);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });

  it("excludes sentences naming a different entity from the focus window", () => {
    const withOthers = attributedSentiment(acmePost, focus, ["Nimbus Labs"]);
    const withoutOthers = attributedSentiment(acmePost, focus, []);
    // The rival's two hostile sentences drag the focus score down unless they
    // are excluded; with the exclusion the score is the anchor sentence alone.
    expect(withOthers).toBeGreaterThan(0);
    expect(withOthers).toBeGreaterThan(withoutOthers);
  });

  it("falls back to post-level sentiment when no sentence names the entity", () => {
    // A post about the rival only still yields a finite, rival-scored number
    // rather than 0 — the fallback is the whole-post score, not a zero.
    const rivalOnly = post({ id: "po_attr_rival", worldId: world.id, body: "Nimbus Labs is great", mentions: [] });
    const score = attributedSentiment(rivalOnly, focus, ["Nimbus Labs"]);
    expect(score).toBeGreaterThan(0);
  });

  it("is word-bounded: a longer word that merely starts with the name is not a mention", () => {
    const p = post({ id: "po_attr_2", worldId: world.id, body: "Acmeless is terrible. AcmeCloud is awful." });
    const e: Entity = { ...focus, name: "Acme" };
    // No sentence names "Acme" as a word, so the whole-post score applies and
    // the post is not treated as being about the entity at all.
    expect(attributedSentiment(p, e)).toBeLessThan(0);
  });

  it("is case-insensitive", () => {
    const p = post({ id: "po_attr_2b", worldId: world.id, body: "ACME CLOUD is great." });
    const e: Entity = { ...focus, name: "acme cloud" };
    expect(attributedSentiment(p, e)).toBeGreaterThan(0);
  });

  it("includes the two following sentences after the anchor, where punchlines live", () => {
    const p = post({ id: "po_attr_3", worldId: world.id, body: "Neutral. Acme Cloud is great. Also great. Also great." });
    expect(attributedSentiment(p, focus, [])).toBeGreaterThan(0.3);
  });

  it("ignores the entity's own name in the other-entity list", () => {
    const p = post({ id: "po_attr_4", worldId: world.id, body: "Acme Cloud is great." });
    expect(attributedSentiment(p, focus, ["Acme Cloud", other.name])).toBe(attributedSentiment(p, focus, [other.name]));
  });

  it("returns 0 for an empty post body rather than throwing", () => {
    const p = post({ id: "po_attr_5", worldId: world.id, body: "" });
    expect(attributedSentiment(p, focus, [])).toBe(0);
  });
});

describe("factionAnalysis", () => {
  it("buckets personas by stance at the ±0.2 boundary and computes polarization arithmetically", () => {
    const { db, world, focus, dir } = fixture();
    const a = factionAnalysis(db, world, focus);
    const byKey = Object.fromEntries(a.factions.map((f) => [f.key, f]));

    expect(byKey.supporters.size).toBe(3); // 0.8, 0.5, 0.4
    expect(byKey.opponents.size).toBe(2); // -0.7, -0.4
    expect(byKey.undecided.size).toBe(1); // 0.05, inside the deadband

    // polarization = (committed / total) × (0.5 + 0.5 × balance)
    // committed = 5, total = 6, balance = 1 - |3 - 2| / 5 = 0.8
    // → 5/6 × 0.9 = 0.75
    expect(a.polarization).toBe(0.75);
    expect(a.focusEntity).toBe("Acme Cloud");
    expect(a.verdict).toContain("3 supporters vs 2 opponents");
    expect(a.verdict).toContain("1 still undecided");
    expect(a.verdict).toContain("deeply polarized");

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("excludes reposts from faction post and engagement counts", () => {
    const { db, world, focus, dir } = fixture();
    const before = factionAnalysis(db, world, focus);
    db.insertPost(
      post({
        id: "po_repost_x",
        worldId: world.id,
        personaId: "p_1",
        kind: "repost",
        body: "Acme Cloud great",
        metrics: { likes: 99, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
        mentions: [{ entityId: focus.id, score: 0.9 }],
      })
    );
    const after = factionAnalysis(db, world, focus);
    const sup = after.factions.find((f) => f.key === "supporters")!;
    const supBefore = before.factions.find((f) => f.key === "supporters")!;
    expect(sup.posts).toBe(supBefore.posts);
    expect(sup.engagement).toBe(supBefore.engagement);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ranks leaders by engagement and caps the list at three", () => {
    const { db, world, focus, dir } = fixture();
    const a = factionAnalysis(db, world, focus);
    for (const f of a.factions) {
      expect(f.leaders.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < f.leaders.length; i++) {
        expect(f.leaders[i - 1].engagement).toBeGreaterThanOrEqual(f.leaders[i].engagement);
      }
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps faction quotes distinct by author and only quotes posts naming the focus", () => {
    const { db, world, focus, dir } = fixture();
    db.insertPost(
      post({
        id: "po_offtopic_1",
        worldId: world.id,
        personaId: "p_1",
        body: "completely unrelated chatter about nothing at all",
        metrics: { likes: 50, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
      })
    );
    const a = factionAnalysis(db, world, focus);
    for (const f of a.factions) {
      const authors = f.quotes.map((q) => q.by);
      expect(new Set(authors).size, `faction ${f.key} repeats an author`).toBe(authors.length);
      for (const q of f.quotes) {
        const p = db.getPost(world.id, q.id)!;
        expect(p.mentions.some((m) => m.entityId === focus.id) || p.body.length > 0).toBe(true);
        expect(q.attrSentiment, "a quote that names the focus carries attributed sentiment").toBeTypeOf("number");
      }
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("honours the exclude set when another section already claimed the quotes", () => {
    const { db, world, focus, dir } = fixture();
    const all = factionAnalysis(db, world, focus);
    const claimed = new Set(all.factions.flatMap((f) => f.quotes.map((q) => q.id)));
    const second = factionAnalysis(db, world, focus, claimed);
    const secondIds = new Set(second.factions.flatMap((f) => f.quotes.map((q) => q.id)));
    for (const id of secondIds) expect(claimed.has(id)).toBe(false);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats every persona as undecided when no focus entity is given", () => {
    const { db, world, dir } = fixture();
    const a = factionAnalysis(db, world, null);
    const und = a.factions.find((f) => f.key === "undecided")!;
    expect(und.size).toBe(6);
    expect(a.factions.find((f) => f.key === "supporters")!.size).toBe(0);
    // No commitment → no polarization, and the mood is the "coalescing" one.
    expect(a.polarization).toBe(0);
    expect(a.verdict).toContain("still coalescing");
    expect(a.focusEntity).toBe("the scenario");
    // sentimentByRound is only computed when there is a focus.
    expect(und.sentimentByRound).toEqual([]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("crossPlatform", () => {
  it("averages per-platform sentiment and reports the largest split first", () => {
    const { db, world, focus, other, dir } = fixture();
    const c = crossPlatform(db, world, [focus, other]);

    expect(c.totals.twitterPosts).toBe(18);
    expect(c.totals.redditPosts).toBe(18);
    // Twitter: three +0.6 and three -0.7 → mean 0.6*3 - 0.7*3 = -0.3 / 6 = -0.05
    // Reddit:   three +0.4 and three -0.5 → (1.2 - 1.5) / 6 = -0.05
    const row = c.rows.find((r) => r.entity === "Acme Cloud")!;
    expect(row.twitter).toBe(-0.05);
    expect(row.reddit).toBe(-0.05);
    expect(row.divergence).toBe(0);
    expect(row.twPosts).toBe(18); // 3 rounds × 6 personas
    expect(row.rdPosts).toBe(18);

    // The rival is never mentioned, so it is dropped from the table entirely.
    expect(c.rows.map((r) => r.entity)).toEqual(["Acme Cloud"]);
    expect(c.maxDivergence!.value).toBe(0);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null platform means and no maxDivergence when an entity is one-platform only", () => {
    const { db, world, focus, dir } = fixture();
    for (const p of db.listPosts(world.id, { platform: "reddit" }).slice(0, 9)) {
      db.updatePostMetrics(world.id, p.id, p.metrics);
    }
    // Remove every reddit post: the entity now has Twitter only.
    db.db.prepare("DELETE FROM posts WHERE world_id=? AND platform='reddit'").run(world.id);
    const c = crossPlatform(db, world, [focus]);
    const row = c.rows[0];
    expect(row.reddit).toBeNull();
    expect(row.twPosts).toBeGreaterThan(0);
    expect(c.maxDivergence, "a one-sided entity has no comparable split").toBeNull();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("attributes each escalation chain to its root's platform", () => {
    const { db, world, focus, dir } = fixture();
    const c = crossPlatform(db, world, [focus]);
    expect(c.totals.twitterEscalations).toBe(1);
    expect(c.totals.redditEscalations).toBe(0);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("controversyIndex", () => {
  it("weights polarization, negative engagement share and escalation density into one score", () => {
    const { db, world, focus, dir } = fixture();
    const factions = factionAnalysis(db, world, focus);
    const c = controversyIndex(db, world, factions);

    expect(c.drivers).toHaveLength(3);
    expect(c.drivers[0].weight).toBe(40);
    expect(c.drivers[1].weight).toBe(30);
    expect(c.drivers[2].weight).toBe(30);
    // 40·polarization + 30·negShare + 30·clamp(escPerRound/2)
    const recomputed = Math.round(
      c.drivers.reduce((acc, d) => acc + d.value * d.weight, 0)
    );
    expect(c.score).toBe(recomputed);
    expect(["low-stakes", "simmering", "contested", "polarized", "combustible"]).toContain(c.label);
    expect(c.drivers[2].label).toContain("1 chains over 3 rounds");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads low-stakes for an empty, unengaged world rather than dividing by zero", () => {
    const { db, world, dir } = newWorld("quiet");
    const factions = factionAnalysis(db, world, null);
    const c = controversyIndex(db, world, factions);
    expect(c.score).toBe(0);
    expect(c.label).toBe("low-stakes");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("personaArcs and startStances", () => {
  it("reconstructs a start stance from the first mover record and labels the arc", () => {
    const { db, world, focus, dir } = fixture();
    const starts = startStances(db, world, "Acme Cloud");
    // Only round 1 recorded a mover, and only for p_1.
    expect(starts.get("p_1")).toBe(0.5);
    expect(starts.size).toBe(1);

    const arcs = personaArcs(db, world, focus, 3);
    expect(arcs).toHaveLength(3);
    const p1 = arcs.find((a) => a.personaId === "p_1")!;
    expect(p1.focusStart).toBe(0.5);
    expect(p1.focusEnd).toBe(0.8);
    expect(p1.delta).toBe(0.3);
    expect(p1.arcLabel).toBe("warmed to Acme Cloud");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the end stance when a persona has no mover history", () => {
    const { db, world, focus, dir } = fixture();
    const arcs = personaArcs(db, world, focus, 6);
    const p2 = arcs.find((a) => a.personaId === "p_2")!;
    expect(p2.focusStart).toBe(0.5);
    expect(p2.focusEnd).toBe(0.5);
    expect(p2.delta).toBe(0);
    expect(p2.arcLabel).toBe("steadfast champion of Acme Cloud");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("labels the negative and steady arc directions", () => {
    const { db, world, focus, dir } = fixture();
    db.addEvent(
      world.id,
      2,
      "round_stats",
      {
        stats: {
          round: 2,
          postsByPlatform: { twitter: 0, reddit: 0 },
          actions: { posts: 0, replies: 0, comments: 0, reposts: 0, quotes: 0, votes: 0 },
          engagement: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
          sentimentByEntity: {},
          topMovers: [{ personaId: "p_4", entity: "Acme Cloud", from: 0.3, to: -0.7 }],
          escalations: [],
          newViral: [],
          injections: [],
          activated: [],
          lurkers: [],
        },
      },
      "world"
    );
    const arcs = personaArcs(db, world, focus, 6);
    const p4 = arcs.find((a) => a.personaId === "p_4")!;
    expect(p4.delta).toBe(-1);
    expect(p4.arcLabel).toBe("soured on Acme Cloud");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("orders by absolute delta, not by engagement, and truncates to the limit", () => {
    const { db, world, focus, dir } = fixture();
    const arcs = personaArcs(db, world, focus, 2);
    expect(arcs).toHaveLength(2);
    for (let i = 1; i < arcs.length; i++) {
      expect(Math.abs(arcs[i - 1].delta)).toBeGreaterThanOrEqual(Math.abs(arcs[i].delta));
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("labels every persona 'observer' when there is no focus entity", () => {
    const { db, world, dir } = fixture();
    const arcs = personaArcs(db, world, null, 3);
    for (const a of arcs) expect(a.arcLabel).toBe("observer");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("prefers a signature quote that is not already claimed elsewhere", () => {
    const { db, world, focus, dir } = fixture();
    const p1Posts = db.listPosts(world.id, { personaId: "p_1", limit: 100000 });
    const claimed = p1Posts.slice(0, p1Posts.length - 1).map((p) => p.id);
    const arcs = personaArcs(db, world, focus, 6, new Set(claimed));
    const p1 = arcs.find((a) => a.personaId === "p_1")!;
    expect(p1.signatureQuote).not.toBeNull();
    expect(claimed).not.toContain(p1.signatureQuote!.id);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to an already-claimed quote rather than showing none — a duplicate beats a blank", () => {
    // `exclude` is a soft preference, not a filter. When EVERY post by the
    // persona is claimed by an earlier section, the best one is repeated: the
    // alternative is a persona spotlight with no quote at all.
    const { db, world, focus, dir } = fixture();
    const all = db.listPosts(world.id, { personaId: "p_1", limit: 100000 });
    const arcs = personaArcs(db, world, focus, 6, new Set(all.map((p) => p.id)));
    const p1 = arcs.find((a) => a.personaId === "p_1")!;
    expect(p1.signatureQuote).not.toBeNull();
    expect(all.some((p) => p.id === p1.signatureQuote!.id)).toBe(true);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns a null signature quote for a persona who never posted", () => {
    const { db, world, focus, dir } = fixture();
    db.insertPersonas(world.id, [
      {
        name: "Quiet",
        handle: "@quiet",
        archetype: "lurker",
        bio: "never posts",
        traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
        stances: { [focus.id]: 0.3 },
        platform: "twitter",
        activity: 0.5,
        communityIds: [],
        follows: [],
      },
    ] as never);
    const quietId = db.listPersonas(world.id).find((p) => p.handle === "@quiet")!.id;
    const arcs = personaArcs(db, world, focus, 12);
    const quiet = arcs.find((a) => a.personaId === quietId)!;
    expect(quiet).toBeTruthy();
    expect(quiet.posts).toBe(0);
    expect(quiet.signatureQuote).toBeNull();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("quoteBank", () => {
  it("classifies by attributed sentiment and never misattributes a post that skips the focus", () => {
    const { db, world, focus, dir } = fixture();
    db.insertPost(
      post({
        id: "po_skew_1",
        worldId: world.id,
        personaId: "p_1",
        body: "unrelated chatter",
        metrics: { likes: 100, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
      })
    );
    const bank = quoteBank(db, world, focus, 3);
    for (const q of [...bank.positive, ...bank.negative, ...bank.mixed]) {
      const p = db.getPost(world.id, q.id)!;
      expect(p.body, "a quote that never names the focus must not reach the bank").toContain("Acme");
    }
    expect(bank.positive.every((q) => q.attrSentiment! >= 0.3)).toBe(true);
    expect(bank.negative.every((q) => q.attrSentiment! <= -0.3)).toBe(true);
    expect(bank.mixed.every((q) => Math.abs(q.attrSentiment!) < 0.3)).toBe(true);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("respects perBucket and keeps one post per persona inside a bucket", () => {
    const { db, world, focus, dir } = fixture();
    for (const perBucket of [1, 2, 3]) {
      const bank = quoteBank(db, world, focus, perBucket);
      for (const bucket of [bank.positive, bank.negative, bank.mixed]) {
        expect(bucket.length).toBeLessThanOrEqual(perBucket);
        expect(new Set(bucket.map((q) => q.by)).size).toBe(bucket.length);
      }
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tops a thin bucket up with repeats rather than returning nothing", () => {
    const { db, world, focus, dir } = fixture();
    // Only one persona speaks, so perBucket=3 is unreachable with the
    // no-repeat rule; the top-up path must still produce quotes.
    for (const p of db.listPersonas(world.id)) {
      if (p.id !== "p_1") db.patchPersona(world.id, p.id, { platform: "twitter" });
    }
    db.db.prepare("DELETE FROM posts WHERE world_id=? AND persona_id != 'p_1'").run(world.id);
    const bank = quoteBank(db, world, focus, 3);
    expect(bank.positive.length).toBeGreaterThan(0);
    expect(new Set(bank.positive.map((q) => q.id)).size).toBe(bank.positive.length);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uses whole-post sentiment when no focus is supplied", () => {
    const { db, world, dir } = fixture();
    const bank = quoteBank(db, world, null, 2);
    for (const q of [...bank.positive, ...bank.negative, ...bank.mixed]) {
      expect(q.attrSentiment).toBeTypeOf("number");
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("momentum", () => {
  const row = (engagement: number): TimelineRow => ({
    round: 1,
    twitter: 1,
    reddit: 0,
    engagement,
    sentimentByEntity: {},
    escalations: 0,
    injections: 0,
    lurkers: 0,
  });

  it("splits an EVEN-length series cleanly", () => {
    const m = momentum([row(10), row(20), row(30), row(40)]);
    expect(m.firstHalf).toBe(30);
    expect(m.secondHalf).toBe(70);
    expect(m.pct).toBe(1.33);
    expect(m.trend).toBe("accelerating");
  });

  it("OVERLAPS the middle row when the series length is odd — the shipped behaviour, pinned", () => {
    // series = [10, 20, 30, 40, 50]; mid = floor(5/2) = 2.
    // firstHalf = slice(0, 2) = [10, 20] = 30
    // secondHalf = slice(2)    = [30, 40, 50] = 120
    // The two halves are NOT disjoint in the sense a reader assumes: the split
    // point sits before the middle row, so a 5-row run is compared 2-vs-3.
    const m = momentum([row(10), row(20), row(30), row(40), row(50)]);
    expect(m.firstHalf).toBe(30);
    expect(m.secondHalf).toBe(120);
    expect(m.firstHalf + m.secondHalf).toBe(150);
    expect(m.pct).toBe(3);
    expect(m.trend).toBe("accelerating");
  });

  it("reports quiet for an empty or all-zero series", () => {
    expect(momentum([])).toEqual({ firstHalf: 0, secondHalf: 0, pct: 0, trend: "quiet" });
    expect(momentum([row(0), row(0)])).toEqual({ firstHalf: 0, secondHalf: 0, pct: 0, trend: "quiet" });
  });

  it("reports pct 1 when the first half is silent but the second half is not", () => {
    // pct would be Infinity under a plain division, so the firstHalf === 0
    // branch caps it. A run that only ignites late is "accelerating", not broken.
    const m = momentum([row(0), row(0), row(5), row(5)]);
    expect(m.firstHalf).toBe(0);
    expect(m.secondHalf).toBe(10);
    expect(m.pct).toBe(1);
    expect(Number.isFinite(m.pct)).toBe(true);
  });

  it("reports pct 0 when both halves are silent but the total is non-zero", () => {
    // Two rows only: mid = 1, so firstHalf = [0] = 0 and secondHalf = [0] = 0,
    // yet `total` is 0 too — the early return catches it. The [0, 0, 0, 1]
    // shape is the one that reaches the pct branch with a zero first half.
    const m = momentum([row(0), row(0), row(0), row(1)]);
    expect(m.firstHalf).toBe(0);
    expect(m.secondHalf).toBe(1);
    expect(m.pct).toBe(1);
  });

  it("classifies cooling and steady at the ±25% boundaries", () => {
    // cooling: second half 30 vs first half 60 → pct -0.5
    expect(momentum([row(30), row(30), row(20), row(10)]).trend).toBe("cooling");
    // steady: second half 55 vs first half 50 → pct 0.1
    expect(momentum([row(25), row(25), row(30), row(25)]).trend).toBe("steady");
    // exactly +25% is steady, not accelerating (the test is strict >).
    const edge = momentum([row(40), row(40), row(50), row(50)]);
    expect(edge.pct).toBe(0.25);
    expect(edge.trend).toBe("steady");
  });
});

describe("projectCurve", () => {
  it("fits a straight line and extrapolates beyond the last round", () => {
    const p = projectCurve([
      { round: 1, value: 0 },
      { round: 2, value: 0.1 },
      { round: 3, value: 0.2 },
    ]);
    expect(p.slope).toBe(0.1);
    expect(p.direction).toBe("up");
    const projected = p.points.filter((x) => x.projected);
    expect(projected.map((x) => x.round)).toEqual([4, 5]);
    expect(projected[0].value).toBeCloseTo(0.3, 2);
  });

  it("is flat and unprojected-into-meaning for a degenerate curve", () => {
    expect(projectCurve([{ round: 1, value: 0.3 }]).direction).toBe("flat");
    expect(projectCurve([]).points).toEqual([]);
    // Every point on the same round → zero denominator, slope 0, no NaN.
    const degenerate = projectCurve([
      { round: 1, value: 0.3 },
      { round: 1, value: 0.4 },
    ]);
    expect(degenerate.slope).toBe(0);
    expect(degenerate.direction).toBe("flat");
  });

  it("clamps the extrapolation to [-1, 1]", () => {
    const p = projectCurve([
      { round: 1, value: 0.5 },
      { round: 2, value: 0.9 },
    ], 20);
    for (const point of p.points) {
      expect(point.value).toBeLessThanOrEqual(1);
      expect(point.value).toBeGreaterThanOrEqual(-1);
    }
  });

  it("treats a slope within ±0.02 as flat", () => {
    const p = projectCurve([
      { round: 1, value: 0 },
      { round: 2, value: 0.01 },
    ]);
    expect(p.slope).toBe(0.01);
    expect(p.direction).toBe("flat");
  });
});

describe("entityTrends", () => {
  it("reports direction, volume, peak round and delta from a real sentiment curve", () => {
    const { db, world, focus, dir } = fixture();
    const trends = entityTrends(db, world, [focus], (e) => sentimentCurve(db, world, e), 6);
    expect(trends).toHaveLength(1);
    const t = trends[0];
    expect(t.entity).toBe("Acme Cloud");
    expect(t.type).toBe("org");
    expect(t.volume).toBe(36); // 18 twitter + 18 reddit
    expect(t.peakRound).toBe(1);
    // Every round mixes three +0.6/three -0.7 on Twitter with three +0.4/
    // three -0.5 on Reddit, so the per-round mean is identical each round.
    expect(t.first).toBe(-0.05);
    expect(t.last).toBe(-0.05);
    expect(t.delta).toBe(0);
    expect(t.direction).toBe("flat");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks direction flat within the ±0.05 band and up beyond it", () => {
    const { db, world, focus, dir } = fixture();
    const flat = entityTrends(db, world, [focus], () => [
      { round: 1, value: 0.2 },
      { round: 2, value: 0.22 },
    ]);
    expect(flat[0].direction).toBe("flat");
    const up = entityTrends(db, world, [focus], () => [
      { round: 1, value: 0.2 },
      { round: 2, value: 0.4 },
    ]);
    expect(up[0].direction).toBe("up");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("drops entities the crowd never mentioned", () => {
    const { db, world, focus, other, dir } = fixture();
    const trends = entityTrends(db, world, [focus, other], (e) => sentimentCurve(db, world, e), 6);
    expect(trends.map((t) => t.entity)).toEqual(["Acme Cloud"]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("honours the limit", () => {
    const { db, world, dir } = fixture();
    db.insertPost(
      post({ id: "po_extra", worldId: world.id, personaId: "p_2", body: "Nimbus Labs great", mentions: [{ entityId: "e_2", score: 0.3 }] })
    );
    const all = db.listEntities(world.id);
    expect(entityTrends(db, world, all, () => [{ round: 1, value: 0.1 }], 1)).toHaveLength(1);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("allEscalations", () => {
  it("collects chains across rounds and de-duplicates by root id", () => {
    const { db, world, dir } = fixture();
    db.addEvent(
      world.id,
      3,
      "round_stats",
      {
        stats: {
          round: 3,
          postsByPlatform: { twitter: 0, reddit: 0 },
          actions: { posts: 0, replies: 0, comments: 0, reposts: 0, quotes: 0, votes: 0 },
          engagement: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
          sentimentByEntity: {},
          topMovers: [],
          escalations: [{ rootId: "po_tw_2_1", path: ["po_tw_2_1", "po_tw_2_2"], depth: 2, participants: ["p_1", "p_2"], finalSentiment: -0.8, severity: 1.4 }],
          newViral: [],
          injections: [],
          activated: [],
          lurkers: [],
        },
      },
      "world"
    );
    const chains = allEscalations(db, world);
    expect(chains).toHaveLength(1);
    expect(chains[0].rootId).toBe("po_tw_2_1");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is empty when no round recorded a chain", () => {
    const { db, world, dir } = newWorld("nochains");
    expect(allEscalations(db, world)).toEqual([]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("amplification", () => {
  it("lists twitter posts over the population-scaled threshold with their amplifiers", () => {
    const { db, world, focus, dir } = fixture();
    // 6 personas → max(1, 6/24) = 1, so the threshold is the raw 8.
    const root = post({
      id: "po_viral_root",
      worldId: world.id,
      personaId: "p_1",
      body: "Acme Cloud is great",
      metrics: { likes: 9, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
      mentions: [{ entityId: focus.id, score: 0.5 }],
    });
    db.insertPost(root);
    for (let i = 2; i <= 4; i++) {
      db.insertPost(
        post({
          id: `po_viral_child_${i}`,
          worldId: world.id,
          personaId: `p_${i}`,
          kind: "repost",
          parentId: root.id,
          body: "↻ Acme Cloud is great",
          metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
        })
      );
    }
    const a = amplification(db, world);
    const viral = a.viralPosts.find((v) => v.id === root.id)!;
    expect(viral).toBeTruthy();
    expect(viral.engagement).toBe(9);
    expect(viral.amplifiers.sort()).toEqual(["@p2", "@p3", "@p4"]);
    // Reposts are never themselves "viral posts" even when highly engaged.
    db.updatePostMetrics(world.id, `po_viral_child_2`, { likes: 500, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 });
    expect(amplification(db, world).viralPosts.some((v) => v.id === "po_viral_child_2")).toBe(false);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("excludes reddit posts from the viral list — virality is a twitter-only mechanic", () => {
    const { db, world, dir } = fixture();
    for (const p of db.listPosts(world.id, { platform: "reddit" })) {
      db.updatePostMetrics(world.id, p.id, { likes: 0, reposts: 0, upvotes: 500, downvotes: 0, impressions: 0 });
    }
    expect(amplification(db, world).viralPosts).toEqual([]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("caps the viral list at five and de-duplicates amplifiers", () => {
    const { db, world, focus, dir } = fixture();
    for (let i = 0; i < 7; i++) {
      db.insertPost(
        post({
          id: `po_v${i}`,
          worldId: world.id,
          personaId: `p_${(i % 6) + 1}`,
          body: "Acme Cloud great",
          metrics: { likes: 20 - i, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
          mentions: [{ entityId: focus.id, score: 0.5 }],
        })
      );
    }
    const a = amplification(db, world);
    expect(a.viralPosts.length).toBe(5);
    expect(a.viralPosts[0].id).toBe("po_v0");
    for (let i = 1; i < a.viralPosts.length; i++) {
      expect(a.viralPosts[i - 1].engagement).toBeGreaterThanOrEqual(a.viralPosts[i].engagement);
    }
    for (const v of a.viralPosts) expect(new Set(v.amplifiers).size).toBe(v.amplifiers.length);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("suppresses organicEngagementShare as null below ten organic posts", () => {
    const { db, world, dir } = fixture();
    // The real runs land at 1-5 organic reposts, so this is the live shape.
    const a = amplification(db, world);
    expect(a.organicPostCount).toBeLessThan(10);
    expect(a.organicEngagementShare).toBeNull();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("computes organicEngagementShare once ten organic posts exist", () => {
    // The null path is well covered; this is the branch that proves the ratio
    // is still computable and is not structurally zero (an earlier audit
    // concluded it was, by measuring the wrong denominator).
    const { db, world, dir } = fixture();
    for (let i = 0; i < 10; i++) {
      db.insertPost(
        post({
          id: `po_org_${i}`,
          worldId: world.id,
          personaId: `p_${(i % 6) + 1}`,
          kind: "repost",
          body: "↻ Acme Cloud great",
          origin: "organic",
          metrics: { likes: 1, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 },
        })
      );
    }
    const a = amplification(db, world);
    expect(a.organicPostCount).toBe(10);
    expect(a.organicEngagementShare).not.toBeNull();
    expect(a.organicEngagementShare!).toBeGreaterThan(0);
    expect(a.organicEngagementShare!).toBeLessThan(1);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is null when total engagement is zero even with enough organic posts", () => {
    const { db, world, dir } = fixture();
    db.db.prepare("UPDATE posts SET metrics=? WHERE world_id=?").run(
      JSON.stringify({ likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 }),
      world.id
    );
    for (let i = 0; i < 12; i++) {
      db.insertPost(
        post({ id: `po_org0_${i}`, worldId: world.id, personaId: "p_1", kind: "repost", body: "x", origin: "organic" })
      );
    }
    const a = amplification(db, world);
    expect(a.organicPostCount).toBe(12);
    expect(a.organicEngagementShare).toBeNull();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
