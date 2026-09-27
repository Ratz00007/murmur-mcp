/** Report tools: report_plan, report_submit, report_export. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildReportTask, renderReportHtml, renderReportMarkdown, storeReport, validateReportDraft } from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";

/** Mirrors the task.outputSchema the engine attaches to report tasks (engine/src/report.ts). */
const reportDraft = z.object({
  scenarioRecap: z.string().min(60).optional().describe("One short paragraph restating the question and what was simulated"),
  executiveSummary: z.string().min(120).describe("The verdict: 100-170 words with the key numbers and the biggest risk"),
  keyFindings: z.array(z.string()).min(3).max(5).describe("3-5 one-sentence findings, each anchored to a number"),
  trajectory: z.string().min(120).describe("Where this goes next: projection slope, momentum, escalation chains, the realistic branch"),
  risks: z
    .array(
      z.object({
        title: z.string().describe("Short risk title"),
        rationale: z.string().describe("Why this is a risk, citing concrete posts and numbers"),
        severity: z.enum(["high", "medium", "low"]).describe("high | medium | low"),
        likelihood: z.enum(["high", "medium", "low"]).optional().describe("high | medium | low (default medium)"),
        mitigation: z.string().describe("The concrete action that blunts this risk"),
        trigger: z.string().optional().describe("The earliest observable signal that this risk is materializing"),
        postIds: z.array(z.string()).describe("2-3 real post ids from the evidence pack backing this risk"),
      })
    )
    .min(3)
    .max(3)
    .describe("Exactly 3 risks, each citing 2-3 real post ids"),
  recommendations: z
    .array(
      z.object({
        title: z.string().describe("Short recommendation title"),
        action: z.string().describe("What to do, specifically"),
        expectedImpact: z.string().describe("What this changes, and for whom"),
      })
    )
    .min(2)
    .max(4)
    .describe("2-4 prioritized recommendations"),
  confidence: z
    .object({
      strongSignals: z.array(z.string()).describe("What the run demonstrates consistently"),
      contested: z.array(z.string()).describe("What is contested or unmeasured"),
    })
    .describe("Evidence confidence: strong signals vs contested findings"),
  limitations: z.array(z.string()).max(3).optional().describe("Up to 3 known limits of this analysis"),
});

export function registerReportTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "report_plan",
    "Stage 6 Â· PLAN: compose the report-drafting task â€” deterministic analytics (sentiment curves + projection, factions, controversy index, platform divergence, escalation chains, quote bank, timeline moments) " +
      "plus an evidence pack of the strongest posts. Draft the senior-analyst narrative from that evidence and return it via report_submit.",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      focus: z.string().max(200).optional().describe("Optional focus for the report, e.g. 'developer reaction to the pricing change'"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ world, focus }) => {
      try {
        const w = ctx.resolveWorld(world);
        const task = buildReportTask(ctx.storage, w, focus);
        ctx.audit(w, { op: "report_plan", taskId: task.id, focus: focus ?? "" });
        return ctx.reply(
          {
            ok: true,
            taskId: task.id,
            how: "Draft scenarioRecap, executiveSummary (100-170 words), 3-5 keyFindings, trajectory, exactly 3 risks (each with severity, likelihood, mitigation, trigger, citing 2-3 post ids), 2-4 recommendations, confidence and limitations. Then call report_submit with this task_id and your draft.",
            task,
            next: "report_submit",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "report_submit",
    "Stage 6 Â· SUBMIT: validate the narrative (sections, severities, post-id citations must exist), version and store it. Invalid fields are itemized for surgical retry.",
    {
      task_id: z.string().describe("Task id from report_plan"),
      draft: z
        .union([
          reportDraft.describe("Your draft â€” mirrors the task.outputSchema the engine returned"),
          z.string().describe("The same draft as a JSON string (parsed server-side)"),
        ])
        .describe("Your draft: {scenarioRecap, executiveSummary, keyFindings, trajectory, risks: [{title, rationale, severity, likelihood, mitigation, trigger, postIds}], recommendations: [{title, action, expectedImpact}], confidence: {strongSignals, contested}, limitations}"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ task_id, draft }) => {
      try {
        const wActive = ctx.resolveWorld(undefined);
        const task = ctx.storage.getTask(wActive.id, task_id);
        if (!task) throw new Error(`unknown task id: ${task_id} (no such task in the active world ${wActive.id})`);
        const w = ctx.storage.getWorld(task.worldId);
        if (!w) throw new Error("world for task not found");
        const { draft: clean, rejected } = validateReportDraft(ctx.storage, w, coerceJson(draft));
        if (rejected.length > 0) {
          ctx.audit(w, { op: "report_submit", taskId: task_id, rejected: rejected.length });
          return ctx.reply(
            {
              ok: false,
              rejected,
              hint: "fix the rejected fields and resubmit the same task_id â€” risks must cite real post ids from the evidence pack",
              next: "report_submit (retry)",
            },
            w
          );
        }
        const record = storeReport(ctx.storage, w, clean, String((task.items[0]?.payload as { focus?: string })?.focus ?? ""));
        ctx.audit(w, { op: "report_submit", taskId: task_id, version: record.version });
        return ctx.reply(
          {
            ok: true,
            version: record.version,
            risks: clean.risks.map((r) => `${r.severity.toUpperCase()} â€” ${r.title} [${r.postIds.join(", ")}]`),
            next: `report_export to write report-${record.version}.md into the repo`,
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "report_export",
    "Write the versioned report into .murmur/reports/{world}/ â€” Markdown+Mermaid (diffable, renders on any git forge) and/or a self-contained HTML dashboard (inline CSS+SVG, no external requests; open it in a browser). " +
      "Reports regenerate (never mutate), so two scenarios can be diffed line by line.",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      version: z.number().int().min(1).optional().describe("Report version (default: latest)"),
      format: z.enum(["md", "html", "both"]).optional().describe("Output format: md (default), html dashboard, or both"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ world, version, format }) => {
      try {
        const w = ctx.resolveWorld(world);
        const record = version ? ctx.storage.reportByVersion(w.id, version) : ctx.storage.latestReport(w.id);
        if (!record) throw new Error("no stored report â€” run report_plan / report_submit first");
        const fmt = format ?? "md";
        const written: { path: string; bytes: number }[] = [];
        let mdPath: string | null = null;
        let htmlPath: string | null = null;
        if (fmt === "md" || fmt === "both") {
          const md = renderReportMarkdown(ctx.storage, w, record);
          const file = ctx.workspace.reportPath(w.slug, record.version);
          ctx.workspace.writeAtomic(file, md);
          ctx.storage.db.prepare("UPDATE reports SET path=? WHERE id=?").run(ctx.workspace.rel(file), record.id);
          written.push({ path: ctx.workspace.rel(file), bytes: Buffer.byteLength(md, "utf8") });
          mdPath = ctx.workspace.rel(file);
        }
        if (fmt === "html" || fmt === "both") {
          const html = renderReportHtml(ctx.storage, w, record);
          const file = ctx.workspace.reportHtmlPath(w.slug, record.version);
          ctx.workspace.writeAtomic(file, html);
          written.push({ path: ctx.workspace.rel(file), bytes: Buffer.byteLength(html, "utf8") });
          htmlPath = ctx.workspace.rel(file);
        }
        ctx.audit(w, { op: "report_export", version: record.version, format: fmt, files: written.map((x) => x.path) });
        return ctx.reply(
          {
            ok: true,
            version: record.version,
            files: written,
            ...(htmlPath
              ? { open: htmlPath, hint: `open ${htmlPath} in a browser â€” the dashboard shares every number with the .md report (same engine computation)` }
              : {}),
            next: htmlPath
              ? `open the dashboard (${htmlPath}) and the report${mdPath ? ` (${mdPath})` : ""}, then interview_agent / report_agent_ask to interrogate the world behind them`
              : `open the report${mdPath ? ` (${mdPath})` : ""}, then interview_agent / report_agent_ask to interrogate the world behind it`,
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}
