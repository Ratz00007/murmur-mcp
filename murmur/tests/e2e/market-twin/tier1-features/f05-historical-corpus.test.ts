/**
 * Tier 1 — Feature 5: Canonical Historical Backlash Corpus (Unity, Docker, Redis/HashiCorp) (R1)
 * Validates canonical historical cases, objection categories, severity scores,
 * stage timelines, and competitor migration ground truths.
 */
import { describe, expect, it } from "vitest";
import { validateHistoricalBacklashCase } from "../helpers/contracts.js";
import {
  DOCKER_HUB_2023_CASE,
  HASHICORP_2023_CASE,
  REDIS_2024_CASE,
  UNITY_2023_CASE,
} from "../helpers/fixtures.js";

describe("Tier 1 - F05: Canonical Historical Backlash Corpus", () => {
  it("validates Unity 2023 Runtime Fee case and high-severity objections", () => {
    const c = validateHistoricalBacklashCase(UNITY_2023_CASE);
    expect(c.vendor).toBe("Unity Technologies");
    expect(c.announcementDate).toBe("2023-09-12");

    const highSeverity = c.objections.filter((o) => o.severity >= 9);
    expect(highSeverity.length).toBeGreaterThanOrEqual(2);
    expect(highSeverity.some((o) => o.category === "legal_retroactivity")).toBe(true);

    const godot = c.churnImpact.primaryMigrationDestinations.find(
      (d) => d.competitor === "Godot Engine",
    );
    expect(godot).toBeDefined();
    expect(godot!.inflowShare).toBeGreaterThanOrEqual(0.6);
  });

  it("validates Docker Hub 2023 Free Team Deprecation case and rollback timeline", () => {
    const c = validateHistoricalBacklashCase(DOCKER_HUB_2023_CASE);
    expect(c.vendor).toBe("Docker, Inc.");

    const walkback = c.timeline.find((t) => t.stage === "walkback");
    expect(walkback).toBeDefined();
    expect(walkback!.sentimentScore).toBeGreaterThan(0.0); // Recovered after rollback

    const ghcr = c.churnImpact.primaryMigrationDestinations.find((d) =>
      d.competitor.includes("GitHub Packages"),
    );
    expect(ghcr).toBeDefined();
    expect(ghcr!.inflowShare).toBeGreaterThan(0.5);
  });

  it("validates Redis 2024 RSALv2 / SSPL License Pivot and Valkey fork launch", () => {
    const c = validateHistoricalBacklashCase(REDIS_2024_CASE);
    expect(c.vendor).toBe("Redis Ltd.");
    expect(c.churnImpact.estimatedARRChurnPercent).toBeGreaterThan(20);

    const valkey = c.churnImpact.primaryMigrationDestinations.find((d) =>
      d.competitor.includes("Valkey"),
    );
    expect(valkey).toBeDefined();
    expect(valkey!.inflowShare).toBeGreaterThan(0.7);
  });

  it("validates HashiCorp 2023 BSL Shift and OpenTofu migration", () => {
    const c = validateHistoricalBacklashCase(HASHICORP_2023_CASE);
    expect(c.vendor).toBe("HashiCorp, Inc.");
    expect(c.objections.some((o) => o.category === "ecosystem_splintering")).toBe(true);

    const tofu = c.churnImpact.primaryMigrationDestinations.find((d) =>
      d.competitor === "OpenTofu",
    );
    expect(tofu).toBeDefined();
    expect(tofu!.inflowShare).toBeGreaterThan(0.6);
  });

  it("verifies chronologically ordered timelines across all canonical cases", () => {
    const cases = [UNITY_2023_CASE, DOCKER_HUB_2023_CASE, REDIS_2024_CASE, HASHICORP_2023_CASE];
    for (const c of cases) {
      for (let i = 1; i < c.timeline.length; i++) {
        expect(c.timeline[i].daysAfterT0).toBeGreaterThanOrEqual(
          c.timeline[i - 1].daysAfterT0,
        );
      }
    }
  });

  it("rejects invalid cases missing required objection structures", () => {
    expect(() =>
      validateHistoricalBacklashCase({
        id: "invalid_case",
        title: "Test",
        vendor: "Test Vendor",
        announcementDate: "2024-01-01",
        policySummary: "Summary",
        objections: [], // Empty objections
        timeline: [{ stage: "announcement", daysAfterT0: 0, headline: "H", sentimentScore: 0 }],
        churnImpact: { estimatedARRChurnPercent: 10, primaryMigrationDestinations: [] },
      }),
    ).toThrow("Must have objections");
  });
});
