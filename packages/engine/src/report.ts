/**
 * Stage 5 — Report. report_plan returns the deterministic statistics pack
 * plus narrative slots; report_submit validates and versions the draft;
 * renderReport writes Markdown + Mermaid into .murmur/reports/{world}/.
 */
import {
  DATA_NOTICE,
  type Entity,
  type EscalationChain,
  type GenerationTask,
  type ItemError,
  type Post,
  type ReportDraft,
  type ReportRecord,
  type World,
} from "./types.js";
import type { Storage } from "./store/storage.js";
import { engagementPeaks, leaderboards, sentimentCurve, timeline, topPostsByEngagement, postSentiment, type Mover } from "./aggregate.js";
import { clamp, estTokens, nowIso, round2Safe, sentimentLabel, stanceBar, truncate } from "./util/text.js";

export const REPORT_INSTRUCTIONS = `You are the report writer for a social-simulation engine. You receive deterministic statistics and an evidence pack (real posts from the simulation). Draft the prediction report narrative.
Return a JSON object:
{
  "executiveSummary": "3-6 sentences — what happened and what it means",
  "trajectory": "the most-likely trajectory from here, grounded in the sentiment curves and escalations",
  "risks": [
    { "title": "short risk name", "rationale": "2-4 sentences citing what the simulation showed", "severity": "high|medium|low", "postIds": ["po_x", ...] }
  ],
  "confidence": { "strongSignals": ["…"], "contested": ["…"] }
}
Rules:
- Exactly 3 risks. Each risk MUST cite 1-3 real post ids from the evidence pack (postIds).
- strongSignals: findings backed by multiple posts and consistent sentiment. contested: findings where the simulated population split.
- Never invent post ids, numbers or quotes. Use only the evidence pack.
Return ONLY the JSON object.`;

export interface ReportStatsPack {
  rounds: { round: number; twitter: number; reddit: number; engagement: number; sentimentByEntity: Record<string, number>; escalations: number; injections: number }[];
  sentimentCurves: { entity: string; type: string; curve: { round: number; value: number }[] }[];
  peaks: number[];
  escalationChains: { path: string[]; depth: number; finalSentiment: number; severity: number }[];
  leaderboards: { handle: string; archetype: string; posts: number; engagement: number }[];
  topPosts: { id: string; by: string; plat: string; round: number; body: string; engagement: number; sentiment: number }[];
  movers: { personaId: string; entity: string; from: number; to: number }[];
}

export function buildReportTask(storage: Storage, world: World, focus: string | undefined): GenerationTask {
  if (world.round === 0) throw new Error("no rounds simulated yet — run sim_next_batch / sim_submit_generations first");
  const entities = [...storage.listEntities(world.id)].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
  const topEntities = entities.slice(0, 5);
  const rows = timeline(storage, world);
  const personas = storage.listPersonas(world.id);
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const statsEvents = storage.listEvents(world.id, { type: "round_stats" });
  const chainsFromStats: EscalationChain[] = statsEvents.flatMap((e) =>
    ((e.payload.stats as { escalations?: EscalationChain[] } | undefined)?.escalations ?? [])
  );
  const moversFromStats: Mover[] = statsEvents.flatMap((e) =>
    ((e.payload.stats as { topMovers?: Mover[] } | undefined)?.topMovers ?? [])
  );

  const stats: ReportStatsPack = {
    rounds: rows.map((r) => ({ round: r.round, twitter: r.twitter, reddit: r.reddit, engagement: r.engagement, sentimentByEntity: r.sentimentByEntity, escalations: r.escalations, injections: r.injections })),
    sentimentCurves: topEntities.map((e) => ({ entity: e.name, type: e.type, curve: sentimentCurve(storage, world, e) })),
    peaks: engagementPeaks(rows),
    escalationChains: chainsFromStats
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 3)
      .map((c) => ({ path: c.path, depth: c.depth, finalSentiment: c.finalSentiment, severity: c.severity })),
    leaderboards: leaderboards(storage, world, 6).map((l) => ({ handle: l.handle, archetype: l.archetype, posts: l.posts, engagement: l.engagementReceived })),
    topPosts: topPostsByEngagement(storage, world, 10).map(({ post, sentiment }) => ({
      id: post.id,
      by: handles.get(post.personaId) ?? post.personaId,
      plat: post.platform === "twitter" ? "tw" : "rd",
      round: post.round,
      body: truncate(post.body, 240),
      engagement: post.metrics.likes + 2 * post.metrics.reposts + post.metrics.upvotes - post.metrics.downvotes,
      sentiment,
    })),
    movers: moversFromStats.slice(0, 8),
  };

  // Evidence quotes: strongest |sentiment| posts per top entity
  const evidence = topEntities.slice(0, 4).map((e) => {
    const posts = storage
      .listPosts(world.id, { limit: 100000 })
      .filter((p) => p.mentions.some((m) => m.entityId === e.id))
      .sort((a, b) => Math.abs(postSentiment(b)) - Math.abs(postSentiment(a)) || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((p) => ({ id: p.id, by: handles.get(p.personaId) ?? p.personaId, plat: p.platform === "twitter" ? "tw" : "rd", sentiment: round2Safe(postSentiment(p)), body: truncate(p.body, 200) }));
    return { entity: e.name, posts };
  });

  const task: GenerationTask = {
    id: storage.nextTaskId(),
    worldId: world.id,
    kind: "report",
    round: world.round,
    instructions: `${REPORT_INSTRUCTIONS}\n\nWorld: ${world.name}${focus ? ` — focus: ${focus}` : ""}\n\n${DATA_NOTICE}`,
    outputSchema: {
      type: "object",
      required: ["executiveSummary", "trajectory", "risks", "confidence"],
      properties: {
        executiveSummary: { type: "string", minLength: 80 },
        trajectory: { type: "string", minLength: 80 },
        risks: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", required: ["title", "rationale", "severity", "postIds"] } },
        confidence: { type: "object", required: ["strongSignals", "contested"] },
      },
    },
    items: [
      {
        id: "draft-1",
        label: "draft the prediction report narrative",
        tokens: 0,
        payload: { focus: focus ?? "", stats, evidence },
      },
    ],
    createdAt: nowIso(),
  };
  task.items[0].tokens = estTokens(JSON.stringify(task.items[0].payload));
  storage.saveTask(task);
  return task;
}

export function validateReportDraft(storage: Storage, world: World, draft: unknown): { draft: ReportDraft; rejected: ItemError[] } {
  const d = (draft ?? {}) as Record<string, unknown>;
  const rejected: ItemError[] = [];
  const exec = typeof d.executiveSummary === "string" ? d.executiveSummary.trim() : "";
  const traj = typeof d.trajectory === "string" ? d.trajectory.trim() : "";
  if (exec.length < 80) rejected.push({ ref: "executiveSummary", message: `too short (${exec.length} chars, min 80)` });
  if (traj.length < 80) rejected.push({ ref: "trajectory", message: `too short (${traj.length} chars, min 80)` });
  const risks: ReportDraft["risks"] = [];
  if (!Array.isArray(d.risks) || d.risks.length < 3) {
    rejected.push({ ref: "risks", message: `need exactly 3 risks (got ${Array.isArray(d.risks) ? d.risks.length : 0})` });
  } else {
    d.risks.slice(0, 6).forEach((r: Record<string, unknown>, i: number) => {
      const title = typeof r?.title === "string" ? r.title.trim() : "";
      const rationale = typeof r?.rationale === "string" ? r.rationale.trim() : "";
      const severity = String(r?.severity ?? "medium");
      const postIds = Array.isArray(r?.postIds) ? r.postIds.map(String) : [];
      if (!title) rejected.push({ ref: `risks[${i}].title`, message: "missing title" });
      if (rationale.length < 40) rejected.push({ ref: `risks[${i}].rationale`, message: "rationale too short (min 40 chars)" });
      if (!["high", "medium", "low"].includes(severity)) rejected.push({ ref: `risks[${i}].severity`, message: `invalid severity "${severity}"` });
      if (postIds.length === 0) rejected.push({ ref: `risks[${i}].postIds`, message: "each risk must cite 1-3 post ids" });
      for (const pid of postIds) {
        if (!storage.getPost(world.id, pid)) rejected.push({ ref: `risks[${i}].postIds`, message: `unknown post id ${pid}` });
      }
      if (rejected.length === 0 || rejected.every((x) => !x.ref.startsWith(`risks[${i}]`))) {
        risks.push({ title, rationale, severity: severity as "high" | "medium" | "low", postIds: postIds.slice(0, 3) });
      }
    });
  }
  const conf = (d.confidence ?? {}) as Record<string, unknown>;
  const strongSignals = Array.isArray(conf.strongSignals) ? conf.strongSignals.map(String).filter(Boolean) : [];
  const contested = Array.isArray(conf.contested) ? conf.contested.map(String).filter(Boolean) : [];
  if (strongSignals.length === 0) rejected.push({ ref: "confidence.strongSignals", message: "at least one strong signal required" });
  const clean = rejected.length === 0;
  const out: ReportDraft = { executiveSummary: exec, trajectory: traj, risks, confidence: { strongSignals, contested } };
  return { draft: clean ? out : out, rejected: clean ? [] : rejected };
}

export function storeReport(storage: Storage, world: World, draft: ReportDraft, focus: string): ReportRecord {
  const latest = storage.latestReport(world.id);
  const version = (latest?.version ?? 0) + 1;
  const record = storage.insertReport(world.id, { version, focus, narrative: draft, path: "" });
  storage.setStage(world.id, "reported");
  return record;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

export function renderReportMarkdown(storage: Storage, world: World, report: ReportRecord): string {
  const entities = [...storage.listEntities(world.id)].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
  const personas = storage.listPersonas(world.id);
  const handles = new Map(personas.map((p) => [p.id, `${p.name} (${p.handle})`]));
  const rows = timeline(storage, world);
  const d = report.narrative;
  const L: string[] = [];
  L.push(`# Murmur Prediction Report — ${world.name}`);
  L.push("");
  L.push(`**Version:** ${report.version} · **Rounds:** ${world.round} · **Population:** ${personas.length} · **Focus:** ${report.focus || "general"} `);
  L.push("");
  L.push(`> Generated by Murmur (${new Date().toISOString().slice(0, 10)}). Deterministic statistics computed by the engine;`);
  L.push(`> narrative drafted by the host coding agent. Reproduce this report by re-running the world with seed \`${world.seed}\`.`);
  L.push("");
  L.push("## Executive Summary");
  L.push("");
  L.push(d.executiveSummary);
  L.push("");
  L.push("## Methodology");
  L.push("");
  L.push(
    `A population of ${personas.length} simulated users (${entities.length} ontology entities, dual-platform mechanics) ` +
      `evolved over ${world.round} rounds. Each round the engine activated a weighted subset of personas, composed personalized ` +
      `feeds, and the host LLM wrote their posts, replies and votes in character. Engagement, virality, sentiment, stance ` +
      `migration and escalation chains below are deterministic functions of the recorded run — no narrative guesswork.`
  );
  L.push("");
  L.push("## Most-Likely Trajectory");
  L.push("");
  L.push(d.trajectory);
  L.push("");

  // Sentiment charts (mermaid xychart per top entity)
  const charted = entities.slice(0, 3);
  for (const e of charted) {
    const curve = sentimentCurve(storage, world, e);
    if (curve.length < 2) continue;
    L.push(`### Sentiment — ${e.name} (${e.type})`);
    L.push("");
    L.push("```mermaid");
    L.push("xychart-beta");
    L.push(`    title "Sentiment by round - ${e.name.replace(/["\\]/g, "")}"`);
    L.push(`    x-axis [${curve.map((c) => c.round).join(", ")}]`);
    L.push('    y-axis "sentiment" -1 --> 1');
    L.push(`    line [${curve.map((c) => c.value.toFixed(2)).join(", ")}]`);
    L.push("```");
    L.push("");
    const last = curve[curve.length - 1];
    const first = curve[0];
    L.push(`Started ${sentimentLabel(first.value)} (${first.value.toFixed(2)}) in round ${first.round}, ended ${sentimentLabel(last.value)} (${last.value.toFixed(2)}) in round ${last.round}.`);
    L.push("");
  }

  // Risks
  L.push("## Named Risks");
  L.push("");
  for (const r of d.risks) {
    L.push(`### ${r.title} — severity: ${r.severity}`);
    L.push("");
    L.push(r.rationale);
    L.push("");
    for (const pid of r.postIds) {
      const p = storage.getPost(world.id, pid);
      if (p) {
        L.push(`> **${pid}** · ${handles.get(p.personaId) ?? p.personaId} · ${p.platform} · round ${p.round}: "${truncate(p.body, 220)}"`);
        L.push("");
      }
    }
  }

  // Stance migration bars
  const movers = storage
    .listEvents(world.id, { type: "round_stats" })
    .flatMap((e) => ((e.payload.stats as { topMovers?: { personaId: string; entity: string; from: number; to: number }[] })?.topMovers ?? []));
  if (movers.length > 0) {
    L.push("## Stance Migration");
    L.push("");
    L.push("| Persona | Entity | From | To | Shift |");
    L.push("|---|---|---|---|---|");
    const byId = new Map(personas.map((p) => [p.id, p.handle]));
    for (const m of movers.slice(0, 10)) {
      L.push(`| ${byId.get(m.personaId) ?? m.personaId} | ${m.entity} | ${m.from.toFixed(2)} | ${m.to.toFixed(2)} | ${stanceBar(m.to)} |`);
    }
    L.push("");
  }

  // Escalations
  const chains = storage
    .listEvents(world.id, { type: "round_stats" })
    .flatMap((e) => ((e.payload.stats as { escalations?: { path: string[]; depth: number; finalSentiment: number; severity: number }[] })?.escalations ?? []))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3);
  if (chains.length > 0) {
    L.push("## Escalation Chains");
    L.push("");
    for (const c of chains) {
      L.push(`- **Severity ${c.severity.toFixed(2)}** · depth ${c.depth} · final sentiment ${c.finalSentiment.toFixed(2)} · chain: ${c.path.map((id) => `\`${id}\``).join(" → ")}`);
    }
    L.push("");
  }

  // Confidence
  L.push("## Confidence");
  L.push("");
  L.push("**Strong signals** (multiple posts, consistent sentiment):");
  for (const s of d.confidence.strongSignals) L.push(`- ${s}`);
  L.push("");
  if (d.confidence.contested.length > 0) {
    L.push("**Contested** (population split):");
    for (const s of d.confidence.contested) L.push(`- ${s}`);
    L.push("");
  }

  // Leaderboards
  L.push("## Persona Leaderboards");
  L.push("");
  L.push("| Persona | Archetype | Posts | Engagement received |");
  L.push("|---|---|---|---|");
  for (const l of leaderboards(storage, world, 8)) {
    L.push(`| ${l.handle} | ${l.archetype} | ${l.posts} | ${l.engagementReceived} |`);
  }
  L.push("");

  // Appendix A — deterministic statistics
  L.push("## Appendix A — Deterministic Statistics");
  L.push("");
  L.push("### Round-by-round");
  L.push("");
  L.push("| Round | Twitter | Reddit | Engagement | Escalations | Injections |");
  L.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    L.push(`| ${r.round} | ${r.twitter} | ${r.reddit} | ${r.engagement} | ${r.escalations} | ${r.injections} |`);
  }
  L.push("");
  const peaks = engagementPeaks(rows);
  if (peaks.length > 0) L.push(`Engagement peaks (mean + 2σ): rounds ${peaks.join(", ")}.`);
  L.push("");

  // Appendix B — post index
  L.push("## Appendix B — Post Index (evidence)");
  L.push("");
  L.push("| Id | By | Plat | R | Sentiment | Engagement | Excerpt |");
  L.push("|---|---|---|---|---|---|---|");
  for (const { post, sentiment } of topPostsByEngagement(storage, world, 20)) {
    const eng = post.metrics.likes + 2 * post.metrics.reposts + post.metrics.upvotes - post.metrics.downvotes;
    L.push(`| ${post.id} | ${handles.get(post.personaId) ?? post.personaId} | ${post.platform === "twitter" ? "tw" : "rd"} | ${post.round} | ${sentiment.toFixed(2)} | ${eng} | ${truncate(post.body, 90).replace(/\|/g, "\\|")} |`);
  }
  L.push("");
  return L.join("\n");
}

export function entityById(entities: Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

export function clampReportFocus(focus: string | undefined): string {
  return clamp((focus ?? "").trim().length, 0, 200) === (focus ?? "").trim().length ? (focus ?? "").trim() : (focus ?? "").trim().slice(0, 200);
}

export type { Post, World };
