import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";
import {
  CANONICAL_HISTORICAL_CASES,
  DOCKER_HUB_2023_CASE,
  getHistoricalCase,
  HASHICORP_2023_CASE,
  type HistoricalBacklashCase,
  listHistoricalCases,
  REDIS_2024_CASE,
  UNITY_2023_CASE,
  validateHistoricalBacklashCase,
} from "@murmur/engine";

describe("Historical Backlash Corpus (F05)", () => {
  describe("Canonical Cases Validation", () => {
    it("validates Unity 2023 Runtime Fee case structure", () => {
      const c = validateHistoricalBacklashCase(UNITY_2023_CASE);
      expect(c.id).toBe("unity-runtime-fee-2023");
      expect(c.vendor).toBe("Unity Technologies");
      expect(c.announcementDate).toBe("2023-09-12");

      const fatalObjections = c.objections.filter((o) => o.severity >= 9);
      expect(fatalObjections.length).toBeGreaterThanOrEqual(2);
      expect(fatalObjections.some((o) => o.category === "legal_retroactivity")).toBe(true);

      const godot = c.churnImpact.primaryMigrationDestinations.find((d) => d.competitor === "Godot Engine");
      expect(godot).toBeDefined();
      expect(godot!.inflowShare).toBeGreaterThanOrEqual(0.6);
      expect(c.timeline.length).toBe(5);
    });

    it("validates Docker Hub 2023 Free Team Deprecation case", () => {
      const c = validateHistoricalBacklashCase(DOCKER_HUB_2023_CASE);
      expect(c.id).toBe("docker-hub-free-team-2023");
      expect(c.vendor).toBe("Docker, Inc.");

      const walkback = c.timeline.find((t) => t.stage === "walkback");
      expect(walkback).toBeDefined();
      expect(walkback!.sentimentScore).toBeGreaterThan(0.0);

      const ghcr = c.churnImpact.primaryMigrationDestinations.find((d) =>
        d.competitor.includes("GitHub Packages"),
      );
      expect(ghcr).toBeDefined();
      expect(ghcr!.inflowShare).toBeGreaterThan(0.5);
    });

    it("validates Redis 2024 RSALv2/SSPL License Pivot case", () => {
      const c = validateHistoricalBacklashCase(REDIS_2024_CASE);
      expect(c.id).toBe("redis-licensing-pivot-2024");
      expect(c.vendor).toBe("Redis Ltd.");
      expect(c.churnImpact.estimatedARRChurnPercent).toBeGreaterThan(20);

      const valkey = c.churnImpact.primaryMigrationDestinations.find((d) => d.competitor.includes("Valkey"));
      expect(valkey).toBeDefined();
      expect(valkey!.inflowShare).toBeGreaterThan(0.7);
    });

    it("validates HashiCorp 2023 BSL License Shift case", () => {
      const c = validateHistoricalBacklashCase(HASHICORP_2023_CASE);
      expect(c.id).toBe("hashicorp-bsl-2023");
      expect(c.vendor).toBe("HashiCorp, Inc.");
      expect(c.objections.some((o) => o.category === "ecosystem_splintering")).toBe(true);

      const tofu = c.churnImpact.primaryMigrationDestinations.find((d) => d.competitor === "OpenTofu");
      expect(tofu).toBeDefined();
      expect(tofu!.inflowShare).toBeGreaterThan(0.6);
    });

    it("confirms chronological ordering of all timeline stages across canonical cases", () => {
      const cases = [UNITY_2023_CASE, DOCKER_HUB_2023_CASE, REDIS_2024_CASE, HASHICORP_2023_CASE];
      for (const c of cases) {
        for (let i = 1; i < c.timeline.length; i++) {
          expect(c.timeline[i].daysAfterT0).toBeGreaterThanOrEqual(c.timeline[i - 1].daysAfterT0);
        }
      }
    });
  });

  describe("Corpus Lookup and Listing Helpers", () => {
    it("lists all four canonical cases", () => {
      const cases = listHistoricalCases();
      expect(cases.length).toBe(4);
      expect(cases).toEqual(expect.arrayContaining([...CANONICAL_HISTORICAL_CASES]));
    });

    it("retrieves cases by exact ID, partial ID, vendor name, or title", () => {
      expect(getHistoricalCase("unity-runtime-fee-2023")?.id).toBe("unity-runtime-fee-2023");
      expect(getHistoricalCase("unity")?.vendor).toBe("Unity Technologies");
      expect(getHistoricalCase("docker")?.vendor).toBe("Docker, Inc.");
      expect(getHistoricalCase("redis")?.vendor).toBe("Redis Ltd.");
      expect(getHistoricalCase("hashicorp")?.vendor).toBe("HashiCorp, Inc.");
      expect(getHistoricalCase("opentofu")?.id).toBe("hashicorp-bsl-2023");
    });

    it("returns undefined for unknown cases", () => {
      expect(getHistoricalCase("unknown-case-id")).toBeUndefined();
      expect(getHistoricalCase("")).toBeUndefined();
    });
  });

  describe("validateHistoricalBacklashCase Boundary and Schema Integrity", () => {
    it("accepts cases at severity bounds 0 and 10 and sentiment bounds -1.0 and 1.0", () => {
      const boundaryCase: HistoricalBacklashCase = {
        id: "boundary-case",
        title: "Boundary Case",
        vendor: "Test Vendor",
        announcementDate: "2024-01-01",
        policySummary: "Policy summary",
        objections: [
          { category: "trivial", severity: 0, claim: "Negligible issue" },
          { category: "critical", severity: 10, claim: "Fatal issue" },
        ],
        timeline: [
          { stage: "announcement", daysAfterT0: 0, headline: "H0", sentimentScore: -1.0 },
          { stage: "aftermath", daysAfterT0: 100, headline: "H1", sentimentScore: 1.0 },
        ],
        churnImpact: {
          estimatedARRChurnPercent: 100,
          primaryMigrationDestinations: [{ competitor: "Competitor", inflowShare: 1.0 }],
        },
      };

      const validated = validateHistoricalBacklashCase(boundaryCase);
      expect(validated.objections[0].severity).toBe(0);
      expect(validated.objections[1].severity).toBe(10);
      expect(validated.timeline[0].sentimentScore).toBe(-1.0);
      expect(validated.timeline[1].sentimentScore).toBe(1.0);
    });

    it("rejects severity scores outside [0, 10]", () => {
      expect(() =>
        validateHistoricalBacklashCase({
          id: "bad_severity",
          title: "Bad Severity",
          vendor: "Vendor",
          announcementDate: "2024-01-01",
          policySummary: "Summary",
          objections: [{ category: "c", severity: 11, claim: "Too high" }],
          timeline: [{ stage: "announcement", daysAfterT0: 0, headline: "H", sentimentScore: 0 }],
          churnImpact: { estimatedARRChurnPercent: 10, primaryMigrationDestinations: [] },
        }),
      ).toThrow("Invalid severity: 11");

      expect(() =>
        validateHistoricalBacklashCase({
          id: "bad_severity_neg",
          title: "Bad Severity",
          vendor: "Vendor",
          announcementDate: "2024-01-01",
          policySummary: "Summary",
          objections: [{ category: "c", severity: -1, claim: "Negative" }],
          timeline: [{ stage: "announcement", daysAfterT0: 0, headline: "H", sentimentScore: 0 }],
          churnImpact: { estimatedARRChurnPercent: 10, primaryMigrationDestinations: [] },
        }),
      ).toThrow("Invalid severity: -1");
    });

    it("rejects sentiment scores outside [-1.0, 1.0]", () => {
      expect(() =>
        validateHistoricalBacklashCase({
          id: "bad_sentiment",
          title: "Bad Sentiment",
          vendor: "Vendor",
          announcementDate: "2024-01-01",
          policySummary: "Summary",
          objections: [{ category: "c", severity: 5, claim: "Claim" }],
          timeline: [{ stage: "announcement", daysAfterT0: 0, headline: "H", sentimentScore: 1.5 }],
          churnImpact: { estimatedARRChurnPercent: 10, primaryMigrationDestinations: [] },
        }),
      ).toThrow("Invalid sentimentScore: 1.5");
    });

    it("rejects invalid timeline stage identifiers", () => {
      expect(() =>
        validateHistoricalBacklashCase({
          id: "bad_stage",
          title: "Bad Stage",
          vendor: "Vendor",
          announcementDate: "2024-01-01",
          policySummary: "Summary",
          objections: [{ category: "c", severity: 5, claim: "Claim" }],
          timeline: [
            { stage: "riot" as unknown as "announcement", daysAfterT0: 0, headline: "H", sentimentScore: 0 },
          ],
          churnImpact: { estimatedARRChurnPercent: 10, primaryMigrationDestinations: [] },
        }),
      ).toThrow("Invalid stage: riot");
    });
  });

  describe("seed_add MCP Tool Integration (source: 'corpus')", () => {
    it("ingests canonical corpus case into world via MCP server", async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-corpus-test-"));
      fs.mkdirSync(path.join(tmpDir, ".murmur"), { recursive: true });
      const ctx = new ServerContext(tmpDir);
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({
          name: "world_init",
          arguments: { name: "Corpus World" },
        });

        const res = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "corpus",
            caseId: "unity-runtime-fee-2023",
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        expect(res.isError).toBeFalsy();
        const data = JSON.parse(res.content![0].text!);
        expect(data.ok).toBe(true);
        expect(data.seed.title).toBe("Unity 2023 Runtime Fee Backlash Replay");
        expect(data.seed.ref).toBe("corpus://unity-runtime-fee-2023");
        expect(data.duplicate).toBe(false);

        // Deduplication test
        const dupRes = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "corpus",
            caseId: "unity-runtime-fee-2023",
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        const dupData = JSON.parse(dupRes.content![0].text!);
        expect(dupData.duplicate).toBe(true);
      } finally {
        await client.close().catch(() => {});
        ctx.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects unknown caseId with helpful list of available cases", async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-corpus-err-"));
      fs.mkdirSync(path.join(tmpDir, ".murmur"), { recursive: true });
      const ctx = new ServerContext(tmpDir);
      const server = buildServer(ctx);
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);

      try {
        await client.callTool({
          name: "world_init",
          arguments: { name: "Corpus World Err" },
        });

        const res = (await client.callTool({
          name: "seed_add",
          arguments: {
            source: "corpus",
            caseId: "non-existent-case",
          },
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

        expect(res.isError).toBe(true);
        expect(res.content![0].text).toContain("unknown corpus case");
        expect(res.content![0].text).toContain("unity-runtime-fee-2023");
      } finally {
        await client.close().catch(() => {});
        ctx.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
