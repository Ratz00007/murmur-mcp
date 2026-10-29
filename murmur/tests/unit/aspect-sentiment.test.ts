import { describe, expect, it } from "vitest";
import {
  entityMentions,
  extractAspectContext,
} from "../../packages/engine/src/sentiment.js";
import type { Entity } from "@murmur/engine";

describe("Aspect-Based & Model-Assisted Sentiment", () => {
  const entities: Entity[] = [
    {
      id: "e_acme",
      worldId: "w1",
      name: "Acme Cloud",
      type: "org",
      description: "Cloud infrastructure",
      salience: 0.9,
      anchors: [],
      motives: [],
    },
    {
      id: "e_nimbus",
      worldId: "w1",
      name: "Nimbus Labs",
      type: "org",
      description: "Alternative cloud vendor",
      salience: 0.8,
      anchors: [],
      motives: [],
    },
    {
      id: "e_sol",
      worldId: "w1",
      name: "Sol Engine",
      type: "product",
      description: "Game engine",
      salience: 0.7,
      anchors: [],
      motives: [],
    },
  ];

  it("distinguishes positive mention of Entity A from negative mention of Entity B in the same sentence", () => {
    const text = "Acme Cloud is great and transparent, but Nimbus Labs is a terrible ripoff.";
    const mentions = entityMentions(text, entities);

    expect(mentions).toHaveLength(2);

    const acme = mentions.find((m) => m.entityId === "e_acme");
    const nimbus = mentions.find((m) => m.entityId === "e_nimbus");

    expect(acme).toBeDefined();
    expect(nimbus).toBeDefined();

    // Entity A must be positive based on local aspect context
    expect(acme!.score).toBeGreaterThan(0.3);
    expect(acme!.aspect).toContain("Acme Cloud is great");

    // Entity B must be negative based on local aspect context
    expect(nimbus!.score).toBeLessThan(-0.5);
    expect(nimbus!.aspect).toContain("Nimbus Labs is a terrible ripoff");
  });

  it("handles multi-sentence posts attributing distinct polarities to distinct entities", () => {
    const text =
      "I love Acme Cloud, it is reliable and fast. On the other hand, Nimbus Labs disappointed our team with broken regressions.";
    const mentions = entityMentions(text, entities);

    const acme = mentions.find((m) => m.entityId === "e_acme");
    const nimbus = mentions.find((m) => m.entityId === "e_nimbus");

    expect(acme!.score).toBeGreaterThan(0.4);
    expect(nimbus!.score).toBeLessThan(-0.3);
  });

  it("isolates neutral entity mention without leaking surrounding unrelated emotion", () => {
    const text = "I was super angry and frustrated with my commute. Acme Cloud published their weekly changelog.";
    const mentions = entityMentions(text, entities);

    const acme = mentions.find((m) => m.entityId === "e_acme");
    expect(acme).toBeDefined();
    // Acme Cloud should not be tagged with anger from the unrelated commute sentence
    expect(acme!.score).toBe(0);
  });

  it("supports fallbackToGlobal option when explicitly enabled for neutral clauses", () => {
    const text = "Awesome release today! We are testing Acme Cloud.";
    const mentionsWithoutFallback = entityMentions(text, entities, { fallbackToGlobal: false });
    const mentionsWithFallback = entityMentions(text, entities, { fallbackToGlobal: true });

    const acmeWithout = mentionsWithoutFallback.find((m) => m.entityId === "e_acme");
    const acmeWith = mentionsWithFallback.find((m) => m.entityId === "e_acme");

    expect(acmeWithout!.score).toBe(0);
    expect(acmeWith!.score).toBeGreaterThan(0);
  });

  it("extracts clean syntactic aspect context windows", () => {
    const text = "Acme Cloud is reliable and clean; Nimbus Labs has constant outages and downtime.";
    const acmeContext = extractAspectContext(text, "Acme Cloud");
    const nimbusContext = extractAspectContext(text, "Nimbus Labs");

    expect(acmeContext[0]).toContain("Acme Cloud is reliable and clean");
    expect(nimbusContext[0]).toContain("Nimbus Labs has constant outages");
  });

  it("supports model-assisted evaluation interface", () => {
    const text = "Acme Cloud changed their pricing tier structure.";
    const customEvaluator = (_rawText: string, entity: Entity, _context: string) => {
      if (entity.id === "e_acme") {
        return { score: -0.75, confidence: 0.92, aspect: "price shock" };
      }
      return 0;
    };

    const mentions = entityMentions(text, entities, { evaluator: customEvaluator });
    const acme = mentions.find((m) => m.entityId === "e_acme");

    expect(acme).toBeDefined();
    expect(acme!.score).toBe(-0.75);
    expect(acme!.aspect).toBe("price shock");
  });

  it("gracefully falls back to deterministic lexical scoring when model evaluator throws", () => {
    const text = "Acme Cloud is amazing and dependable.";
    const throwingEvaluator = () => {
      throw new Error("Model inference timeout / offline");
    };

    const mentions = entityMentions(text, entities, { evaluator: throwingEvaluator });
    const acme = mentions.find((m) => m.entityId === "e_acme");

    expect(acme).toBeDefined();
    // Falls back to lexical dictionary: "amazing and dependable" -> positive score
    expect(acme!.score).toBeGreaterThan(0.5);
  });
});
