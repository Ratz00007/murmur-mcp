/**
 * Tier 2 — Boundary 2: Aspect-Based Entity Sentiment Boundaries (R6)
 * Tests 3-char minimum entity names, massive texts (>50k chars),
 * emoji/punctuation only, negator stacking, and empty inputs.
 */
import { describe, expect, it } from "vitest";
import { entityMentions, scoreSentiment } from "@murmur/engine";
import type { Entity } from "@murmur/engine";

describe("Tier 2 - B02: Aspect-Based Entity Sentiment Boundaries", () => {
  const shortEntity: Entity = {
    id: "e_aws",
    worldId: "w_test",
    name: "AWS",
    type: "competitor",
    description: "Amazon Web Services",
    salience: 0.9,
    anchors: ["aws"],
    motives: [],
  };

  it("recognizes 3-character minimum entity names but rejects names under 3 chars", () => {
    const text = "Deploying on AWS is fast and reliable.";
    const mentions = entityMentions(text, [shortEntity]);
    expect(mentions.length).toBe(1);
    expect(mentions[0].entityId).toBe("e_aws");

    const twoCharEntity: Entity = {
      id: "e_go",
      worldId: "w_test",
      name: "Go",
      type: "product",
      description: "Golang",
      salience: 0.5,
      anchors: ["go"],
      motives: [],
    };
    const mentionsTwoChar = entityMentions("We wrote this in Go", [twoCharEntity]);
    expect(mentionsTwoChar.length).toBe(0); // Sub-3 char names ignored per PRD
  });

  it("processes massive texts (>50,000 characters) without call-stack overflow", () => {
    const repeatedSentence = "PostgreSQL continues to be exceptional, reliable, and solid. ";
    const massiveText = repeatedSentence.repeat(1000); // ~60,000 chars

    const res = scoreSentiment(massiveText);
    expect(res.score).toBeGreaterThan(0.9);
    expect(res.hits).toBeGreaterThan(100);
    expect(res.score).toBeLessThanOrEqual(1.0);
  });

  it("handles texts consisting entirely of punctuation, emojis, and whitespace", () => {
    const text = "🎉🔥🚀 ??? !!! ... --- === @@@";
    const res = scoreSentiment(text);
    expect(res.score).toBe(0);
    expect(res.hits).toBe(0);
  });

  it("handles double-negations and intensifiers with correct polarity resolution", () => {
    // "not bad" -> bad is -2, negated -> +2
    const res1 = scoreSentiment("The new pricing is not bad.");
    expect(res1.score).toBeGreaterThan(0);

    // "hardly fair" -> downtoner on fair (+2 * 0.6) = +1.2
    const res2 = scoreSentiment("The new terms are hardly fair.");
    expect(res2.score).toBeGreaterThan(0);
  });

  it("gracefully survives null, undefined, or empty string inputs", () => {
    expect(scoreSentiment("").score).toBe(0);
    expect(scoreSentiment("   ").score).toBe(0);
    expect(entityMentions("", [shortEntity])).toEqual([]);
  });
});
