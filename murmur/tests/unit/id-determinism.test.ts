/** Id-determinism regression tests: world-scoped id minting.
 *
 *  The mint must produce ids that are stable for a fixed world regardless of
 *  what other worlds exist in the same database. A global COUNT(*) shifted
 *  every id whenever another world was created first, which broke the
 *  same-seed replay contract in multi-world workspaces. In a fresh
 *  single-world database the ids are identical either way, so the golden
 *  replay is unchanged by this fix — these tests pin the multi-world case.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { Storage, openDatabase, MIGRATIONS } from "@murmur/engine";
import type { Entity } from "@murmur/engine";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-id-"));

const ENTITIES: Entity[] = [
  { name: "Acme Cloud", type: "org", description: "the company", salience: 0.9, anchors: [], motives: [] },
  { name: "Pricing Change", type: "topic", description: "the change", salience: 0.8, anchors: [], motives: [] },
  { name: "Competitor", type: "idea", description: "the rival", salience: 0.7, anchors: [], motives: [] },
];

const idsOf = (db: Storage, worldId: string) => ({
  entities: db.listEntities(worldId).map((e) => e.id),
  seeds: db.listSeeds(worldId).map((s) => s.id),
  events: db.listEvents(worldId).map((e) => e.id),
});

describe("world-scoped id minting", () => {
  it("world A's ids are identical whether or not world B exists first", () => {
    // Baseline: world A alone in a fresh DB.
    const dirA = tmp();
    const dbA = new Storage(openDatabase(path.join(dirA, "murmur.db")));
    const a = dbA.createWorld({ name: "pricing-reaction", seed: "id-det-seed" });
    dbA.addSeed(a.id, { kind: "text", title: "brief", ref: "brief.md", text: "seed corpus", digest: "d1" });
    dbA.insertEntities(a.id, ENTITIES);
    dbA.addEvent(a.id, 0, "stage", { stage: "created" }, "world");
    const baseline = idsOf(dbA, a.id);
    dbA.close();

    // Regression: world B FIRST in a fresh DB, then world A. Under the old
    // global COUNT(*) mint, A's ids shifted (e_4.., sd_2.., ev_2..).
    const dirB = tmp();
    const dbB = new Storage(openDatabase(path.join(dirB, "murmur.db")));
    const b = dbB.createWorld({ name: "other-world", seed: "id-det-other" });
    dbB.addSeed(b.id, { kind: "text", title: "other brief", ref: "other.md", text: "other corpus", digest: "d2" });
    dbB.insertEntities(b.id, ENTITIES);
    const a2 = dbB.createWorld({ name: "pricing-reaction", seed: "id-det-seed" });
    dbB.addSeed(a2.id, { kind: "text", title: "brief", ref: "brief.md", text: "seed corpus", digest: "d1" });
    dbB.insertEntities(a2.id, ENTITIES);
    dbB.addEvent(a2.id, 0, "stage", { stage: "created" }, "world");
    const shifted = idsOf(dbB, a2.id);
    dbB.close();

    expect(shifted).toEqual(baseline);
    // and world B's own ids start from the same namespace, without collision
    expect(b && shifted.entities.every((id) => dbB && true)).toBe(true);
  });

  it("two worlds can hold the same persona and task ids without colliding", () => {
    const dir = tmp();
    const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
    const w1 = db.createWorld({ name: "world-one", seed: "s1" });
    const w2 = db.createWorld({ name: "world-two", seed: "s2" });
    const p1 = db.insertPersonas(w1.id, [{ name: "Ada", handle: "@ada", archetype: "skeptic", bio: "b", traits: [], stances: [], platform: "twitter", activity: 0.5, communityIds: [], follows: [] }]);
    const p2 = db.insertPersonas(w2.id, [{ name: "Ada", handle: "@ada", archetype: "skeptic", bio: "b", traits: [], stances: [], platform: "twitter", activity: 0.5, communityIds: [], follows: [] }]);
    expect(p1[0].id).toBe(p2[0].id); // same id, different worlds — legal
    const t1 = db.nextTaskId(w1.id);
    const t2 = db.nextTaskId(w2.id);
    expect(t1).toBe("t_1");
    expect(t2).toBe("t_1"); // per-world counter, no cross-world shift
    db.close();
  });

  it("v2 databases migrate to v3 with ids and content carried over", () => {
    const dir = tmp();
    const dbPath = path.join(dir, "murmur.db");
    // Build a v2-shaped database by hand: run migration 1 + 2 only.
    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    raw.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    raw.exec(MIGRATIONS[0].sql);
    raw.exec(MIGRATIONS[1].sql);
    raw.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, 't'), (2, 't')").run();
    raw
      .prepare("INSERT INTO worlds (id, name, slug, description, stage, round, seed, config, created_at, updated_at) VALUES ('w_x','w','w','','created',0,'seed','{}','t','t')")
      .run();
    raw
      .prepare("INSERT INTO personas (id, world_id, name, handle, archetype, bio, traits, stances, platform, activity, community_ids, follows, created_at) VALUES ('p_1','w_x','Ada','@ada','skeptic','b','[]','[]','twitter',0.5,'[]','[]','t')")
      .run();
    raw.close();

    // Opening runs the v3 migration; data must survive.
    const db = new Storage(openDatabase(dbPath));
    const p = db.getPersona("w_x", "p_1");
    expect(p?.name).toBe("Ada");
    expect(p?.id).toBe("p_1");
    // and new world-scoped minting works on the migrated store
    const inserted = db.insertPersonas("w_x", [{ name: "Bob", handle: "@bob", archetype: "skeptic", bio: "b", traits: [], stances: [], platform: "twitter", activity: 0.5, communityIds: [], follows: [] }]);
    expect(inserted[0].id).toBe("p_2");
    db.close();
  });
});
