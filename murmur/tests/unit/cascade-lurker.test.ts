import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Storage,
  buildSimBatch,
  openDatabase,
  submitGenerations,
  type Entity,
  type Persona,
  type SimGeneration,
} from "@murmur/engine";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-lurker-test-"));

describe("Fix Negative-Sentiment Lurker Bug", () => {
  it("enables negative-aligned personas to actively propagate cascades and voice dissent rather than lurking", () => {
    const dir = tmp();
    const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
    try {
      const world = db.createWorld({ name: "negative-cascade-world", seed: "neg-cascade-99" });
      const inserted = db.insertEntities(world.id, [
        {
          id: "",
          worldId: world.id,
          name: "Acme Cloud",
          type: "org",
          description: "Cloud vendor",
          salience: 0.9,
          anchors: [],
          motives: [],
        },
      ] as Entity[]);
      const acmeId = inserted.inserted[0].id;

      // 12 personas, all negatively aligned against Acme Cloud (stance = -0.8)
      const personas: Omit<Persona, "id" | "worldId" | "createdAt">[] = [];
      for (let i = 0; i < 12; i++) {
        personas.push({
          name: `NegPersona_${i}`,
          handle: `@neg_${i}`,
          archetype: "dev critic",
          bio: "open source advocate and cloud critic",
          traits: {
            openness: 0.5,
            conscientiousness: 0.5,
            extraversion: 0.5,
            agreeableness: 0.2, // skeptical/disagreeable
            emotionalStability: 0.4,
          },
          stances: { [acmeId]: -0.8 }, // Strongly negative-aligned!
          platform: "twitter",
          activity: 0.8,
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
          engagement: {
            ...w.config.engagement,
            organicCapPerPost: 1.0,
            organicLikeBase: 0.5, // ensure high baseline engagement probability
          },
          cascade: { maxHops: 2, base: 1.0, factor: 0, maxProb: 1.0, threshold: 12, attenuation: 1.0 },
        },
      });
      db.setStage(world.id, "configured");
      const worldConfigured = db.getWorld(world.id)!;

      const { task } = buildSimBatch(db, worldConfigured);
      const activated = task.items.map((i) => String((i.payload as { persona?: { id?: string } }).persona?.id ?? ""));
      expect(activated.length).toBeGreaterThanOrEqual(1);
      const author = activated[0];

      // Setup topology: author <- {B0, B1} <- {C0..C3}
      const nonAuthor = db
        .listPersonas(worldConfigured.id)
        .map((p) => p.id)
        .filter((id) => id !== author);
      const B = nonAuthor.slice(0, 2);
      const C = nonAuthor.slice(2, 6);

      for (const id of B) db.patchPersona(worldConfigured.id, id, { follows: [author] });
      for (const [i, id] of C.entries()) db.patchPersona(worldConfigured.id, id, { follows: [B[i % 2]] });

      // Author posts a pro-Acme post that contradicts the audience's negative stance
      const subs: SimGeneration[] = activated.map((id) =>
        id === author
          ? { persona: id, actions: [{ type: "post", body: "Acme Cloud price increases are totally justified" }] }
          : { persona: id, actions: [] }
      );

      const result = submitGenerations(db, worldConfigured, task.id, subs);
      expect(result.rejected).toEqual([]);
      expect(result.advanced).toBe(true);

      // Inspect organic event payload
      const ev = db.listEvents(worldConfigured.id, { type: "organic" }).find((e) => e.round === 1);
      expect(ev).toBeDefined();

      const payload = ev!.payload as {
        cascaded?: number;
        tally?: { likes: number; reposts: number; upvotes: number; downvotes: number };
        audit?: { post: string; viewer: string; action: string; hop?: number }[];
      };

      const audit = payload.audit ?? [];

      // Negative-aligned personas must NOT lurk silently: they must actively register actions!
      expect(audit.length).toBeGreaterThan(0);

      // Verify actions exist from negative-aligned personas
      const negativeActions = audit.filter((a) => a.action === "downvote" || a.action === "repost");
      expect(negativeActions.length).toBeGreaterThan(0);

      // Verify cascade propagation reached followers-of-followers (hop >= 1)
      const cascadeHops = audit.filter((a) => typeof a.hop === "number" && a.hop >= 1);
      expect(cascadeHops.length).toBeGreaterThan(0);
      expect(payload.cascaded).toBeGreaterThan(0);

      // Check post metrics in storage: downvotes or reposts must have accrued
      const post = db.listPosts(worldConfigured.id, { personaId: author, minRound: 1, maxRound: 1 })[0];
      expect(post).toBeDefined();
      expect(post.metrics.downvotes + post.metrics.reposts).toBeGreaterThan(0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is fully deterministic on identical seeds with negative alignment", () => {
    const runSimulation = () => {
      const dir = tmp();
      const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
      try {
        const world = db.createWorld({ name: "det-neg-world", seed: "det-neg-seed-42" });
        const inserted = db.insertEntities(world.id, [
          { id: "", worldId: world.id, name: "Acme Cloud", type: "org", description: "d", salience: 0.9, anchors: [], motives: [] },
        ] as Entity[]);
        const acmeId = inserted.inserted[0].id;

        const personas: Omit<Persona, "id" | "worldId" | "createdAt">[] = [];
        for (let i = 0; i < 8; i++) {
          personas.push({
            name: `P${i}`,
            handle: `@p${i}`,
            archetype: "critic",
            bio: "bio",
            traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.3, emotionalStability: 0.5 },
            stances: { [acmeId]: -0.7 },
            platform: "twitter",
            activity: 0.7,
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
            cascade: { maxHops: 2, base: 1, factor: 0, maxProb: 1, threshold: 12, attenuation: 1 },
          },
        });
        db.setStage(world.id, "configured");
        const worldConf = db.getWorld(world.id)!;

        const { task } = buildSimBatch(db, worldConf);
        const author = task.items[0].payload.persona as { id: string };
        const others = db.listPersonas(worldConf.id).filter((p) => p.id !== author.id);
        for (const o of others) db.patchPersona(worldConf.id, o.id, { follows: [author.id] });

        submitGenerations(db, worldConf, task.id, [
          { persona: author.id, actions: [{ type: "post", body: "Acme Cloud announcement" }] },
        ]);

        const dump = db.dumpWorld(worldConf.id);
        return dump;
      } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    const dump1 = runSimulation();
    const dump2 = runSimulation();
    expect(dump1).toBe(dump2);
  });
});
