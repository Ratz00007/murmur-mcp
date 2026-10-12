/**
 * Stage 6 — report: one tool over one deliverable.
 *
 * `plan` composes the drafting task from the deterministic analytics and the
 * evidence pack, `submit` validates and versions the narrative, `export`
 * writes it to disk. Three steps of one artifact.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildDossierTask,
  buildReportTask,
  renderDossierMarkdown,
  renderReportHtml,
  renderReportMarkdown,
  storeReport,
  validateDossierDraft,
  validateReportDraft,
} from "@murmur/engine";
import { coerceJson, type ServerContext } from "../session.js";
import { REPORT_OUTPUT } from "./outputs.js";
import { registerTaskTool } from "./tasks.js";

export const REPORT_TOOL_NAMES = ["report"] as const;

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

/** Mirrors the dossier task.outputSchema the engine attaches (engine/src/dossier.ts). */
const dossierDraft = z.object({
  objections: z
    .array(
      z.object({
        label: z.string().describe("3-10 word objection name"),
        steelman: z.string().describe("The objection at its strongest, citing concrete posts and numbers"),
        blastRadius: z.enum(["high", "medium", "low"]).describe("Damage IF TRUE, not likelihood"),
        threatenedDecision: z.string().describe("The concrete decision this threatens"),
        postIds: z.array(z.string()).describe("2-3 real post ids from the evidence pack backing this objection"),
      })
    )
    .min(4)
    .max(7)
    .describe("4-7 objections, ranked most damaging first"),
  strongestCritic: z
    .object({
      handle: z.string().describe("The persona who hates this most"),
      sentence: z.string().describe("The sentence that makes them hate it, quoted or closely paraphrased"),
    }),
  counterCase: z.string().describe("The strongest argument FOR shipping, stated as well as the case against"),
  weakestClaim: z
    .object({
      claim: z.string().describe("Your plan's weakest load-bearing claim"),
      breakingQuestion: z.string().describe("The single question that would break it"),
    }),
  testPlan: z
    .array(
      z.object({
        question: z.string().describe("A question for a real human"),
        discriminates: z.string().describe("Which branch of the plan this answer decides"),
        wouldNotShipIf: z.string().describe("The answer that should stop the launch"),
      })
    )
    .min(1)
    .max(5)
    .describe("1-5 ranked test questions"),
});

export function registerReportTools(server: McpServer, ctx: ServerContext): void {
  registerTaskTool(server, "report", {
    title: "Draft / store / export the report",
    description:
      "Stage 6 of the pipeline. action:'plan' composes the report-drafting task — deterministic analytics (sentiment curves " +
      "and projection, factions, controversy index, platform divergence, escalation chains, quote bank, timeline moments) " +
      "plus an evidence pack of the strongest posts; draft the senior-analyst narrative from that evidence and return it " +
      "with action:'submit'. action:'submit' validates the narrative (sections, severities, and that every cited post id " +
      "exists), versions and stores it; invalid fields are itemized for surgical retry. action:'export' writes the " +
      "versioned report into .murmur/reports/{world}/ as Markdown+Mermaid and/or a self-contained HTML dashboard — " +
      "reports regenerate rather than mutate, so two scenarios can be diffed line by line. " +
      "mode:'dossier' produces the Objection Dossier instead: ranked objections with steelmen and evidence, the " +
      "counter-case, the weakest load-bearing claim, and a ranked test plan for real humans — held to the same " +
      "citation and numeric integrity as the report.",
    inputSchema: {
      action: z.enum(["plan", "submit", "export"]).describe("Draft, store, or write the report"),
      mode: z.enum(["report", "dossier"]).optional().describe("Which artifact: the simulation report (default) or the Objection Dossier"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
      focus: z.string().max(200).optional().describe("Optional focus for the report, e.g. 'developer reaction to the pricing change' — action:'plan'"),
      task_id: z.string().optional().describe("Task id from action:'plan' — required for action:'submit'"),
      draft: z
        .union([
          reportDraft.describe("Your draft — mirrors the task.outputSchema the engine returned"),
          dossierDraft.describe("Your dossier draft — mirrors the dossier task.outputSchema"),
          z.string().describe("The same draft as a JSON string (parsed server-side)"),
        ])
        .optional()
        .describe("Your draft — action:'submit' only"),
      version: z.number().int().min(1).optional().describe("Report version (default: latest) — action:'export'"),
      format: z.enum(["md", "html", "both"]).optional().describe("Output format: md (default), html dashboard, or both — action:'export'"),
    },
    outputSchema: REPORT_OUTPUT,
    run: async (args) => {
      try {
        const mode = args.mode ?? "report";
        switch (args.action) {
          case "plan":
            return mode === "dossier" ? planDossier(ctx, args.world, args.focus) : plan(ctx, args.world, args.focus);
          case "submit":
            return submit(ctx, args);
          default:
            return mode === "dossier" ? exportDossier(ctx, args) : exportReport(ctx, args);
        }
      } catch (e) {
        return ctx.fail(e);
      }
    },
  });
}

function plan(ctx: ServerContext, world?: string, focus?: string) {
  const w = ctx.resolveWorld(world);
  const task = buildReportTask(ctx.storage, w, focus);
  ctx.audit(w, { op: "report_plan", taskId: task.id, focus: focus ?? "" });
  return ctx.reply(
    {
      ok: true,
      taskId: task.id,
      how: "Draft scenarioRecap, executiveSummary (100-170 words), 3-5 keyFindings, trajectory, exactly 3 risks (each with severity, likelihood, mitigation, trigger, citing 2-3 post ids), 2-4 recommendations, confidence and limitations. Then call report({action:'submit', task_id, draft}).",
      task,
      next: 'report({action:"submit", task_id, draft})',
    },
    w,
    REPORT_OUTPUT
  );
}

function planDossier(ctx: ServerContext, world?: string, focus?: string) {
  const w = ctx.resolveWorld(world);
  const task = buildDossierTask(ctx.storage, w, focus);
  ctx.audit(w, { op: "report_plan", mode: "dossier", taskId: task.id, focus: focus ?? "" });
  return ctx.reply(
    {
      ok: true,
      taskId: task.id,
      how: "Draft 4-7 objections ranked most damaging first (each with steelman, blastRadius as damage-if-true, threatenedDecision, citing 2-3 post ids), the strongest critic, a genuinely strong counter-case, the weakest load-bearing claim with its breaking question, and 1-5 ranked test-plan questions each stating what would stop the launch. Then call report({action:'submit', task_id, draft}).",
      task,
      next: 'report({action:"submit", task_id, draft})',
    },
    w,
    REPORT_OUTPUT
  );
}

function submit(ctx: ServerContext, args: { task_id?: string; draft?: unknown }) {
  if (!args.task_id) throw new Error("action:'submit' needs task_id from the plan receipt");
  const wActive = ctx.resolveWorld(undefined);
  const task = ctx.storage.getTask(wActive.id, args.task_id);
  if (!task) throw new Error(`unknown task id: ${args.task_id} (no such task in the active world ${wActive.id})`);
  const w = ctx.storage.getWorld(task.worldId);
  if (!w) throw new Error("world for task not found");
  // The task kind decides the validator: a dossier task carries objections,
  // not risks, and validating it as a report would reject a correct draft.
  if (task.kind === "dossier") return submitDossier(ctx, w, args);
  const { draft: clean, rejected } = validateReportDraft(ctx.storage, w, coerceJson(args.draft));
  if (rejected.length > 0) {
    ctx.audit(w, { op: "report_submit", taskId: args.task_id, rejected: rejected.length });
    return ctx.reply(
      {
        ok: false,
        rejected,
        hint: "fix the rejected fields and resubmit the same task_id — risks must cite real post ids from the evidence pack",
        next: "report({action:'submit', task_id, draft}) again, with the rejected fields fixed",
      },
      w,
      REPORT_OUTPUT
    );
  }
  const record = storeReport(ctx.storage, w, clean, String((task.items[0]?.payload as { focus?: string })?.focus ?? ""));
  ctx.audit(w, { op: "report_submit", taskId: args.task_id, version: record.version });
  return ctx.reply(
    {
      ok: true,
      version: record.version,
      risks: clean.risks.map((r) => `${r.severity.toUpperCase()} — ${r.title} [${r.postIds.join(", ")}]`),
      next: `report({action:"export"}) to write report-${record.version}.md into the repo`,
    },
    w,
    REPORT_OUTPUT
  );
}

function submitDossier(ctx: ServerContext, w: ReturnType<ServerContext["resolveWorld"]>, args: { task_id?: string; draft?: unknown }) {
  const { draft: clean, rejected } = validateDossierDraft(ctx.storage, w, coerceJson(args.draft));
  if (rejected.length > 0) {
    ctx.audit(w, { op: "report_submit", mode: "dossier", taskId: args.task_id, rejected: rejected.length });
    return ctx.reply(
      {
        ok: false,
        rejected,
        hint: "fix the rejected fields and resubmit the same task_id — objections must cite real post ids from the evidence pack",
        next: "report({action:'submit', task_id, draft}) again, with the rejected fields fixed",
      },
      w,
      REPORT_OUTPUT
    );
  }
  const version = ctx.workspace.nextDossierVersion(w.slug);
  ctx.workspace.ensureWorldDir(w.slug);
  const jsonFile = ctx.workspace.dossierJsonPath(w.slug, version);
  ctx.workspace.writeAtomic(jsonFile, JSON.stringify({ version, world: w.id, focus: "", draft: clean, createdAt: new Date().toISOString() }, null, 2));
  ctx.audit(w, { op: "report_submit", mode: "dossier", taskId: args.task_id, version });
  return ctx.reply(
    {
      ok: true,
      version,
      objections: clean.objections.map((o) => `${o.blastRadius.toUpperCase()} — ${o.label} [${o.postIds.join(", ")}]`),
      next: `report({action:"export", mode:"dossier", version:${version}}) to write dossier-${version}.md into the repo`,
    },
    w,
    REPORT_OUTPUT
  );
}

function exportDossier(ctx: ServerContext, args: { world?: string; version?: number }) {
  const w = ctx.resolveWorld(args.world);
  const version = args.version ?? ctx.workspace.latestDossierVersion(w.slug);
  if (version < 1) throw new Error("no stored dossier — run report({action:'plan', mode:'dossier'}) / report({action:'submit'}) first");
  const jsonFile = ctx.workspace.dossierJsonPath(w.slug, version);
  const raw = ctx.workspace.readIfExists(jsonFile);
  if (!raw) throw new Error(`no stored dossier-${version} — run report({action:'plan', mode:'dossier'}) / report({action:'submit'}) first`);
  const stored = JSON.parse(raw) as { draft: import("@murmur/engine").DossierDraft };
  const md = renderDossierMarkdown(w, stored.draft, version);
  const file = ctx.workspace.dossierPath(w.slug, version);
  ctx.workspace.writeAtomic(file, md);
  ctx.audit(w, { op: "report_export", mode: "dossier", version, file: ctx.workspace.rel(file) });
  return ctx.reply(
    {
      ok: true,
      version,
      files: [{ path: ctx.workspace.rel(file), bytes: Buffer.byteLength(md, "utf8") }],
      next: `open the dossier (${ctx.workspace.rel(file)}), then take the top objections to a real human`,
    },
    w,
    REPORT_OUTPUT
  );
}

function exportReport(ctx: ServerContext, args: { world?: string; version?: number; format?: "md" | "html" | "both" }) {
  const w = ctx.resolveWorld(args.world);
  const record = args.version ? ctx.storage.reportByVersion(w.id, args.version) : ctx.storage.latestReport(w.id);
  if (!record) throw new Error("no stored report — run report({action:'plan'}) / report({action:'submit'}) first");
  const fmt = args.format ?? "md";
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
        ? { open: htmlPath, hint: `open ${htmlPath} in a browser — the dashboard shares every number with the .md report (same engine computation)` }
        : {}),
      next: htmlPath
        ? `open the dashboard (${htmlPath}) and the report${mdPath ? ` (${mdPath})` : ""}, then interact({target:"persona"|"run"}) to interrogate the world behind them`
        : `open the report${mdPath ? ` (${mdPath})` : ""}, then interact({target:"persona"|"run"}) to interrogate the world behind it`,
    },
    w,
    REPORT_OUTPUT
  );
}
