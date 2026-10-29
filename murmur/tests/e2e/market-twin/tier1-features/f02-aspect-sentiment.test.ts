/**
 * Tier 1 — Feature 2: Aspect-Based & Model-Assisted Sentiment (R6)
 * Validates entity mentions detection, aspect sentiment attribution,
 * deterministic scoring fallback, and bounded $[-1.0, 1.0]$ ranges.
 */
import { describe, expect, it } from "vitest";
import { entityMentions, scoreSentiment } from "@murmur/engine";
import type { Entity } from "@murmur/engine";

describe("Tier 1 - F02: Aspect-Based Entity Sentiment", () => {
  const sampleEntities: Entity[] = [
    {
      id: "e_postgres",
      worldId: "w_test",
      name: "PostgreSQL",
      type: "product",
      description: "Relational database",
      salience: 0.9,
      anchors: ["postgres", "postgresql", "pg"],
      motives: ["reliability", "open-source"],
    },
    {
      id: "e_oracle",
      worldId: "w_test",
      name: "Oracle DB",
      type: "competitor",
      description: "Enterprise commercial database",
      salience: 0.8,
      anchors: ["oracle", "oracle db"],
      motives: ["commercial license", "enterprise lock-in"],
    },
    {
      id: "e_redis",
      worldId: "w_test",
      name: "Redis",
      type: "product",
      description: "In-memory datastore",
      salience: 0.85,
      anchors: ["redis"],
      motives: ["in-memory caching"],
    },
  ];

  it("accurately detects mentioned entities and attaches bounded sentiment scores", () => {
    const text = "PostgreSQL is amazing, reliable, and completely transparent!";
    const mentions = entityMentions(text, sampleEntities);

    expect(mentions.length).toBeGreaterThanOrEqual(1);
    const pgMention = mentions.find((m) => m.entityId === "e_postgres");
    expect(pgMention).toBeDefined();
    expect(pgMention!.score).toBeGreaterThan(0.5);
    expect(pgMention!.score).toBeLessThanOrEqual(1.0);
  });

  it("attaches negative sentiment to harshly criticized entities", () => {
    const text = "Oracle DB licensing is an absolute nightmare, predatory and disastrous.";
    const mentions = entityMentions(text, sampleEntities);

    const oracleMention = mentions.find((m) => m.entityId === "e_oracle");
    expect(oracleMention).toBeDefined();
    expect(oracleMention!.score).toBeLessThan(-0.5);
    expect(oracleMention!.score).toBeGreaterThanOrEqual(-1.0);
  });

  it("ignores entities not present in the discourse text", () => {
    const text = "We migrated everything to PostgreSQL last month and it just works.";
    const mentions = entityMentions(text, sampleEntities);

    expect(mentions.some((m) => m.entityId === "e_postgres")).toBe(true);
    expect(mentions.some((m) => m.entityId === "e_redis")).toBe(false);
  });

  it("scores pure neutral or empty mentions safely without throwing", () => {
    const emptyMentions = entityMentions("", sampleEntities);
    expect(emptyMentions).toEqual([]);

    const neutralScore = scoreSentiment("The server was restarted at 04:00 UTC.");
    expect(neutralScore.score).toBe(0);
    expect(neutralScore.hits).toBe(0);
  });

  it("executes deterministically, yielding identical results across repeated evaluations", () => {
    const text = "Redis switching away from BSD-3 is a disastrous betrayal of open source trust.";
    const run1 = scoreSentiment(text);
    const run2 = scoreSentiment(text);

    expect(run1.score).toBe(run2.score);
    expect(run1.hits).toBe(run2.hits);
    expect(run1.score).toBeLessThan(-0.3);
  });

  it("handles word boundaries and prevents substring false positives", () => {
    // An entity named "Red" should not trigger on "Reddit"
    const redEntity: Entity = {
      id: "e_red",
      worldId: "w_test",
      name: "Red",
      type: "product",
      description: "Red product",
      salience: 0.5,
      anchors: ["red"],
      motives: [],
    };
    const text = "Reddit users discussed the change.";
    const mentions = entityMentions(text, [redEntity]);
    expect(mentions.length).toBe(0);
  });
});
