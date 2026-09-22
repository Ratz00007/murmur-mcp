/**
 * End-to-end: a real MCP client (official SDK) talks to the built server over
 * stdio in a temp workspace — the same transport Claude Code, Codex, OpenCode
 * & co use. Runs the full pipeline, asserts the 29-tool contract, response
 * budgets, artifacts on disk, prompts, resources and session resume.
 */
import { describe, expect, it } from "vitest";
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
  "world_init", "world_list", "world_open", "world_status", "world_config",
  "seed_add_files", "seed_add_url", "seed_add_text", "seeds_review",
  "ontology_plan", "ontology_submit",
  "graph_build", "graph_query", "graph_export_mermaid",
  "personas_plan", "personas_submit", "persona_inspect", "persona_edit",
  "sim_configure", "sim_next_batch", "sim_submit_generations", "sim_inject_event", "sim_round_summary", "sim_timeline",
  "report_plan", "report_submit", "report_export",
  "interview_agent", "report_agent_ask",
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
    const { client, close } = await spawnClient(cwd);
    const maxSeen = { tokens: 0 };
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

      await call("seed_add_text", { title: "Acme pricing brief", text: SEED_CORPUS });
      const review = await call("seeds_review");
      expect(review.coverage.seeds).toBe(1);

      const ontPlan = await call("ontology_plan");
      const ontTask = ontPlan.task as { id: string };
      const ont = await call("ontology_submit", { task_id: ontTask.id, result: completeOntology(ontTask) });
      expect(ont.inserted as number).toBeGreaterThanOrEqual(10);

      const graph = await call("graph_build");
      expect(graph.relations as number).toBeGreaterThanOrEqual(1);
      const mermaid = await call("graph_export_mermaid");
      expect(fs.existsSync(path.join(cwd, String(mermaid.path)))).toBe(true);

      const pPlan = await call("personas_plan", { count: 10 });
      const pTask = pPlan.task as { id: string };
      const pop = await call("personas_submit", { task_id: pTask.id, result: completePersonas(pTask) });
      expect(pop.population as number).toBe(10);

      // audit one persona (F4)
      const firstPersona = String((pop.personaIds as string[])[0]);
      const inspect = await call("persona_inspect", { persona: firstPersona });
      expect(inspect.card).toBeTruthy();

      await call("sim_configure", { rounds: 3 });

      // round 1
      let batch = await call("sim_next_batch");
      let task = batch.task as { id: string; items: { id: string; payload: { persona: { id: string } } }[] };
      expect(batch.round as number).toBe(1);
      let sub = await call("sim_submit_generations", { task_id: task.id, generations: completeSim(task) });
      expect(sub.advanced as boolean).toBe(true);
      expect(sub.round as number).toBe(1);

      // inject before round 2 (F5)
      await call("sim_inject_event", { text: "Acme Cloud raises the Pro plan price by 40% overnight", round: 2 });

      for (const round of [2, 3]) {
        batch = await call("sim_next_batch");
        task = batch.task as typeof task;
        sub = await call("sim_submit_generations", { task_id: task.id, generations: completeSim(task) });
        expect(sub.round as number).toBe(round);
      }
      expect(sub.completed as boolean).toBe(true);

      const summary = await call("sim_round_summary", { round: 3 });
      expect(summary.stats).toBeTruthy();
      const timeline = await call("sim_timeline");
      expect((timeline.timeline as unknown[]).length).toBe(3);

      // report (F6)
      const rPlan = await call("report_plan", { focus: "developer reaction to the pricing change" });
      const rTask = rPlan.task as { id: string };
      const draft = completeReportTask(rTask);
      const submitted = await call("report_submit", { task_id: rTask.id, draft });
      expect(submitted.version as number).toBe(1);
      const exported = await call("report_export", {});
      const reportFile = path.join(cwd, String(exported.path));
      expect(fs.existsSync(reportFile)).toBe(true);
      const md = fs.readFileSync(reportFile, "utf8");
      expect(md).toContain("# Murmur Prediction Report");
      expect(md).toContain("xychart-beta");
      expect(md).toContain("## At a Glance");
      expect(md).toContain("## 9. Risk Register");
      expect(md).toContain("## 5. Faction Map");

      // deep interaction (F7)
      const interview = await call("interview_agent", { persona: firstPersona, question: "Why do you feel this way about the pricing change?" });
      expect(interview.pack).toBeTruthy();
      const logged = await call("interview_agent", {
        persona: firstPersona,
        question: "Why do you feel this way about the pricing change?",
        answer: "Because like I said in my post, the migration guide reads like a paywall.",
      });
      expect(logged.logged as boolean).toBe(true);
      const ask = await call("report_agent_ask", { question: "What is behind the biggest risk?" });
      expect((ask.pack as { evidence: unknown[] }).evidence.length).toBeGreaterThan(0);
      await call("report_agent_ask", { question: "What is behind the biggest risk?", answer: "Posts po_1 and others show backlash (strong evidence)." });

      // status receipts teach the next step
      const status = await call("world_status");
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
        const opened = await second.client.callTool({ name: "world_open", arguments: { world: String(init.world.id) } });
        const openedParsed = JSON.parse(String((opened.content as { text: string }[])[0]?.text));
        expect(openedParsed.world.stage).toBe("reported");
        expect(openedParsed.next).toContain("interview");
      } finally {
        await second.close();
      }
    } finally {
      await close().catch(() => {});
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);
});
