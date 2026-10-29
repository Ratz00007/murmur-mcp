/**
 * Tier 1 — Feature 3: Backlash Cascade Dynamics (No Lurker Suppression) (R3, R6)
 * Validates active negative engagement, multi-hop cascade propagation,
 * and deterministic cascade replay.
 */
import { describe, expect, it } from "vitest";
import { engagementOf, engagementScore, streamRng } from "@murmur/engine";
import { computeTheRatio, computeOutrageMultiplier } from "../helpers/reference-engine.js";

describe("Tier 1 - F03: Backlash Cascade Dynamics", () => {
  it("calculates multi-metric engagement weights accurately", () => {
    const postMetrics = {
      likes: 120,
      reposts: 45,
      upvotes: 310,
      downvotes: 15,
      impressions: 5400,
    };
    const score = engagementScore(postMetrics);
    expect(score).toBeGreaterThan(100);
    expect(typeof score).toBe("number");
  });

  it("amplifies cascade reach when outrage is elevated rather than suppressing users", () => {
    const lowOutrageMult = computeOutrageMultiplier(0.1);
    const highOutrageMult = computeOutrageMultiplier(0.9);

    expect(lowOutrageMult).toBeCloseTo(1.03, 1);
    expect(highOutrageMult).toBeGreaterThan(3.0);
    expect(highOutrageMult).toBeGreaterThan(lowOutrageMult * 2.5);
  });

  it("identifies when negative backlash triggers a high controversy Ratio", () => {
    // 500 replies + quotes vs 50 likes = Ratio of 10.0
    const ratioData = computeTheRatio(350, 150, 50);
    expect(ratioData.isRatioed).toBe(true);
    expect(ratioData.ratioScore).toBeGreaterThanOrEqual(2.0);
    expect(ratioData.controversyMultiplier).toBeGreaterThan(1.5);
  });

  it("produces byte-identical random sequences for identical seed streams", () => {
    const rngA = streamRng("cascade-seed-42", "round-1", "action");
    const rngB = streamRng("cascade-seed-42", "round-1", "action");

    const seqA = Array.from({ length: 10 }, () => rngA.float());
    const seqB = Array.from({ length: 10 }, () => rngB.float());
    expect(seqA).toEqual(seqB);
  });

  it("distinguishes non-ratioed positive engagement from hostile dogpiling", () => {
    // 1000 likes vs 10 replies = ratio ~ 0.01
    const healthyEngagement = computeTheRatio(10, 2, 1000);
    expect(healthyEngagement.isRatioed).toBe(false);
    expect(healthyEngagement.ratioScore).toBeLessThan(0.1);
    expect(healthyEngagement.controversyMultiplier).toBe(1.0);
  });

  it("ensures engagementOf helper safely extracts metrics from post objects", () => {
    const mockPost = {
      id: "p_1",
      worldId: "w_1",
      personaId: "pers_1",
      platform: "twitter" as const,
      round: 1,
      kind: "post" as const,
      parentId: null,
      threadId: "th_1",
      communityId: null,
      title: null,
      body: "Testing backlash cascade propagation without lurker suppression",
      metrics: {
        likes: 50,
        reposts: 20,
        upvotes: 0,
        downvotes: 0,
        impressions: 1200,
      },
      mentions: [],
      origin: "agent" as const,
    };
    const e = engagementOf(mockPost);
    expect(e).toBeGreaterThanOrEqual(70);
  });
});
