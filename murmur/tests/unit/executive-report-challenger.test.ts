/**
 * Adversarial Challenger Stress Testing Harness for Milestone M5:
 * Executive Decision Intelligence, Financial Math, and MCP Tool Integration.
 *
 * Verifies:
 * - Feature 12: Executive Churn ARR Risk Projections (Logistic Hazard Model & Net Waterfall)
 * - Feature 13: Competitor Migration Inflow Maps (Multinomial Logit Choice Model)
 * - Feature 14: Media & Press Headline Predictor (4-Tier Press Lifecycle Simulator)
 * - Feature 15: Automated "Vaccine" Copy Rewriter (3 Strategic Counter-Proposals, >=80% revenue preserved)
 * - Complete Executive Decision Report Builder (Cleanroom SVG & HTML compliance)
 * - MCP Tool `report` Integration (Token envelope discipline <= 12,000 tokens)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeExecutiveARRRisk,
  computeCompetitorMigration,
  generateVaccineRewrites,
  buildCompleteExecutiveReport,
  type ExecutiveDecisionReport,
  type ExecutiveARRRisk,
} from "@murmur/engine";
import { ServerContext } from "../../packages/server/src/session.js";
import { buildServer } from "../../packages/server/src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Milestone M5 Adversarial Challenger: Executive Reporting & Financial Math", () => {
  // =========================================================================
  // 1. computeExecutiveARRRisk: Mathematical Invariants & Edge Cases
  // =========================================================================
  describe("1. computeExecutiveARRRisk Mathematical Invariants", () => {
    it("preserves fundamental invariants across 1,000 randomized parameter configurations", () => {
      // Monte Carlo stress harness
      let seed = 42;
      const pseudoRandom = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      for (let i = 0; i < 1000; i++) {
        // Vary totalARR from $1 to $500,000,000
        const totalARR = Math.round(pseudoRandom() * 500_000_000) + 1;
        // Vary outrage in [-0.5, 1.5]
        const outrage = pseudoRandom() * 2.0 - 0.5;
        // Vary churn fraction in [-0.2, 1.2]
        const churnFraction = pseudoRandom() * 1.4 - 0.2;

        const res: ExecutiveARRRisk = computeExecutiveARRRisk(totalARR, outrage, churnFraction);

        // Invariant 1: P90 loss >= expected churn loss
        expect(res.p90CaseLoss).toBeGreaterThanOrEqual(res.expectedChurnLossARR);

        // Invariant 2: Gross ARR at risk <= total ARR
        expect(res.grossARRAtRisk).toBeLessThanOrEqual(totalARR);
        expect(res.grossARRAtRisk).toBeGreaterThanOrEqual(0);

        // Invariant 3: Base case loss <= total ARR and non-negative
        expect(res.baseCaseLoss).toBeLessThanOrEqual(totalARR);
        expect(res.baseCaseLoss).toBeGreaterThanOrEqual(0);

        // Invariant 4: Mitigated case loss <= base case loss
        expect(res.mitigatedCaseLoss).toBeLessThanOrEqual(res.baseCaseLoss);
        expect(res.mitigatedCaseLoss).toBeGreaterThanOrEqual(0);

        // Invariant 5: Net waterfall stages continuity: balance[i] === balance[i-1] + delta[i]
        const wf = res.netARRWaterfall;
        expect(wf.length).toBe(4);
        expect(wf[0].stage).toBe("Starting ARR");
        expect(wf[0].balance).toBe(totalARR);
        expect(wf[0].deltaARR).toBe(0);

        let runningBalance = wf[0].balance;
        for (let s = 1; s < wf.length; s++) {
          runningBalance += wf[s].deltaARR;
          expect(wf[s].balance).toBe(runningBalance);
        }

        // Invariant 6: Terminal net ARR balance >= 0 (going concern survival)
        const terminalBalance = wf[wf.length - 1].balance;
        expect(terminalBalance).toBeGreaterThanOrEqual(0);
      }
    });

    it("handles zero, negative, and micro ARR boundary inputs safely", () => {
      // $0 ARR
      const zero = computeExecutiveARRRisk(0, 0.8, 0.2);
      expect(zero.totalARR).toBe(0);
      expect(zero.grossARRAtRisk).toBe(0);
      expect(zero.expectedChurnLossARR).toBe(0);
      expect(zero.p90CaseLoss).toBe(0);
      expect(zero.mitigatedCaseLoss).toBe(0);
      expect(zero.netARRWaterfall.every((w) => w.balance === 0)).toBe(true);

      // Negative ARR (-$50M)
      const neg = computeExecutiveARRRisk(-50_000_000, 0.8, 0.2);
      expect(neg.totalARR).toBe(0);
      expect(neg.grossARRAtRisk).toBe(0);
      expect(neg.expectedChurnLossARR).toBe(0);
      expect(neg.netARRWaterfall.every((w) => w.balance === 0)).toBe(true);

      // Micro ARR ($1)
      const micro = computeExecutiveARRRisk(1, 0.9, 0.5);
      expect(micro.totalARR).toBe(1);
      expect(micro.grossARRAtRisk).toBeLessThanOrEqual(1);
      expect(micro.expectedChurnLossARR).toBeLessThanOrEqual(1);
      expect(micro.p90CaseLoss).toBeGreaterThanOrEqual(micro.expectedChurnLossARR);
      expect(micro.netARRWaterfall[micro.netARRWaterfall.length - 1].balance).toBeGreaterThanOrEqual(0);
    });

    it("handles massive enterprise ARR ($1B, $10B, $100B) with safe integer precision", () => {
      const tiers = [1_000_000_000, 10_000_000_000, 100_000_000_000];
      for (const arr of tiers) {
        const res = computeExecutiveARRRisk(arr, 0.85, 0.2);
        expect(res.totalARR).toBe(arr);
        expect(Number.isSafeInteger(res.grossARRAtRisk)).toBe(true);
        expect(Number.isSafeInteger(res.expectedChurnLossARR)).toBe(true);
        expect(Number.isSafeInteger(res.p90CaseLoss)).toBe(true);
        expect(Number.isSafeInteger(res.mitigatedCaseLoss)).toBe(true);
        expect(res.p90CaseLoss).toBeLessThanOrEqual(arr);
        expect(res.netARRWaterfall.every((w) => Number.isSafeInteger(w.balance))).toBe(true);
      }
    });

    it("evaluates outrage index at extreme boundaries (-100, 0.0, 1.0, 5.0, 1000.0) with mathematical monotonicity", () => {
      const arr = 10_000_000;
      const resNeg = computeExecutiveARRRisk(arr, -100, 0.1);
      const resZero = computeExecutiveARRRisk(arr, 0.0, 0.1);
      const resMid = computeExecutiveARRRisk(arr, 0.5, 0.1);
      const resOne = computeExecutiveARRRisk(arr, 1.0, 0.1);
      const resFive = computeExecutiveARRRisk(arr, 5.0, 0.1);
      const resExtreme = computeExecutiveARRRisk(arr, 1000, 0.1);

      // Hazard function is monotonically increasing with outrage
      expect(resNeg.grossARRAtRisk).toBeLessThanOrEqual(resZero.grossARRAtRisk);
      expect(resZero.grossARRAtRisk).toBeLessThanOrEqual(resMid.grossARRAtRisk);
      expect(resMid.grossARRAtRisk).toBeLessThanOrEqual(resOne.grossARRAtRisk);
      expect(resOne.grossARRAtRisk).toBeLessThanOrEqual(resFive.grossARRAtRisk);
      expect(resFive.grossARRAtRisk).toBeLessThanOrEqual(resExtreme.grossARRAtRisk);

      // Extreme values remain strictly bounded
      expect(resExtreme.grossARRAtRisk).toBeLessThanOrEqual(arr);
      expect(resNeg.grossARRAtRisk).toBeGreaterThanOrEqual(0);
    });

    it("evaluates churn fraction at boundaries (0.0, 1.0, 2.0, negative) with strict upper clamp at 100%", () => {
      const arr = 20_000_000;
      const resZeroChurn = computeExecutiveARRRisk(arr, 0.5, 0.0);
      const resFullChurn = computeExecutiveARRRisk(arr, 0.5, 1.0);
      const resOverChurn = computeExecutiveARRRisk(arr, 0.5, 2.0); // > 100%
      const resNegChurn = computeExecutiveARRRisk(arr, 0.5, -0.5); // negative

      expect(resZeroChurn.expectedChurnLossARR).toBeLessThanOrEqual(resFullChurn.expectedChurnLossARR);
      // Even if churn fraction is 2.0, loss rate must NOT exceed 100% of totalARR
      expect(resOverChurn.expectedChurnLossARR).toBe(arr);
      expect(resOverChurn.p90CaseLoss).toBe(arr); // Clamped at totalARR
      expect(resNegChurn.expectedChurnLossARR).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 2. computeCompetitorMigration: Multinomial Logit Stress Harness
  // =========================================================================
  describe("2. computeCompetitorMigration Multinomial Logit Stress Harness", () => {
    const churnARR = 15_000_000;
    const churnAccounts = 2500;

    it("handles empty competitors array safely by returning empty array", () => {
      const res = computeCompetitorMigration(churnARR, churnAccounts, []);
      expect(res).toEqual([]);
    });

    it("allocates exactly 100.0% of churn to a single dominant monopoly alternative", () => {
      const sole = [{ name: "Sole Competitor", isOSS: true, featureParity: 0.9, switchingFriction: 0.1 }];
      const res = computeCompetitorMigration(churnARR, churnAccounts, sole);
      expect(res).toHaveLength(1);
      expect(res[0].inflowSharePercent).toBe(100.0);
      expect(res[0].migratedARR).toBe(churnARR);
      expect(res[0].migratedAccounts).toBe(churnAccounts);
      expect(res[0].keyDefectionDrivers.length).toBeGreaterThanOrEqual(3);
    });

    it("splits inflow shares equally across N identical competitors (N=2, 3, 5, 10)", () => {
      const sizes = [2, 3, 5, 10];
      for (const n of sizes) {
        const comps = Array.from({ length: n }, (_, i) => ({
          name: `Clone_${i + 1}`,
          isOSS: true,
          featureParity: 0.8,
          switchingFriction: 0.3,
        }));

        const res = computeCompetitorMigration(churnARR, churnAccounts, comps);
        expect(res).toHaveLength(n);

        const expectedShare = Math.round((100.0 / n) * 10) / 10;
        for (const c of res) {
          expect(Math.abs(c.inflowSharePercent - expectedShare)).toBeLessThanOrEqual(0.2);
          expect(c.migratedARR).toBeGreaterThan(0);
          expect(c.migratedAccounts).toBeGreaterThan(0);
        }
      }
    });

    it("verifies inflow shares sum to ~100% across 500 randomized competitor market configurations", () => {
      let seed = 123;
      const pseudoRandom = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      for (let i = 0; i < 500; i++) {
        const numComps = Math.floor(pseudoRandom() * 6) + 2; // 2 to 7 competitors
        const comps = Array.from({ length: numComps }, (_, idx) => ({
          name: `Comp_${idx}`,
          isOSS: pseudoRandom() > 0.5,
          featureParity: pseudoRandom() * 1.0, // [0, 1]
          switchingFriction: pseudoRandom() * 2.0, // [0, 2]
        }));

        const res = computeCompetitorMigration(churnARR, churnAccounts, comps);
        expect(res).toHaveLength(numComps);

        const totalShare = res.reduce((sum, r) => sum + r.inflowSharePercent, 0);
        // Due to 1-decimal rounding of shares, sum should be within [99.5, 100.5]
        expect(totalShare).toBeGreaterThanOrEqual(99.0);
        expect(totalShare).toBeLessThanOrEqual(101.0);

        for (const item of res) {
          expect(item.migratedAccounts).toBeGreaterThanOrEqual(0);
          expect(item.migratedARR).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("verifies zero switching friction gives significant utility advantage", () => {
      const comps = [
        { name: "Zero Friction Drop-In", isOSS: false, featureParity: 0.8, switchingFriction: 0.0 },
        { name: "Heavy Friction Incumbent", isOSS: false, featureParity: 0.8, switchingFriction: 2.0 },
      ];
      const res = computeCompetitorMigration(churnARR, churnAccounts, comps);
      const zeroFriction = res.find((c) => c.competitor === "Zero Friction Drop-In")!;
      const heavyFriction = res.find((c) => c.competitor === "Heavy Friction Incumbent")!;

      expect(zeroFriction.inflowSharePercent).toBeGreaterThan(heavyFriction.inflowSharePercent * 5);
    });

    it("probes numerical boundaries: zero churn ARR and zero accounts", () => {
      const comps = [
        { name: "Comp A", isOSS: true, featureParity: 0.9, switchingFriction: 0.1 },
        { name: "Comp B", isOSS: false, featureParity: 0.7, switchingFriction: 0.5 },
      ];
      const res = computeCompetitorMigration(0, 0, comps);
      expect(res.every((c) => c.migratedARR === 0)).toBe(true);
      expect(res.every((c) => c.migratedAccounts === 0)).toBe(true);
    });
  });

  // =========================================================================
  // 3. generateVaccineRewrites: Strategic Counter-Proposal Revenue Preservation
  // =========================================================================
  describe("3. generateVaccineRewrites Revenue & Counter-Proposal Invariants", () => {
    it("guarantees all 3 rewrites preserve >= 80% revenue across variable target ARR ($0, $100k, $1M, $100M, $1B)", () => {
      const testRevenues = [0, 100_000, 1_000_000, 100_000_000, 1_000_000_000, -500_000];

      for (const rev of testRevenues) {
        const rewrites = generateVaccineRewrites("PlatformVendor", rev);
        expect(rewrites).toHaveLength(3);

        const strategies = rewrites.map((r) => r.strategy);
        expect(strategies).toEqual([
          "grandfathering_shield",
          "transparent_unit_cost",
          "safe_harbor_free_tier",
        ]);

        for (const rw of rewrites) {
          // Mandatory Requirement: preserved revenue >= 80%
          expect(rw.preservedRevenuePercent).toBeGreaterThanOrEqual(80);
          expect(rw.preservedRevenuePercent).toBeLessThanOrEqual(100);

          // Positive sentiment recovery
          expect(rw.projectedSentimentRecovery).toBeGreaterThanOrEqual(0.0);
          expect(rw.projectedSentimentRecovery).toBeLessThanOrEqual(1.0);

          // Substantial non-empty copy
          expect(rw.revisedCopy.length).toBeGreaterThan(50);
          expect(rw.neutralizedObjections.length).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it("verifies dynamic threshold notice adapts cleanly to target ARR", () => {
      const rwZero = generateVaccineRewrites("Vendor", 0);
      const transparentZero = rwZero.find((r) => r.strategy === "transparent_unit_cost")!;
      expect(transparentZero.revisedCopy).toContain("$200k/yr");

      const rwOneMillion = generateVaccineRewrites("Vendor", 1_000_000);
      const transparentOneM = rwOneMillion.find((r) => r.strategy === "transparent_unit_cost")!;
      expect(transparentOneM.revisedCopy).toContain("$10,000/yr");

      const rwHundredMillion = generateVaccineRewrites("Vendor", 100_000_000);
      const transparentHundredM = rwHundredMillion.find((r) => r.strategy === "transparent_unit_cost")!;
      // Capped at $200,000/yr
      expect(transparentHundredM.revisedCopy).toContain("$200,000/yr");
    });

    it("handles empty or falsy vendor strings gracefully with fallback", () => {
      const rwEmpty = generateVaccineRewrites("", 10_000_000);
      expect(rwEmpty[0].revisedCopy).toContain("Our Platform");
    });
  });

  // =========================================================================
  // 4. buildCompleteExecutiveReport: Cleanroom SVG & HTML Compliance
  // =========================================================================
  describe("4. buildCompleteExecutiveReport Cleanroom SVG & HTML Compliance", () => {
    it("assembles complete report and enforces strict Cleanroom compliance (ZERO external URLs/xmlns)", () => {
      const report: ExecutiveDecisionReport = buildCompleteExecutiveReport({
        vendor: "EnterprisePlatform",
        topic: "per-seat to telemetry-based consumption pricing transition",
        totalARR: 80_000_000,
        macroOutrage: 0.78,
        churnFraction: 0.22,
        competitors: [
          { name: "OSS Alternative", isOSS: true, featureParity: 0.85, switchingFriction: 0.25 },
          { name: "Proprietary Competitor", isOSS: false, featureParity: 0.95, switchingFriction: 0.6 },
        ],
      });

      // Verification of nested structures
      expect(report.arrRisk.totalARR).toBe(80_000_000);
      expect(report.arrRisk.expectedChurnLossARR).toBeGreaterThan(0);
      expect(report.competitorMigration).toHaveLength(2);
      expect(report.mediaHeadlines).toHaveLength(4);
      expect(report.vaccineRewrites).toHaveLength(3);

      const html = report.renderedHtmlDashboard;

      // 1. Valid HTML5 Doctype & basic tags
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html lang=\"en\">");
      expect(html).toContain("</html>");

      // 2. Inline SVG presence
      expect(html).toContain("<svg");
      expect(html).toContain("</svg>");
      expect(html).toContain("viewBox=\"0 0 640 240\"");

      // 3. Strict Cleanroom Requirement:
      // ZERO external HTTP or HTTPS URLs (no CDNs, no web fonts, no external tracking, no external namespaces)
      const httpMatches = html.match(/https?:\/\//g);
      expect(httpMatches).toBeNull();

      // Zero external xmlns references (e.g. xmlns="http://www.w3.org/2000/svg" violates cleanroom regex)
      expect(html).not.toContain("xmlns=");

      // 4. Required dashboard sections present
      expect(html).toContain("id=\"arr-risk\"");
      expect(html).toContain("id=\"migration-map\"");
      expect(html).toContain("id=\"media-headlines\"");
      expect(html).toContain("id=\"vaccine-rewrites\"");
    });

    it("survives extreme parameters ($0 ARR, 1.0 outrage, 0 competitors) with valid SVG render", () => {
      const report = buildCompleteExecutiveReport({
        vendor: "ZeroARR Startup",
        topic: "free tier shutdown",
        totalARR: 0,
        macroOutrage: 1.0,
        churnFraction: 0.9,
        competitors: [],
      });

      expect(report.arrRisk.totalARR).toBe(0);
      expect(report.competitorMigration).toEqual([]);
      expect(report.renderedHtmlDashboard).toContain("<svg");
      expect(report.renderedHtmlDashboard).not.toMatch(/https?:\/\//);
    });
  });

  // =========================================================================
  // 5. MCP Tool `report`: Token Envelope & Tool Integration Stress
  // =========================================================================
  describe("5. MCP Tool `report` Token Envelope & Integration Stress", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-m5-challenger-"));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // cleanup
      }
    });

    it("verifies report tool registration and schema properties", async () => {
      const ctx = new ServerContext(tmpDir);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "m5-challenger-client", version: "1.0.0" });
      await buildServer(ctx).connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const reportTool = tools.find((t) => t.name === "report");
      expect(reportTool).toBeDefined();
      expect(reportTool?.description).toContain("Stage 6 of the pipeline");
      expect(reportTool?.inputSchema).toBeDefined();

      await client.close();
      ctx.close();
    });

    it("executes report action:'plan' with mode:'executive' and verifies token envelope <= 12,000 tokens", async () => {
      const ctx = new ServerContext(tmpDir);
      const w = ctx.storage.createWorld({ name: "Acme Corp Cloud", description: "Pricing update" });
      ctx.activeWorldId = w.id;

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "m5-challenger-client", version: "1.0.0" });
      await buildServer(ctx).connect(serverTransport);
      await client.connect(clientTransport);

      const result = (await client.callTool({
        name: "report",
        arguments: {
          action: "plan",
          mode: "executive",
          total_arr: 60_000_000,
          focus: "Migration to per-seat monthly billing",
        },
      })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };

      expect(result.isError).toBeFalsy();
      const contentText = result.content?.[0]?.text ?? "";
      expect(contentText).toContain("taskId");
      expect(contentText).toContain("Adversarial War Room completed");

      // Verify token envelope: 12,000 tokens ≈ 48,000 chars
      const charCount = contentText.length;
      const estimatedTokens = Math.ceil(charCount / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(12_000);
      expect(estimatedTokens).toBeLessThan(1_500);

      await client.close();
      ctx.close();
    });

    it("stress tests large input payloads to verify token envelope remains <= 12,000 tokens", async () => {
      const ctx = new ServerContext(tmpDir);
      const w = ctx.storage.createWorld({ name: "MegaCorp", description: "Massive pricing overhaul" });
      ctx.activeWorldId = w.id;

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "m5-challenger-client", version: "1.0.0" });
      await buildServer(ctx).connect(serverTransport);
      await client.connect(clientTransport);

      // Generate 25 competitor alternatives and the largest LEGAL focus string.
      // `focus` is contract-capped at 200 chars (report.ts:213); passing more is
      // a protocol violation rather than a stress case, and is asserted below.
      const largeCompetitors = Array.from({ length: 25 }, (_, idx) => ({
        name: `Competitor Alternative Enterprise System ${idx + 1}`,
        isOSS: idx % 2 === 0,
        featureParity: 0.7 + (idx % 30) / 100,
        switchingFriction: 0.2 + (idx % 40) / 100,
      }));

      const largeFocus = "Evaluating massive enterprise cloud pricing shift with telemetry meters. "
        .repeat(3)
        .slice(0, 200);
      expect(largeFocus).toHaveLength(200);

      const result = (await client.callTool({
        name: "report",
        arguments: {
          action: "plan",
          mode: "executive",
          total_arr: 150_000_000,
          focus: largeFocus,
          competitors: largeCompetitors,
        },
      })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };

      expect(result.isError).toBeFalsy();
      const text = result.content?.[0]?.text ?? "";
      const estimatedTokens = Math.ceil(text.length / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(12_000);

      // The cap must reject, not silently truncate: a truncated focus would make
      // the report describe a different scenario than the caller asked for.
      const tooLong = (await client.callTool({
        name: "report",
        arguments: {
          action: "plan",
          mode: "executive",
          focus: "x".repeat(201),
        },
      })) as { isError?: boolean };
      expect(tooLong.isError).toBe(true);

      await client.close();
      ctx.close();
    });

    it("executes report action:'export' with mode:'executive' and verifies disk artifacts and token discipline", async () => {
      const ctx = new ServerContext(tmpDir);
      const w = ctx.storage.createWorld({ name: "CloudScale", description: "Governance restructuring" });
      ctx.activeWorldId = w.id;

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "m5-challenger-client", version: "1.0.0" });
      await buildServer(ctx).connect(serverTransport);
      await client.connect(clientTransport);

      const exportResult = (await client.callTool({
        name: "report",
        arguments: {
          action: "export",
          mode: "executive",
          total_arr: 40_000_000,
        },
      })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };

      expect(exportResult.isError).toBeFalsy();
      const text = exportResult.content?.[0]?.text ?? "";
      const parsed = JSON.parse(text);

      expect(parsed.ok).toBe(true);
      expect(parsed.files).toHaveLength(2);

      // Verify files written on disk
      const htmlRel = parsed.files.find((f: any) => f.path.endsWith(".html"))?.path;
      const jsonRel = parsed.files.find((f: any) => f.path.endsWith(".json"))?.path;

      expect(htmlRel).toBeDefined();
      expect(jsonRel).toBeDefined();

      const htmlContent = fs.readFileSync(path.join(tmpDir, htmlRel), "utf8");
      const jsonContent = fs.readFileSync(path.join(tmpDir, jsonRel), "utf8");

      expect(htmlContent).toContain("<!DOCTYPE html>");
      expect(htmlContent).not.toMatch(/https?:\/\//);

      const parsedJson = JSON.parse(jsonContent);
      expect(parsedJson.arrRisk.totalARR).toBe(40_000_000);
      expect(parsedJson.vaccineRewrites).toHaveLength(3);

      // Token envelope for export response
      const exportTokens = Math.ceil(text.length / 4);
      expect(exportTokens).toBeLessThanOrEqual(12_000);

      await client.close();
      ctx.close();
    });
  });
});
