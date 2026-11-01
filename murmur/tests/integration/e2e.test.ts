/**
 * End-to-end: a real MCP client (official SDK) talks to the built server over
 * stdio in a temp workspace — the same transport Claude Code, Codex, OpenCode
 * & co use. Runs the full pipeline, asserts the 11-tool contract (the 29-tool
 * surface was consolidated into action-dispatched tools), response budgets,
 * artifacts on disk, prompts, resources and session resume.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { completeOntology, completePersonas, completeReportTask, completeSim, parseToolResult } from "../helpers/mock-brain.mjs";
import { SEED_CORPUS } from "../helpers/pipeline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "..", "..", "packages", "server", "dist", "index.js");

const EXPECTED_TOOLS = new Set([
  "world_init", "world_list", "world_config",
  "seed_add", "seeds_review",
  "ontology", "graph", "personas", "sim", "report", "interact", "macro_sim",
]);

async function spawnClient(cwd: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd,
    env: { ...process.env, MURMUR_LOG: "error" } as Record<string, string>,
  });
  const client = new Client({ name: "murmur-e2e", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

function est(text: string): number {
  return Math.ceil(text.length / 4);
}

describe("MCP server end-to-end", () => {
  it("exposes the full tool/prompt contract and runs the pipeline to a report", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-e2e-"));
    fs.mkdirSync(path.join(cwd, ".murmur"));
    const { client, close } = await spawnClient(cwd);
    const maxSeen = { tokens: 0 };
    let outside = "";
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content?: { type: string; text?: string }[];
        isError?: boolean;
        structuredContent?: unknown;
      };
      const text = res.content?.find((c) => c.type === "text")?.text ?? "";
      const tokens = est(text);
      maxSeen.tokens = Math.max(maxSeen.tokens, tokens);
      expect(tokens).toBeLessThanOrEqual(12000); // NFR: resource discipline
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "ok" in parsed) {
        expect((parsed as { ok: boolean }).ok, `tool ${name} returned ok:false`).toBe(true);
      }
      return parsed as { ok: boolean; [k: string]: unknown };
    };

    try {
      // ---- contract ----
      const tools = await client.listTools();
      expect(new Set(tools.tools.map((t) => t.name))).toEqual(EXPECTED_TOOLS);
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((p) => p.name).sort()).toEqual(["murmur-interview", "murmur-predict", "murmur-resume", "murmur-simulate"]);
      const prompt = await client.getPrompt({ name: "murmur-predict", arguments: { question: "How will r/programming react?" } });
      expect(prompt.messages[0]?.content).toMatchObject({ type: "text" });

      // ---- pipeline ----
      const init = await call("world_init", { name: "pricing-reaction", description: "E2E run", seed: "e2e-seed" });
      expect(init.world.stage).toBe("created");
      expect(init.next).toBeTruthy();

      await call("seed_add", { source: "text", title: "Acme pricing brief", text: SEED_CORPUS });
      const review = await call("seeds_review");
      expect(review.coverage.seeds).toBe(1);

      // seed_add({source:"files"}) is jailed to the workspace root.
      //
      // The probe file MUST be created. The previous version referenced a path
      // that was never written, so the read failed with ENOENT and the
      // assertion passed for the wrong reason — a false positive that made an
      // unwired jail look like a working one. It also asserts the error text,
      // so a future regression cannot pass on any unrelated failure.
      outside = path.join(os.tmpdir(), `murmur-jail-probe-${randomUUID()}.txt`);
      fs.writeFileSync(outside, "SECRET-OUTSIDE-THE-WORKSPACE\n", "utf8");
      const jailed = await call("seed_add", { source: "files", paths: [outside] });
      const jailResult = (jailed.seeds as { ok: boolean; error?: string }[])[0];
      expect(jailResult.ok).toBe(false);
      expect(jailResult.error).toMatch(/outside workspace/i);

      // A symlink INSIDE the workspace pointing outside it must also be
      // refused: string containment alone would accept it.
      const symlinkProbe = path.join(cwd, "jail-symlink-probe.md");
      try {
        fs.symlinkSync(outside, symlinkProbe);
        const symlinked = await call("seed_add", { source: "files", paths: ["jail-symlink-probe.md"] });
        expect((symlinked.seeds as { ok: boolean; error?: string }[])[0].ok).toBe(false);
        expect((symlinked.seeds as { error?: string }[])[0].error).toMatch(/outside workspace/i);
      } catch (e) {
        // Windows without developer mode cannot create symlinks; the
        // containment path is still covered by the absolute-path case above.
        if (!/EPERM|EACCES|privilege/i.test(String(e))) throw e;
      }

      fs.writeFileSync(path.join(cwd, "jail-probe.md"), "# in-workspace probe\n", "utf8");
      const allowed = await call("seed_add", { source: "files", paths: ["jail-probe.md"] });
      expect((allowed.seeds as { ok: boolean }[])[0].ok).toBe(true);
      // The out-of-workspace secret must never have reached the world.
      const seeds = await call("seeds_review");
      expect(JSON.stringify(seeds)).not.toContain("SECRET-OUTSIDE-THE-WORKSPACE");

      const ontPlan = await call("ontology", { action: "plan" });
      const ontTask = ontPlan.task as { id: string };
      const ont = await call("ontology", { action: "submit", task_id: ontTask.id, result: completeOntology(ontTask) });
      expect(ont.inserted as number).toBeGreaterThanOrEqual(10);

      const graph = await call("graph", { action: "build" });
      expect(graph.relations as number).toBeGreaterThanOrEqual(1);
      const mermaid = await call("graph", { action: "export" });
      expect(fs.existsSync(path.join(cwd, String(mermaid.path)))).toBe(true);

      const pPlan = await call("personas", { action: "plan", count: 10 });
      const pTask = pPlan.task as { id: string };
      const pop = await call("personas", { action: "submit", task_id: pTask.id, result: completePersonas(pTask) });
      expect(pop.population as number).toBe(10);

      // audit one persona (F4)
      const firstPersona = String((pop.personaIds as string[])[0]);
      const inspect = await call("personas", { action: "inspect", persona: firstPersona });
      expect(inspect.card).toBeTruthy();

      await call("world_config", { rounds: 3 });

      // round 1
      let batch = await call("sim", { action: "next_batch" });
      let task = batch.task as { id: string; items: { id: string; payload: { persona: { id: string } } }[] };
      expect(batch.round as number).toBe(1);
      let sub = await call("sim", { action: "submit", task_id: task.id, generations: completeSim(task) });
      expect(sub.advanced as boolean).toBe(true);
      expect(sub.round as number).toBe(1);

      // inject before round 2 (F5)
      await call("sim", { action: "inject", text: "Acme Cloud raises the Pro plan price by 40% overnight", round: 2 });

      for (const round of [2, 3]) {
        batch = await call("sim", { action: "next_batch" });
        task = batch.task as typeof task;
        sub = await call("sim", { action: "submit", task_id: task.id, generations: completeSim(task) });
        expect(sub.round as number).toBe(round);
      }
      expect(sub.completed as boolean).toBe(true);

      const summary = await call("sim", { action: "summary", round: 3 });
      expect(summary.stats).toBeTruthy();
      const timeline = await call("sim", { action: "timeline" });
      expect((timeline.timeline as unknown[]).length).toBe(3);

      // report (F6)
      const rPlan = await call("report", { action: "plan", focus: "developer reaction to the pricing change" });
      const rTask = rPlan.task as { id: string };
      const draft = completeReportTask(rTask);
      const submitted = await call("report", { action: "submit", task_id: rTask.id, draft });
      expect(submitted.version as number).toBe(1);
      const exported = await call("report", { action: "export", format: "both" });
      const files = exported.files as { path: string; bytes: number }[];
      expect(files.length).toBe(2);
      const mdFile = path.join(cwd, files.find((f) => f.path.endsWith(".md"))!.path);
      const htmlFile = path.join(cwd, files.find((f) => f.path.endsWith(".html"))!.path);
      expect(fs.existsSync(mdFile)).toBe(true);
      expect(fs.existsSync(htmlFile)).toBe(true);
      const md = fs.readFileSync(mdFile, "utf8");
      expect(md).toContain("# Murmur Reaction Simulation Report");
      expect(md).toContain("xychart-beta");
      expect(md).toContain("## At a Glance");
      expect(md).toContain("## 9. Risk Register");
      expect(md).toContain("## 5. Faction Map");
      const html = fs.readFileSync(htmlFile, "utf8");
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("Risk Register");
      expect(html).toContain("<svg");
      expect(html).not.toMatch(/https?:\/\//);

      // deep interaction (F7)
      const interview = await call("interact", { target: "persona", persona: firstPersona, question: "Why do you feel this way about the pricing change?" });
      expect(interview.pack).toBeTruthy();
      const logged = await call("interact", {
        target: "persona",
        persona: firstPersona,
        question: "Why do you feel this way about the pricing change?",
        answer: "Because like I said in my post, the migration guide reads like a paywall.",
      });
      expect(logged.logged as boolean).toBe(true);
      const ask = await call("interact", { target: "run", question: "What is behind the biggest risk?" });
      expect((ask.pack as { evidence: unknown[] }).evidence.length).toBeGreaterThan(0);
      await call("interact", { target: "run", question: "What is behind the biggest risk?", answer: "Posts po_1 and others show backlash (strong evidence)." });

      // status receipts teach the next step
      const status = await call("world_list", { world: String(init.world.id), detail: "status" });
      expect(status.next).toBeTruthy();

      // artifacts on disk
      expect(fs.existsSync(path.join(cwd, ".murmur", "murmur.db"))).toBe(true);
      const interviewsFile = path.join(cwd, ".murmur", "pricing-reaction", "interviews.jsonl");
      expect(fs.readFileSync(interviewsFile, "utf8").trim().split("\n").length).toBe(1);

      // resources
      const res = await client.readResource({ uri: "murmur://worlds" });
      const worlds = JSON.parse(String((res.contents as { text?: string }[])[0]?.text));
      expect(worlds.worlds.length).toBe(1);

      // response budget honored across the whole session
      expect(maxSeen.tokens).toBeLessThanOrEqual(12000);

      // ---- resume in a fresh session ----
      await close();
      const second = await spawnClient(cwd);
      try {
        const text2 = await second.client.callTool({ name: "world_list", arguments: {} });
        const parsed2 = JSON.parse(String((text2.content as { text: string }[])[0]?.text));
        expect(parsed2.worlds[0].id).toBe(init.world.id);
        const opened = await second.client.callTool({ name: "world_list", arguments: { world: String(init.world.id), detail: "open" } });
        const openedParsed = JSON.parse(String((opened.content as { text: string }[])[0]?.text));
        expect(openedParsed.world.stage).toBe("reported");
        expect(openedParsed.next).toContain("interact");
      } finally {
        await second.close();
      }
    } finally {
      if (outside && fs.existsSync(outside)) {
        try {
          fs.unlinkSync(outside);
        } catch {
          /* ignore */
        }
      }
      await close().catch(() => {});
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);
});
