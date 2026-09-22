/** Engine unit tests: rng determinism, text/sentiment, PDF extraction, digests, storage. */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Rng, hashString, hashHex, streamRng } from "./util/rng.js";
import { estTokens, truncate, slugify, stanceBar, splitSentences, topKeywords } from "./util/text.js";
import { scoreSentiment, entityMentions } from "./sentiment.js";
import { extractPdfText } from "./ingest/pdf.js";
import { coverageStats, makeDigest } from "./ingest/digest.js";
import { Storage, openDatabase } from "./store/storage.js";
import type { Entity } from "./types.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "murmur-engine-"));

describe("rng determinism", () => {
  it("same seed → same sequence", () => {
    const a = new Rng("world-1");
    const b = new Rng("world-1");
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });
  it("different seeds → different sequences", () => {
    const a = new Rng("world-1");
    const b = new Rng("world-2");
    expect(a.float()).not.toEqual(b.float());
  });
  it("weighted sample is deterministic and respects k", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const r1 = streamRng("s", "k").sampleWeighted(items, (x) => x, 3);
    const r2 = streamRng("s", "k").sampleWeighted(items, (x) => x, 3);
    expect(r1).toEqual(r2);
    expect(r1.length).toBe(3);
    expect(new Set(r1).size).toBe(3);
  });
  it("hash is stable", () => {
    expect(hashString("murmur")).toBe(hashString("murmur"));
    expect(hashHex("murmur")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("deterministic core contains no Math.random", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const files = [
      "util/rng.ts",
      "sim/activation.ts",
      "sim/feed.ts",
      "sim/batch.ts",
      "sim/ingest.ts",
      "aggregate.ts",
      "sentiment.ts",
      "ontology.ts",
      "graph.ts",
      "personas.ts",
      "report.ts",
      "memory.ts",
      "ingest/digest.ts",
      "ingest/pdf.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(here, f), "utf8");
      expect(src.includes("Math.random"), `${f} must not use Math.random`).toBe(false);
    }
  });
});

describe("text + tokens", () => {
  it("estTokens is ~chars/4", () => {
    expect(estTokens("abcd")).toBe(1);
    expect(estTokens("a".repeat(40))).toBe(10);
  });
  it("truncate cuts on word boundary", () => {
    const out = truncate("the quick brown fox jumps over the lazy dog", 15);
    expect(out.length).toBeLessThanOrEqual(15);
    expect(out.endsWith("…")).toBe(true);
  });
  it("slugify", () => {
    expect(slugify("Pricing Reaction 2026!")).toBe("pricing-reaction-2026");
  });
  it("stanceBar renders both directions", () => {
    expect(stanceBar(1)).toContain("█");
    expect(stanceBar(-1)).toContain("█");
    expect(stanceBar(0)).toContain("|");
  });
  it("splits sentences", () => {
    expect(splitSentences("One. Two! Three?").length).toBe(3);
  });
  it("topKeywords ranks by frequency", () => {
    const k = topKeywords("pricing pricing pricing migration api migration", 2);
    expect(k[0][0]).toBe("pricing");
  });
});

describe("sentiment", () => {
  it("scores positive and negative", () => {
    expect(scoreSentiment("I love this, it is great and amazing").score).toBeGreaterThan(0.3);
    expect(scoreSentiment("I hate this, terrible ripoff").score).toBeLessThan(-0.3);
  });
  it("negation flips", () => {
    const plain = scoreSentiment("this is good").score;
    const negated = scoreSentiment("this is not good").score;
    expect(negated).toBeLessThan(plain);
    expect(negated).toBeLessThan(0);
  });
  it("intensifiers amplify", () => {
    expect(Math.abs(scoreSentiment("very bad").score)).toBeGreaterThan(Math.abs(scoreSentiment("bad").score));
  });
  it("neutral text ~ 0", () => {
    expect(Math.abs(scoreSentiment("the meeting is on tuesday at the office").score)).toBeLessThan(0.1);
  });
  it("attributes mentions to entities", () => {
    const entities: Entity[] = [
      { id: "e_1", worldId: "w", name: "Acme Cloud", type: "org", description: "", salience: 0.9, anchors: [], motives: [] },
      { id: "e_2", worldId: "w", name: "Nimbus Labs", type: "org", description: "", salience: 0.7, anchors: [], motives: [] },
    ];
    const m = entityMentions("Acme Cloud is great but Nimbus Labs is a terrible ripoff", entities);
    const ids = m.map((x) => x.entityId);
    expect(ids).toContain("e_1");
    expect(ids).toContain("e_2");
  });
});

describe("pdf extraction", () => {
  it("extracts text from an uncompressed content stream", () => {
    const content = "BT (Pricing changes coming soon. Acme Cloud raises the Pro plan.) Tj ET\nBT (Second line here.) Tj ET";
    const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
    const out = extractPdfText(Buffer.from(pdf, "latin1"));
    expect(out.ok).toBe(true);
    expect(out.text).toContain("Pricing changes coming soon");
    expect(out.text).toContain("Second line here");
  });
  it("reports not-ok on empty garbage", () => {
    const out = extractPdfText(Buffer.from("%PDF-1.4 nope", "latin1"));
    expect(out.ok).toBe(false);
  });
});

describe("digest", () => {
  const text =
    "The pricing change affects all Pro users. Acme Cloud says the increase funds reliability work. " +
    "Nimbus Labs immediately undercut the price by thirty percent. The migration guide reads like a paywall. " +
    "Developers are confused about the timeline. The FAQ says data exports remain free forever. " +
    "Support response times will not change. The enterprise roadshow visits six cities next quarter.";
  it("is deterministic and bounded", () => {
    const a = makeDigest(text);
    const b = makeDigest(text);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(900);
  });
  it("long input is compressed, short input passes through", () => {
    expect(makeDigest(text.repeat(20), 900).length).toBeLessThanOrEqual(900);
    expect(makeDigest("short text")).toBe("short text");
  });
  it("coverage stats flag empty corpora", () => {
    const c = coverageStats([]);
    expect(c.seeds).toBe(0);
    expect(c.notes.join(" ")).toContain("No seeds");
  });
});

describe("storage", () => {
  it("round-trips worlds, seeds (dedupe), entities (skip dupes), personas, posts, events, tasks", () => {
    const dir = tmp();
    const db = new Storage(openDatabase(path.join(dir, "murmur.db")));
    const world = db.createWorld({ name: "Test World", seed: "seed-1" });
    expect(world.id).toBe("w_" + hashHex("seed-1").slice(0, 10));
    expect(db.getWorld(world.slug)?.id).toBe(world.id);

    const s1 = db.addSeed(world.id, { kind: "text", title: "t", ref: "t", text: "hello world", digest: "hello world" });
    const s2 = db.addSeed(world.id, { kind: "text", title: "t", ref: "t", text: "hello world", digest: "hello world" });
    expect(s1.seed.id).toBe(s2.seed.id);
    expect(s2.duplicate).toBe(true);

    const mk = (name: string, type: Entity["type"], salience: number): Entity => ({
      id: "", worldId: world.id, name, type, description: "d", salience, anchors: ["a"], motives: ["m"],
    });
    const { inserted, skipped } = db.insertEntities(world.id, [mk("Acme Cloud", "org", 0.9), mk("Pricing", "topic", 0.7)]);
    expect(inserted.length).toBe(2);
    expect(db.listEntities(world.id).length).toBe(2);
    const again = db.insertEntities(world.id, [mk("Acme Cloud", "org", 0.9), mk("API", "topic", 0.5)]);
    expect(again.inserted.length).toBe(1);
    expect(again.skipped).toEqual(["Acme Cloud"]);

    db.replaceRelations(world.id, [{ srcId: "e_1", dstId: "e_2", type: "opposition", weight: 0.8, tension: 0.7 }]);
    expect(db.listRelations(world.id).length).toBe(1);

    const personas = db.insertPersonas(world.id, [
      {
        name: "Ada", handle: "@ada", archetype: "power user", bio: "b",
        traits: { openness: 0.8, conscientiousness: 0.5, extraversion: 0.6, agreeableness: 0.4, emotionalStability: 0.7 },
        stances: { e_1: 0.6 }, platform: "both", activity: 0.7, communityIds: [], follows: [],
      },
    ]);
    expect(personas[0].id).toBe("p_1");
    expect(db.getPersona(world.id, "@ada")?.id).toBe("p_1");

    const post = db.insertPost({
      worldId: world.id, round: 1, personaId: "p_1", platform: "twitter", kind: "post", parentId: null,
      threadId: "", communityId: null, title: null, body: "hello", metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 2 },
      mentions: [], origin: "generated",
    });
    expect(post.id).toBe("po_1");
    expect(post.threadId).toBe("po_1");
    post.metrics.likes++;
    db.updatePostMetrics(post.id, post.metrics);
    expect(db.getPost(world.id, "po_1")?.metrics.likes).toBe(1);

    db.appendMemory(world.id, "p_1", "episodic", "event", "Posted on twitter r1", 0.4, 1);
    expect(db.countMemories(world.id, "p_1", "episodic")).toBe(1);

    db.addEvent(world.id, 1, "injection", { text: "news" }, "all");
    expect(db.listEvents(world.id, { type: "injection" }).length).toBe(1);

    const task = {
      id: "t_1", worldId: world.id, kind: "ontology" as const, round: null, instructions: "i",
      outputSchema: {}, items: [], createdAt: new Date().toISOString(),
    };
    db.saveTask(task);
    expect(db.getTask("t_1")?.id).toBe("t_1");
    db.completeTask("t_1", { x: 1 }, { taskId: "t_1", applied: ["p_1"], rejected: [] }, "submitted");
    expect(db.getTaskVerdicts("t_1")?.applied).toEqual(["p_1"]);

    // dump is stable across a reopen (timestamps normalized, content identical)
    const dump1 = db.dumpWorld(world.id);
    db.close();
    const db2 = new Storage(openDatabase(path.join(dir, "murmur.db")));
    expect(db2.dumpWorld(world.id)).toBe(dump1);
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
