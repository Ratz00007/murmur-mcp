/** Simulation-core tests: activation, platform scoring, persona cards, submit validation + surgical retry. */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Storage, openDatabase } from "./store/storage.js";
import { activatePersonas } from "./sim/activation.js";
import { redditScore, twitterScore } from "./sim/feed.js";
import { buildSimBatch } from "./sim/batch.js";
import { submitGenerations } from "./sim/ingest.js";
import { personaCard } from "./personas.js";
import type { SimGeneration } from "./types.js";
import type { Entity, Persona, Post, World } from "./types.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-sim-"));

function fixture(personaCount = 6): { db: Storage; world: World; personas: Persona[] } {
  const db = new Storage(openDatabase(path.join(tmp(), "murmur.db")));
  const world = db.createWorld({ name: "simtest", seed: "sim-seed" });
  const entities: Entity[] = [
    { id: "", worldId: world.id, name: "Acme Cloud", type: "org", description: "d", salience: 0.9, anchors: [], motives: [] },
    { id: "", worldId: world.id, name: "Pricing", type: "topic", description: "d", salience: 0.7, anchors: [], motives: [] },
  ].map((e) => e as Entity);
  const inserted = db.insertEntities(world.id, entities);
  const acmeId = inserted.inserted[0].id;
  const personas: Omit<Persona, "id" | "worldId" | "createdAt">[] = [];
  for (let i = 0; i < personaCount; i++) {
    personas.push({
      name: `P${i}`,
      handle: i % 2 === 0 ? `@p${i}` : `u/p${i}`,
      archetype: "casual scroller",
      bio: "bio",
      traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
      stances: { [acmeId]: i % 3 === 0 ? 0.8 : -0.6 },
      platform: i % 3 === 0 ? "twitter" : i % 3 === 1 ? "reddit" : "both",
      activity: 0.4 + (i % 3) * 0.2,
      communityIds: i % 3 === 1 ? [`c_${acmeId}`] : [],
      follows: [],
    });
  }
  const saved = db.insertPersonas(world.id, personas);
  db.setStage(world.id, "populated");
  db.updateWorld(world.id, { config: { ...world.config, rounds: 2 } });
  db.setStage(world.id, "configured");
  return { db, world: db.getWorld(world.id)!, personas: saved };
}

describe("activation", () => {
  it("is deterministic and bounded", () => {
    const { db, world, personas } = fixture(10);
    const posts = db.listPosts(world.id, { limit: 1000 });
    const a1 = activatePersonas(world, personas, posts, 1, 20);
    const a2 = activatePersonas(world, personas, posts, 1, 20);
    expect(a1).toEqual(a2);
    expect(a1.length).toBeGreaterThanOrEqual(1);
    expect(a1.length).toBeLessThanOrEqual(20);
    db.close();
  });
});

describe("platform scoring", () => {
  const base = { metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 }, mentions: [] };
  it("twitter: recency + engagement rank", () => {
    const viewer = { follows: ["p_2"], stances: {} } as unknown as Persona;
    const old = { ...base, id: "po_1", round: 1, personaId: "p_9" } as unknown as Post;
    const fresh = { ...base, id: "po_2", round: 3, personaId: "p_2" } as unknown as Post;
    const viral = { ...base, id: "po_3", round: 1, personaId: "p_9", metrics: { likes: 50, reposts: 30, upvotes: 0, downvotes: 0, impressions: 0 }, mentions: [] } as unknown as Post;
    const scores = [old, fresh, viral].map((p) => twitterScore(p, viewer, 4, new Set(["po_3"]), []));
    expect(scores[1]).toBeGreaterThan(scores[0]); // followed + fresh beats old unfollowed
    expect(scores[2]).toBeGreaterThan(scores[0]); // viral beats old
  });
  it("reddit: vote gravity decays with age", () => {
    const oldHot = { ...base, id: "po_1", round: 1, metrics: { likes: 0, reposts: 0, upvotes: 8, downvotes: 0, impressions: 0 }, mentions: [] } as unknown as Post;
    const newMild = { ...base, id: "po_2", round: 3, metrics: { likes: 0, reposts: 0, upvotes: 6, downvotes: 0, impressions: 0 }, mentions: [] } as unknown as Post;
    // 6 fresh upvotes (7/3^1.5 ≈ 1.35) outrank 8 stale ones (9/5^1.5 ≈ 0.80)
    expect(redditScore(newMild, 4, 1.5)).toBeGreaterThan(redditScore(oldHot, 4, 1.5));
  });
});

describe("persona card budget", () => {
  it("fits in 120 tokens", () => {
    const { db, world, personas } = fixture(8);
    const entities = db.listEntities(world.id);
    for (const p of personas) {
      const card = personaCard(p, entities, world.config);
      expect(card.tokens).toBeLessThanOrEqual(world.config.batch.personaCardTokens);
    }
    db.close();
  });
});

describe("submit validation + surgical retry", () => {
  it("holds the round on invalid items, then advances on the corrected resubmit", () => {
    const { db, world } = fixture(6);
    const { task } = buildSimBatch(db, world);
    expect(task.kind).toBe("sim");
    expect(task.items.length).toBeGreaterThanOrEqual(1);
    const activated = task.items.map((i) => String((i.payload as { persona?: { id: string } }).persona?.id ?? ""));
    const twitterish = activated.map((id) => db.getPersona(world.id, id)!).find((p) => p.platform !== "reddit")!;

    // bad: oversized body for a twitter-capable activated persona
    const bad: SimGeneration[] = [{ persona: twitterish.id, actions: [{ type: "post", body: "x".repeat(400) }] }];
    const r1 = submitGenerations(db, world, task.id, bad);
    expect(r1.advanced).toBe(false);
    expect(r1.rejected.length).toBeGreaterThanOrEqual(1);
    expect(r1.rejected.some((r) => r.message.includes("max 280"))).toBe(true);

    // everyone else lurks (valid empty actions) — excluding the persona with the pending rejection
    const lurks: SimGeneration[] = activated.filter((id) => id !== twitterish.id).map((id) => ({ persona: id, actions: [] }));
    const r2 = submitGenerations(db, world, task.id, lurks);
    expect(r2.advanced).toBe(false); // still held because r1's rejection is unfixed

    // corrected resubmit for the rejected persona → all accounted → advance
    const fixed: SimGeneration[] = [{ persona: twitterish.id, actions: [{ type: "post", body: "Acme Cloud pricing is a ripoff" }] }];
    const r3 = submitGenerations(db, world, task.id, fixed);
    expect(r3.advanced).toBe(true);
    expect(r3.round).toBe(1);
    expect(r3.postsCreated).toBeGreaterThanOrEqual(1);
    expect(db.getWorld(world.id)!.round).toBe(1);

    // posts now exist and carry entity mentions + sentiment
    const posts = db.listPosts(world.id, { minRound: 1, maxRound: 1 });
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0].mentions.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("finalize forces the round forward (missing personas lurk)", () => {
    const { db, world } = fixture(6);
    const { task } = buildSimBatch(db, world);
    const activated = task.items.map((i) => String((i.payload as { persona?: { id: string } }).persona?.id ?? ""));
    const bad: SimGeneration[] = [{ persona: activated[0], actions: [{ type: "reply", parent: "po_999", body: "orphan reply" }] }];
    const r = submitGenerations(db, world, task.id, bad, { finalize: true });
    expect(r.advanced).toBe(true);
    expect(r.rejected.length).toBe(1);
    expect(r.lurkers.length).toBeGreaterThanOrEqual(activated.length - 1);
    db.close();
  });

  it("rejects wrong-platform actions and unknown personas", () => {
    const { db, world } = fixture(6);
    const { task } = buildSimBatch(db, world);
    const activated = task.items.map((i) => String((i.payload as { persona?: { id: string } }).persona?.id ?? ""));
    const twitterOnly = db.getPersona(world.id, activated.find((id) => db.getPersona(world.id, id)?.platform === "twitter") || activated[0])!;
    const subs: SimGeneration[] = [
      { persona: "p_999", actions: [] },
      { persona: twitterOnly.id, actions: [{ type: "comment", parent: "po_1", body: "reddit action on twitter persona" }] },
    ];
    const r = submitGenerations(db, world, task.id, subs);
    expect(r.advanced).toBe(false);
    expect(r.rejected.length).toBeGreaterThanOrEqual(2);
    db.close();
  });
});
