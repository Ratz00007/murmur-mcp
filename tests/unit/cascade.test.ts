/**
 * Multi-hop cascade: seeded propagation beyond the one-hop follower pass.
 * With cascade.base=1 / maxProb=1 / attenuation=1 every reached node engages
 * and propagates, so followers-of-followers must receive engagement the old
 * one-hop pass could never reach — still capped by organicCapPerPost, still
 * fully deterministic (streamRng `cascade:${round}:${postId}:${hop}` only).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Storage,
  buildSimBatch,
  openDatabase,
  streamRng,
  submitGenerations,
  DEFAULT_CONFIG,
  type Entity,
  type Persona,
  type SimGeneration,
  type World,
} from "@murmur/engine";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cascade-"));

interface RoundOutcome {
  cascaded: number;
  hopEntries: number;
  maxHop: number;
  likes: number;
  reposts: number;
  cap: number;
  authorId: string;
  dump: string;
}

function runRound(): RoundOutcome {
  const db = new Storage(openDatabase(path.join(tmp(), "murmur.db")));
  const world = db.createWorld({ name: "cascade world", seed: "cascade-42" });
  const inserted = db.insertEntities(world.id, [
    { id: "", worldId: world.id, name: "Acme Cloud", type: "org", description: "d", salience: 0.9, anchors: [], motives: [] },
  ] as Entity[]);
  const acmeId = inserted.inserted[0].id;

  const personas: Omit<Persona, "id" | "worldId" | "createdAt">[] = [];
  for (let i = 0; i < 12; i++) {
    personas.push({
      name: `P${i}`,
      handle: `@p${i}`,
      archetype: "casual scroller",
      bio: "bio",
      traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionalStability: 0.5 },
      stances: { [acmeId]: 0.7 }, // all positive-aligned → cascade engages with likes
      platform: "both",
      activity: 0.5,
      communityIds: [],
      follows: [],
    });
  }
  db.insertPersonas(world.id, personas);
  db.setStage(world.id, "populated");
  const w = db.getWorld(world.id)!;
  db.updateWorld(world.id, {
    config: {
      ...w.config,
      rounds: 1,
      engagement: { ...w.config.engagement, organicCapPerPost: 1 },
      cascade: { maxHops: 2, base: 1, factor: 0, maxProb: 1, threshold: 12, attenuation: 1 },
    },
  });
  db.setStage(world.id, "configured");
  const world2 = db.getWorld(world.id)!;

  const { task } = buildSimBatch(db, world2);
  const activated = task.items.map((i) => String((i.payload as { persona?: { id?: string } }).persona?.id ?? ""));
  expect(activated.length).toBeGreaterThanOrEqual(1);
  const author = activated[0];

  // topology: author ← {B1,B2} ← {C1..C4} ← {D1,D2} — the C tier is only
  // reachable as followers-of-followers (hop ≥ 1 of the cascade)
  const nonAuthor = db.listPersonas(world2.id).map((p) => p.id).filter((id) => id !== author);
  const B = nonAuthor.slice(0, 2);
  const C = nonAuthor.slice(2, 6);
  const D = nonAuthor.slice(6, 8);
  for (const id of B) db.patchPersona(id, { follows: [author] });
  C.forEach((id, i) => db.patchPersona(id, { follows: [B[i % 2]] }));
  D.forEach((id, i) => db.patchPersona(id, { follows: [C[i]] }));

  const subs: SimGeneration[] = activated.map((id) =>
    id === author
      ? { persona: id, actions: [{ type: "post", body: "Acme Cloud pricing is fair and square" }] }
      : { persona: id, actions: [] }
  );
  const result = submitGenerations(db, db.getWorld(world2.id)!, task.id, subs);
  expect(result.rejected).toEqual([]);
  expect(result.advanced).toBe(true);

  // organic event payload carries the cascade receipt
  const ev = db.listEvents(world2.id, { type: "organic" }).find((e) => e.round === 1);
  expect(ev, "organic event must exist").toBeTruthy();
  const payload = ev!.payload as {
    cascaded?: number;
    audit?: { hop?: number }[];
  };
  const audit = payload.audit ?? [];
  const hopEntries = audit.filter((a) => typeof a.hop === "number").length;
  const maxHop = Math.max(0, ...audit.map((a) => a.hop ?? 0));

  // replay the one-hop eligibility filter to recover the per-post cap
  // (uses the same filters the engine applies, but ONLY over generated posts:
  // organic reposts inserted mid-loop must be skipped — they are not newPosts)
  const post = db.listPosts(world2.id, { personaId: author, minRound: 1, maxRound: 1, kinds: ["post"] })[0];
  expect(post).toBeTruthy();
  const eligibilityRng = streamRng(world2.seed, `organic:1`);
  let eligibleCount = 0;
  for (const p of db.listPersonas(world2.id)) {
    if (p.id === author) continue;
    if (p.platform !== "twitter" && p.platform !== "both") continue;
    if (p.follows.includes(author)) {
      eligibleCount++;
      continue;
    }
    if (eligibilityRng.float() < 0.3) eligibleCount++;
  }
  const cfg = {
    ...DEFAULT_CONFIG.engagement,
    ...(w.config.engagement ?? {}),
    ...(world2?.config.engagement ?? {}),
    organicCapPerPost: 1,
  } as { organicCapPerPost: number };
  const cap = Math.max(2, Math.floor(eligibleCount * cfg.organicCapPerPost));

  const dump = db.dumpWorld(world2.id);
  db.close();
  return {
    cascaded: payload.cascaded ?? 0,
    hopEntries,
    maxHop,
    likes: post.metrics.likes,
    reposts: post.metrics.reposts,
    cap,
    authorId: author,
    dump,
  };
}

describe("multi-hop cascade", () => {
  it("engages followers-of-followers beyond the one-hop pass, within the organic cap", () => {
    const r = runRound();
    expect(r.cascaded, "cascade must engage at least one distance-≥2 viewer").toBeGreaterThanOrEqual(1);
    expect(r.hopEntries, "audit must record cascade hops").toBeGreaterThanOrEqual(1);
    expect(r.maxHop).toBeGreaterThanOrEqual(1);
    expect(r.maxHop).toBeLessThanOrEqual(2); // default maxHops in this fixture
    // organicCapPerPost still bounds engagement per post (direct + cascade share
    // the engaged counter; likes/reposts only accrue on engagement)
    expect(r.likes + r.reposts).toBeLessThanOrEqual(r.cap);
  });

  it("replays byte-identically for the same seed (streamRng only)", () => {
    const a = runRound();
    const b = runRound();
    expect(a.cascaded).toBe(b.cascaded);
    expect(a.likes).toBe(b.likes);
    expect(a.reposts).toBe(b.reposts);
    expect(a.dump).toBe(b.dump);
  });
});
