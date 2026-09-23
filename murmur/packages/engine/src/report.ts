/**
 * Stage 5 — Report. report_plan returns the deterministic statistics pack
 * (analytics: factions, controversy, momentum, projection, quotes, moments)
 * plus narrative slots with word budgets; report_submit validates depth and
 * versions the draft; renderReportMarkdown weaves LLM narrative around
 * engine-computed evidence blocks into .murmur/reports/{world}/report-N.md.
 */
import {
  DATA_NOTICE,
  type Entity,
  type Persona,
  type Post,
  type ReportDraft,
  type ReportRecord,
  type World,
} from "./types.js";
import type { Storage } from "./store/storage.js";
import { engagementPeaks, leaderboards, sentimentCurve, timeline, topPostsByEngagement, postSentiment, type Mover } from "./aggregate.js";
import {
  amplification,
  allEscalations,
  attributedSentiment,
  controversyIndex,
  crossPlatform,
  entityTrends,
  factionAnalysis,
  momentum,
  narrativeTimeline,
  personaArcs,
  projectCurve,
  quoteBank,
  type AmplificationInfo,
  type ControversyAnalysis,
  type CrossPlatformAnalysis,
  type EntityTrend,
  type FactionAnalysis,
  type MomentumAnalysis,
  type Projection,
  type QuoteBank,
  type TimelineMoment,
} from "./analytics.js";
import { engagementScore } from "./util/engagement.js";
import { ensembleIntervals, projectionEnsemble, type EnsembleInterval } from "./dynamics/ensemble.js";
import { clamp, escapeMermaid, estTokens, nowIso, round2Safe, sentimentLabel, stanceBar, truncate } from "./util/text.js";

export const REPORT_INSTRUCTIONS = `You are the senior analyst writing a simulated perspective report for a social-simulation engine. You receive a deterministic statistics pack (real measured numbers from the recorded run) and an evidence pack (real posts). Draft the analyst narrative around those numbers.
Return a JSON object:
{
  "scenarioRecap": "2-4 sentences: what scenario was simulated, what population, what was injected",
  "executiveSummary": "100-170 words: the headline verdict, the key numbers (sentiment start/end, faction split, controversy, momentum) and the single biggest risk",
  "keyFindings": ["3-5 one-sentence findings, each anchored to a number from the stats pack"],
  "trajectory": "110-190 words: the most-likely trajectory from here, grounded in the projection slope, momentum and escalation chains",
  "risks": [
    { "title": "short risk name", "rationale": "3-5 sentences citing concrete posts and numbers", "severity": "high|medium|low", "likelihood": "high|medium|low", "mitigation": "a concrete action the team can take, 1-2 sentences", "trigger": "the early-warning signal to watch for in the wild", "postIds": ["po_x", "po_y"] }
  ],
  "recommendations": [
    { "title": "imperative title", "action": "the specific action, 1-2 sentences", "expectedImpact": "the measurable effect to expect if taken" }
  ],
  "confidence": { "strongSignals": ["2-4 findings backed by multiple posts"], "contested": ["1-3 findings where the simulated population split"] },
  "limitations": ["1-3 honest limitations of this simulation"]
}
Rules:
- Exactly 3 risks; each MUST cite 2-3 real post ids from the evidence pack.
- 2-4 recommendations. Every number you state must come from the stats pack.
- Write like a senior analyst briefing a decision maker: specific, quantitative, no filler, no hedging boilerplate.
- Never invent post ids, numbers or quotes. Use only the evidence pack and stats pack.
Return ONLY the JSON object.`;

export interface ReportStatsPack {
  focus: string;
  population: number;
  entityCount: number;
  totalPosts: number;
  totalEngagement: number;
  rounds: { round: number; twitter: number; reddit: number; engagement: number; sentimentByEntity: Record<string, number>; escalations: number; injections: number; lurkers: number }[];
  entityTrends: EntityTrend[];
  sentimentCurves: { entity: string; type: string; curve: { round: number; value: number }[] }[];
  projection: { entity: string; slope: number; direction: string; projected: { round: number; value: number }[] } | null;
  /** Seeded P10–P50–P90 bands for the focus entity's simulated projection (null when disabled). */
  ensemble: EnsembleInterval[] | null;
  momentum: MomentumAnalysis;
  controversy: ControversyAnalysis;
  factions: FactionAnalysis;
  crossPlatform: CrossPlatformAnalysis;
  timeline: TimelineMoment[];
  quoteBank: QuoteBank;
  amplification: AmplificationInfo;
  escalationChains: { path: string[]; depth: number; finalSentiment: number; severity: number }[];
  leaderboards: { handle: string; archetype: string; posts: number; engagement: number }[];
  topPosts: { id: string; by: string; plat: string; round: number; body: string; engagement: number; sentiment: number }[];
  movers: { personaId: string; entity: string; from: number; to: number }[];
}

export function buildReportTask(storage: Storage, world: World, focus: string | undefined): import("./types.js").GenerationTask {
  if (world.round === 0) throw new Error("no rounds simulated yet — run sim_next_batch / sim_submit_generations first");
  const entities = [...storage.listEntities(world.id)].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
  const topEntities = entities.slice(0, 5);
  const rows = timeline(storage, world);
  const personas = storage.listPersonas(world.id);
  const handles = new Map(personas.map((p) => [p.id, p.handle]));

  // focus entity: an org-like entity named in the focus string, else the most
  // discussed org-like entity, else the most discussed entity overall
  const posts = storage.listPosts(world.id, { limit: 100000 });
  const mentionCount = (id: string) => posts.filter((p) => p.mentions.some((m) => m.entityId === id)).length;
  const orgish = (e: Entity) => e.type === "org" || e.type === "product" || e.type === "person";
  const wbMatch = (haystack: string, name: string) =>
    new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(haystack);
  const wanted = (focus ?? "").toLowerCase();
  const focusEntity =
    entities.filter((e) => orgish(e)).find((e) => wbMatch(wanted, e.name)) ??
    [...entities].filter((e) => orgish(e)).sort((a, b) => mentionCount(b.id) - mentionCount(a.id) || b.salience - a.salience)[0] ??
    [...entities].sort((a, b) => mentionCount(b.id) - mentionCount(a.id) || b.salience - a.salience)[0] ??
    null;

  const factions = factionAnalysis(storage, world, focusEntity);
  const controversy = controversyIndex(storage, world, factions);
  const cross = crossPlatform(storage, world, entities);
  const trends = entityTrends(storage, world, topEntities, (e) => sentimentCurve(storage, world, e), 6);
  const focusCurve = focusEntity ? sentimentCurve(storage, world, focusEntity) : [];
  const projection = focusCurve.length >= 2 ? projectCurve(focusCurve, 2) : null;
  const ensemble = projection ? ensembleIntervals(projectionEnsemble(world.seed, world.config.ensemble?.runCount ?? 5, focusCurve, projection)) : null;
  const mom = momentum(rows);
  const moments = narrativeTimeline(storage, world, 8);
  const quotes = quoteBank(storage, world, focusEntity, 3);
  const amp = amplification(storage, world);
  const chains = allEscalations(storage, world).sort((a, b) => b.severity - a.severity || a.rootId.localeCompare(b.rootId));

  const stats: ReportStatsPack = {
    focus: focus ?? "",
    population: personas.length,
    entityCount: entities.length,
    totalPosts: posts.filter((p) => p.kind !== "repost").length,
    totalEngagement: rows.reduce((a, r) => a + r.engagement, 0),
    rounds: rows.map((r) => ({ round: r.round, twitter: r.twitter, reddit: r.reddit, engagement: r.engagement, sentimentByEntity: r.sentimentByEntity, escalations: r.escalations, injections: r.injections, lurkers: r.lurkers })),
    entityTrends: trends,
    sentimentCurves: topEntities.map((e) => ({ entity: e.name, type: e.type, curve: sentimentCurve(storage, world, e) })),
    projection: projection
      ? { entity: focusEntity!.name, slope: projection.slope, direction: projection.direction, projected: projection.points.filter((p) => p.projected).map((p) => ({ round: p.round, value: p.value })) }
      : null,
    ensemble,
    momentum: mom,
    controversy,
    factions,
    crossPlatform: cross,
    timeline: moments,
    quoteBank: quotes,
    amplification: amp,
    escalationChains: chains.slice(0, 3).map((c) => ({ path: c.path, depth: c.depth, finalSentiment: c.finalSentiment, severity: c.severity })),
    leaderboards: leaderboards(storage, world, 6).map((l) => ({ handle: l.handle, archetype: l.archetype, posts: l.posts, engagement: l.engagementReceived })),
    topPosts: topPostsByEngagement(storage, world, 10).map(({ post, sentiment }) => ({
      id: post.id,
      by: handles.get(post.personaId) ?? post.personaId,
      plat: post.platform === "twitter" ? "tw" : "rd",
      round: post.round,
      body: truncate(post.body, 200),
      engagement: engagementScore(post.metrics),
      sentiment,
    })),
    movers: collectMovers(storage, world).slice(0, 8),
  };

  // Evidence quotes: strongest |sentiment toward the entity| posts per top
  // entity — sentence-attributed, so a post praising a competitor while
  // conceding about this entity scores only the concession here
  const evidence = topEntities.slice(0, 4).map((e) => {
    const others = entities.filter((x) => x.id !== e.id).map((x) => x.name);
    const posts = storage
      .listPosts(world.id, { limit: 100000 })
      .filter((p) => p.mentions.some((m) => m.entityId === e.id) && p.kind !== "repost")
      .sort((a, b) => Math.abs(attributedSentiment(b, e, others)) - Math.abs(attributedSentiment(a, e, others)) || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((p) => ({ id: p.id, by: handles.get(p.personaId) ?? p.personaId, plat: p.platform === "twitter" ? "tw" : "rd", sentiment: attributedSentiment(p, e, others), engagement: engagementScore(p.metrics), body: truncate(p.body, 200) }));
    return { entity: e.name, posts };
  });

  const task: import("./types.js").GenerationTask = {
    id: storage.nextTaskId(),
    worldId: world.id,
    kind: "report",
    round: world.round,
    instructions: `${REPORT_INSTRUCTIONS}\n\nWorld: ${world.name}${focus ? ` — focus: ${focus}` : ""}\n\n${DATA_NOTICE}`,
    outputSchema: {
      type: "object",
      required: ["executiveSummary", "keyFindings", "trajectory", "risks", "recommendations", "confidence"],
      properties: {
        scenarioRecap: { type: "string", minLength: 60 },
        executiveSummary: { type: "string", minLength: 120 },
        keyFindings: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
        trajectory: { type: "string", minLength: 120 },
        risks: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", required: ["title", "rationale", "severity", "mitigation", "postIds"] } },
        recommendations: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", required: ["title", "action", "expectedImpact"] } },
        confidence: { type: "object", required: ["strongSignals", "contested"] },
        limitations: { type: "array", maxItems: 3, items: { type: "string" } },
      },
    },
    items: [
      {
        id: "draft-1",
        label: "draft the simulated perspective narrative",
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

function collectMovers(storage: Storage, world: World): Mover[] {
  const seen = new Set<string>();
  const out: Mover[] = [];
  for (const ev of storage.listEvents(world.id, { type: "round_stats" }).sort((a, b) => a.round - b.round)) {
    for (const m of ((ev.payload.stats as { topMovers?: Mover[] })?.topMovers ?? [])) {
      const key = `${m.personaId}|${m.entity}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.personaId.localeCompare(b.personaId));
}

// ---------------------------------------------------------------------------
// Draft validation — depth is enforced, thin drafts get surgical retry feedback
// ---------------------------------------------------------------------------

export function validateReportDraft(storage: Storage, world: World, draft: unknown): { draft: ReportDraft; rejected: import("./types.js").ItemError[] } {
  const d = (draft ?? {}) as Record<string, unknown>;
  const rejected: import("./types.js").ItemError[] = [];
  const exec = typeof d.executiveSummary === "string" ? d.executiveSummary.trim() : "";
  const traj = typeof d.trajectory === "string" ? d.trajectory.trim() : "";
  const recap = typeof d.scenarioRecap === "string" ? d.scenarioRecap.trim() : "";
  if (exec.length < 120) rejected.push({ ref: "executiveSummary", message: `too thin (${exec.length} chars, min 120) — write 100-170 words with the verdict, key numbers and biggest risk` });
  if (traj.length < 120) rejected.push({ ref: "trajectory", message: `too thin (${traj.length} chars, min 120) — ground it in the projection slope, momentum and escalations` });
  if (recap.length > 0 && recap.length < 60) rejected.push({ ref: "scenarioRecap", message: `too thin (${recap.length} chars, min 60)` });

  const findings = (Array.isArray(d.keyFindings) ? d.keyFindings : []).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (findings.length < 3) rejected.push({ ref: "keyFindings", message: `need at least 3 one-sentence findings anchored to numbers (got ${findings.length})` });

  const risks: ReportDraft["risks"] = [];
  const rawRisks = Array.isArray(d.risks) ? d.risks : [];
  if (rawRisks.length < 3) {
    rejected.push({ ref: "risks", message: `need exactly 3 risks (got ${rawRisks.length})` });
  } else {
    for (let i = 0; i < 3; i++) {
      const r = (rawRisks[i] ?? {}) as Record<string, unknown>;
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";
      const severity = String(r.severity ?? "medium");
      const likelihoodRaw = r.likelihood === undefined || r.likelihood === null || r.likelihood === "" ? "medium" : String(r.likelihood);
      const mitigation = typeof r.mitigation === "string" ? r.mitigation.trim() : "";
      const trigger = typeof r.trigger === "string" ? r.trigger.trim() : "";
      const postIds = Array.isArray(r.postIds) ? r.postIds.map(String).filter(Boolean) : [];
      if (title.length < 8) rejected.push({ ref: `risks[${i}].title`, message: "title too short (min 8 chars)" });
      if (rationale.length < 120) rejected.push({ ref: `risks[${i}].rationale`, message: `rationale too thin (${rationale.length} chars, min 120) — cite 3-5 sentences of concrete posts and numbers` });
      if (!["high", "medium", "low"].includes(severity)) rejected.push({ ref: `risks[${i}].severity`, message: `invalid severity "${severity}"` });
      if (!["high", "medium", "low"].includes(likelihoodRaw)) rejected.push({ ref: `risks[${i}].likelihood`, message: `invalid likelihood "${likelihoodRaw}"` });
      if (mitigation.length < 60) rejected.push({ ref: `risks[${i}].mitigation`, message: `mitigation too thin (${mitigation.length} chars, min 60) — give the team a concrete action` });
      if (postIds.length < 2 || postIds.length > 3) rejected.push({ ref: `risks[${i}].postIds`, message: `each risk must cite 2-3 real post ids (got ${postIds.length})` });
      for (const pid of postIds) {
        if (!storage.getPost(world.id, pid)) rejected.push({ ref: `risks[${i}].postIds`, message: `unknown post id ${pid}` });
      }
      if (rejected.every((e) => !e.ref.startsWith(`risks[${i}]`))) {
        risks.push({ title, rationale, severity: severity as "high" | "medium" | "low", likelihood: likelihoodRaw as "high" | "medium" | "low", mitigation, trigger, postIds: postIds.slice(0, 3) });
      }
    }
  }

  const recs: NonNullable<ReportDraft["recommendations"]> = [];
  const rawRecs = Array.isArray(d.recommendations) ? d.recommendations : [];
  if (rawRecs.length < 2) {
    rejected.push({ ref: "recommendations", message: `need 2-4 recommendations (got ${rawRecs.length})` });
  } else {
    rawRecs.slice(0, 4).forEach((r, i) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const title = typeof x.title === "string" ? x.title.trim() : "";
      const action = typeof x.action === "string" ? x.action.trim() : "";
      const impact = typeof x.expectedImpact === "string" ? x.expectedImpact.trim() : "";
      if (title.length < 4) rejected.push({ ref: `recommendations[${i}].title`, message: "title too short" });
      if (action.length < 40) rejected.push({ ref: `recommendations[${i}].action`, message: `action too thin (${action.length} chars, min 40) — be specific about what to do` });
      if (impact.length < 20) rejected.push({ ref: `recommendations[${i}].expectedImpact`, message: `expectedImpact too thin (${impact.length} chars, min 20)` });
      if (rejected.length === 0 || rejected.every((e) => !e.ref.startsWith(`recommendations[${i}]`))) {
        recs.push({ title, action, expectedImpact: impact });
      }
    });
  }

  const conf = (d.confidence ?? {}) as Record<string, unknown>;
  const strongSignals = Array.isArray(conf.strongSignals) ? conf.strongSignals.map(String).filter(Boolean) : [];
  const contested = Array.isArray(conf.contested) ? conf.contested.map(String).filter(Boolean) : [];
  if (strongSignals.length < 2) rejected.push({ ref: "confidence.strongSignals", message: `at least 2 strong signals required (got ${strongSignals.length})` });
  if (contested.length < 1) rejected.push({ ref: "confidence.contested", message: "at least 1 contested finding required" });
  const limitations = (Array.isArray(d.limitations) ? d.limitations : []).map((s) => String(s ?? "").trim()).filter((s) => s.length >= 15).slice(0, 3);

  const out: ReportDraft = {
    scenarioRecap: recap || undefined,
    executiveSummary: exec,
    keyFindings: findings.length > 0 ? findings.slice(0, 5) : undefined,
    trajectory: traj,
    risks,
    recommendations: recs.length > 0 ? recs : undefined,
    confidence: { strongSignals: strongSignals.slice(0, 4), contested: contested.slice(0, 3) },
    limitations: limitations.length > 0 ? limitations : undefined,
  };
  return { draft: out, rejected };
}

export function storeReport(storage: Storage, world: World, draft: ReportDraft, focus: string): ReportRecord {
  const latest = storage.latestReport(world.id);
  const version = (latest?.version ?? 0) + 1;
  const record = storage.insertReport(world.id, { version, focus, narrative: draft, path: "" });
  storage.setStage(world.id, "reported");
  return record;
}

// ---------------------------------------------------------------------------
// Markdown rendering — engine evidence blocks woven around the LLM narrative
// ---------------------------------------------------------------------------

function shareBar(share: number, width = 24): string {
  const filled = Math.round(clamp(share, 0, 1) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function dirArrow(d: EntityTrend["direction"]): string {
  return d === "up" ? "↑ improving" : d === "down" ? "↓ worsening" : d === "flat" ? "→ flat" : "· untracked";
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : (v > 0 ? "+" : "") + v.toFixed(2);
}

function quoteLine(q: { id: string; by: string; round: number; plat: string; body: string; sentiment: number; attrSentiment?: number; engagement?: number }, focusName?: string): string {
  const sent =
    focusName && q.attrSentiment !== undefined
      ? `sentiment toward ${focusName} ${fmt(q.attrSentiment)}`
      : `sentiment ${fmt(q.sentiment)}`;
  return `> **${q.id}** · ${q.by} · ${q.plat === "tw" ? "twitter" : "reddit"} · round ${q.round} · ${sent}${q.engagement !== undefined ? ` · engagement ${q.engagement}` : ""}\n>\n> ${truncate(q.body, 220).replace(/\n+/g, " ")}`;
}

/** Everything both renderers (Markdown + HTML dashboard) compute from a
 * recorded run — a single source of truth so the .md and the .html can never
 * disagree on a number, a quote or a faction split. */
export interface ReportData {
  entities: Entity[];
  personas: Persona[];
  posts: Post[];
  handles: Map<string, string>;
  rows: ReturnType<typeof timeline>;
  mentionCount: (id: string) => number;
  focusEntity: Entity | null;
  mom: MomentumAnalysis;
  moments: TimelineMoment[];
  quotes: QuoteBank;
  factions: FactionAnalysis;
  arcs: ReturnType<typeof personaArcs>;
  controversy: ControversyAnalysis;
  cross: CrossPlatformAnalysis;
  trends: EntityTrend[];
  focusCurve: { round: number; value: number }[];
  projection: Projection | null;
  /** Seeded P10–P50–P90 bands for the focus entity's projection; null when disabled. */
  ensemble: EnsembleInterval[] | null;
  amp: AmplificationInfo;
  chains: ReturnType<typeof allEscalations>;
  topBoard: ReturnType<typeof leaderboards>;
  charted: Entity[];
  totalPosts: number;
  totalEng: number;
  dominant: EntityTrend | null;
  injections: { round: number; text: string }[];
  date: string;
}

export function collectReportData(storage: Storage, world: World, report: ReportRecord): ReportData {
  const entities = [...storage.listEntities(world.id)].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
  const personas = storage.listPersonas(world.id);
  const posts = storage.listPosts(world.id, { limit: 100000 });
  const handles = new Map(personas.map((p) => [p.id, `${p.name} (${p.handle})`]));
  const rows = timeline(storage, world);

  const mentionCount = (id: string) => posts.filter((p) => p.mentions.some((m) => m.entityId === id)).length;
  const orgish = (e: Entity) => e.type === "org" || e.type === "product" || e.type === "person";
  const wbMatch = (haystack: string, name: string) =>
    new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(haystack);
  const wanted = report.focus.toLowerCase();
  const focusEntity =
    entities.filter((e) => orgish(e)).find((e) => wbMatch(wanted, e.name)) ??
    [...entities].filter((e) => orgish(e)).sort((a, b) => mentionCount(b.id) - mentionCount(a.id) || b.salience - a.salience)[0] ??
    [...entities].sort((a, b) => mentionCount(b.id) - mentionCount(a.id) || b.salience - a.salience)[0] ??
    null;
  const mom = momentum(rows);
  const moments = narrativeTimeline(storage, world, 8);
  // quote ownership: the flagship "crowd said" section claims its quotes
  // first, faction cards draw next, and the spotlight takes what is left —
  // every section shows fresh voices, and every crowd-said quote provably
  // names the focus entity
  const quotes = quoteBank(storage, world, focusEntity, 3);
  const quotedIds = new Set<string>();
  for (const bucket of [quotes.positive, quotes.negative, quotes.mixed]) for (const q of bucket) quotedIds.add(q.id);
  const factions = factionAnalysis(storage, world, focusEntity, quotedIds);
  for (const f of factions.factions) for (const q of f.quotes) quotedIds.add(q.id);
  const arcs = personaArcs(storage, world, focusEntity, 3, quotedIds);
  const controversy = controversyIndex(storage, world, factions);
  const cross = crossPlatform(storage, world, entities);
  const trends = entityTrends(storage, world, entities, (e) => sentimentCurve(storage, world, e), 6);
  const focusCurve = focusEntity ? sentimentCurve(storage, world, focusEntity) : [];
  const projection = focusCurve.length >= 2 ? projectCurve(focusCurve, 2) : null;
  const ensemble = projection ? ensembleIntervals(projectionEnsemble(world.seed, world.config.ensemble?.runCount ?? 5, focusCurve, projection)) : null;
  const amp = amplification(storage, world);
  const chains = allEscalations(storage, world).sort((a, b) => b.severity - a.severity || a.rootId.localeCompare(b.rootId));
  const topBoard = leaderboards(storage, world, 8);
  const totalPosts = posts.filter((p) => p.kind !== "repost").length;
  const totalEng = rows.reduce((a, r) => a + r.engagement, 0);
  const dominant = trends.slice().sort((a, b) => b.volume - a.volume)[0];
  const injections = storage.listEvents(world.id, { type: "injection" }).sort((a, b) => a.round - b.round);
  const date = (report.createdAt || world.createdAt).slice(0, 10);
  // chart the entities that actually have sentiment history: the focus entity
  // first, then the most-discussed ones (salience order often has no curve)
  const chartCandidates = [
    ...(focusEntity ? [focusEntity] : []),
    ...[...entities].sort((a, b) => mentionCount(b.id) - mentionCount(a.id) || b.salience - a.salience),
  ];
  const charted: Entity[] = [];
  for (const e of chartCandidates) {
    if (charted.length >= 3) break;
    if (charted.some((x) => x.id === e.id)) continue;
    if (sentimentCurve(storage, world, e).length >= 2) charted.push(e);
  }
  return {
    entities, personas, posts, handles, rows, mentionCount, focusEntity, mom, moments,
    quotes, factions, arcs, controversy, cross, trends, focusCurve, projection, ensemble, amp,
    chains, topBoard, charted, totalPosts, totalEng, dominant,
    injections: injections.map((ev) => ({ round: ev.round, text: String((ev.payload as { text?: string })?.text ?? "") })),
    date,
  };
}

export function renderReportMarkdown(storage: Storage, world: World, report: ReportRecord): string {
  const {
    entities, personas, posts, handles, rows, mentionCount, focusEntity, mom, moments,
    quotes, factions, arcs, controversy, cross, trends, focusCurve, projection, ensemble, amp,
    chains, topBoard, charted, totalPosts, totalEng, dominant, injections, date,
  } = collectReportData(storage, world, report);
  const d = report.narrative;

  const L: string[] = [];

  // ---- header ---------------------------------------------------------------
  L.push(`# Murmur Prediction Report — ${world.name}`);
  L.push("");
  if (world.description) {
    L.push(`> ${truncate(world.description, 240)}`);
    L.push("");
  }
  L.push(`**Version** ${report.version} · **Scenario** \`${world.slug}\` · **Generated** ${date} · **Seed** \`${world.seed}\``);
  L.push("");
  L.push(`**Rounds** ${world.round} · **Population** ${personas.length} personas · **Ontology** ${entities.length} entities · **Platforms** Twitter + Reddit`);
  L.push("");
  L.push(`**Focus** — ${report.focus || "general community reaction"}`);
  L.push("");
  L.push(
    `> Deterministic statistics computed by the Murmur engine; narrative drafted by the host coding agent around those numbers. ` +
      `Reproduce this report by re-running world \`${world.slug}\` with seed \`${world.seed}\` and the same host model — every number below is a pure function of the recorded run.`
  );
  L.push("");
  L.push("---");
  L.push("");

  // ---- at a glance ------------------------------------------------------------
  L.push("## At a Glance");
  L.push("");
  L.push(`| Simulated posts | Total engagement | Escalation chains | Viral posts | Controversy | Momentum | Most-discussed entity |`);
  L.push(`|---|---|---|---|---|---|---|`);
  L.push(
    `| ${totalPosts} | ${totalEng} | ${chains.length} | ${amp.viralPosts.length} | **${controversy.label}** ${controversy.score}/100 | ${mom.trend}${mom.pct !== 0 ? ` (${mom.pct > 0 ? "+" : ""}${Math.round(mom.pct * 100)}%)` : ""} | ${dominant ? dominant.entity : "—"} |`
  );
  L.push("");
  L.push(`**Verdict —** ${factions.verdict} Controversy reads **${controversy.label}** (${controversy.score}/100).`);
  L.push("");

  // ---- 1. executive summary ----------------------------------------------------
  L.push("## 1. Executive Summary");
  L.push("");
  L.push(d.executiveSummary);
  L.push("");

  // ---- 2. scenario & population ------------------------------------------------
  L.push("## 2. Scenario & Population");
  L.push("");
  if (d.scenarioRecap) {
    L.push(d.scenarioRecap);
  } else {
    L.push(
      `A population of ${personas.length} simulated users across ${entities.length} ontology entities evolved over ${world.round} rounds of dual-platform social mechanics. ` +
        `${injections.length > 0 ? `${injections.length} external event${injections.length === 1 ? "" : "s"} were injected mid-run to stress the reaction. ` : "No external events were injected — the run tracks organic evolution. "}` +
        `The analysis focuses on ${report.focus || "general community reaction"}.`
    );
  }
  L.push("");
  L.push("### Entities under watch");
  L.push("");
  L.push("| Entity | Type | Salience | Mentions | Motive |");
  L.push("|---|---|---|---|---|");
  for (const e of entities.slice(0, 8)) {
    L.push(`| ${e.name} | ${e.type} | ${e.salience.toFixed(2)} | ${mentionCount(e.id)} | ${truncate(e.motives[0] ?? "—", 90)} |`);
  }
  L.push("");
  const mix = new Map<string, { count: number; plats: Set<string> }>();
  for (const p of personas) {
    const m = mix.get(p.archetype) ?? { count: 0, plats: new Set<string>() };
    m.count++;
    m.plats.add(p.platform);
    mix.set(p.archetype, m);
  }
  L.push("### Population mix");
  L.push("");
  L.push("| Archetype | Personas | Platforms |");
  L.push("|---|---|---|");
  for (const [arch, m] of [...mix.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
    L.push(`| ${arch} | ${m.count} | ${[...m.plats].sort().join(" + ")} |`);
  }
  L.push("");
  if (injections.length > 0) {
    L.push("### Injected events");
    L.push("");
    L.push("| Round | Event |");
    L.push("|---|---|");
    for (const ev of injections) {
      L.push(`| ${ev.round} | ${truncate(ev.text, 160)} |`);
    }
    L.push("");
  }

  // ---- 3. key findings -----------------------------------------------------------
  const findings = d.keyFindings && d.keyFindings.length > 0 ? d.keyFindings : engineFindings(factions, controversy, mom, cross, amp);
  if (findings.length > 0) {
    L.push("## 3. Key Findings");
    L.push("");
    findings.forEach((f, i) => L.push(`${i + 1}. **${f}**`));
    L.push("");
  }

  // ---- 4. market reaction ----------------------------------------------------------
  L.push("## 4. Market Reaction");
  L.push("");
  if (charted.length > 0) {
    const curves = charted.map((e) => ({ e, c: sentimentCurve(storage, world, e) }));
    const xaxis = Array.from({ length: world.round }, (_, i) => i + 1);
    L.push("### Sentiment toward the top entities");
    L.push("");
    L.push("```mermaid");
    L.push("xychart-beta");
    L.push(`    title "Sentiment by round - ${escapeMermaid(charted.map((e) => e.name).join(" / "))}"`);
    L.push(`    x-axis [${xaxis.join(", ")}]`);
    L.push('    y-axis "sentiment" -1 --> 1');
    for (const { c } of curves) {
      const series = xaxis.map((r) => {
        const hit = c.find((p) => p.round === r);
        return hit ? hit.value.toFixed(2) : "0";
      });
      L.push(`    line [${series.join(", ")}]`);
    }
    L.push("```");
    L.push("");
    L.push(`Lines, in chart order: ${charted.map((e) => `**${e.name}**`).join(", ")}.`);
    L.push("");
  }
  L.push("### Entity trend");
  L.push("");
  L.push("| Entity | Type | First reading | Last reading | Δ | Direction | Mentions | Peak round |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const t of trends) {
    L.push(`| ${t.entity} | ${t.type} | ${fmt(t.first)} | ${fmt(t.last)} | ${fmt(t.delta)} | ${dirArrow(t.direction)} | ${t.volume} | ${t.peakRound ?? "—"} |`);
  }
  L.push("");
  L.push(
    `Engagement is **${mom.trend}** — ${mom.firstHalf} in the first half of the run vs ${mom.secondHalf} in the second (${mom.pct > 0 ? "+" : ""}${Math.round(mom.pct * 100)}%).` +
      (mom.trend === "quiet" ? " The run stayed low-volume throughout." : "")
  );
  L.push("");
  if (quotes.positive.length > 0 || quotes.negative.length > 0 || quotes.mixed.length > 0) {
    L.push(`### What the crowd actually said${focusEntity ? ` about ${focusEntity.name}` : ""}`);
    L.push("");
    if (quotes.positive.length > 0) {
      L.push("**Champions said**");
      L.push("");
      for (const q of quotes.positive) {
        L.push(quoteLine(q, focusEntity?.name));
        L.push("");
      }
    }
    if (quotes.negative.length > 0) {
      L.push("**Critics said**");
      L.push("");
      for (const q of quotes.negative) {
        L.push(quoteLine(q, focusEntity?.name));
        L.push("");
      }
    }
    if (quotes.mixed.length > 0) {
      L.push("**On the fence**");
      L.push("");
      for (const q of quotes.mixed) {
        L.push(quoteLine(q, focusEntity?.name));
        L.push("");
      }
    }
  }

  // ---- 5. faction map --------------------------------------------------------------
  L.push("## 5. Faction Map");
  L.push("");
  L.push("```mermaid");
  L.push("pie showData");
  L.push(`    title "Population split - ${escapeMermaid(factions.focusEntity)}"`);
  const pieRows = factions.factions.filter((f) => f.size > 0);
  for (const f of pieRows) {
    L.push(`    "${f.label} (${f.size})" : ${f.size}`);
  }
  L.push("```");
  L.push("");
  L.push(`Polarization: **${(factions.polarization * 100).toFixed(0)}/100** — ${factions.polarization >= 0.6 ? "the population has hardened into opposing camps" : factions.polarization >= 0.35 ? "camps are forming but the middle is still contested" : "the population has not yet hardened"}.`);
  L.push("");
  for (const f of factions.factions) {
    if (f.size === 0) continue;
    L.push(`### ${f.label} — ${f.size} ${f.size === 1 ? "persona" : "personas"} (${Math.round(f.share * 100)}%)`);
    L.push("");
    L.push("`" + shareBar(f.share) + "`");
    L.push("");
    L.push(`Average stance ${fmt(f.avgStance)} · ${f.posts} posts · ${f.engagement} engagement received.`);
    L.push("");
    if (f.leaders.length > 0) {
      L.push(`**Leading voices:** ${f.leaders.map((l) => `${l.handle} (${l.archetype}, stance ${fmt(l.stance)}, ${l.posts} posts)`).join(" · ")}`);
      L.push("");
    }
    for (const q of f.quotes) {
      L.push(quoteLine(q, focusEntity ? factions.focusEntity : undefined));
      L.push("");
    }
    if (f.sentimentByRound.length >= 2) {
      L.push(
        `Faction sentiment toward ${factions.focusEntity} moved from ${fmt(f.sentimentByRound[0].value)} (round ${f.sentimentByRound[0].round}) to ${fmt(f.sentimentByRound[f.sentimentByRound.length - 1].value)} (round ${f.sentimentByRound[f.sentimentByRound.length - 1].round}).`
      );
      L.push("");
    }
  }

  // ---- 6. platform divergence --------------------------------------------------------
  L.push("## 6. Platform Divergence");
  L.push("");
  L.push("| Metric | Twitter | Reddit |");
  L.push("|---|---|---|");
  L.push(`| Posts | ${cross.totals.twitterPosts} | ${cross.totals.redditPosts} |`);
  L.push(`| Engagement | ${cross.totals.twitterEngagement} | ${cross.totals.redditEngagement} |`);
  L.push(`| Escalation chains | ${cross.totals.twitterEscalations} | ${cross.totals.redditEscalations} |`);
  L.push("");
  const withBoth = cross.rows.filter((r) => r.twitter !== null && r.reddit !== null);
  if (withBoth.length > 0) {
    L.push("| Entity | Twitter sentiment | Reddit sentiment | Divergence |");
    L.push("|---|---|---|---|");
    for (const r of cross.rows) {
      L.push(`| ${r.entity} | ${fmt(r.twitter)} (${r.twPosts} posts) | ${fmt(r.reddit)} (${r.rdPosts} posts) | ${r.divergence.toFixed(2)} |`);
    }
    L.push("");
    if (cross.maxDivergence && cross.maxDivergence.value >= 0.2) {
      L.push(
        `The largest split is **${cross.maxDivergence.entity}** (Δ ${cross.maxDivergence.value.toFixed(2)} between platforms) — the same story is landing differently on Twitter than on Reddit, which usually means different framings are winning in each venue.`
      );
      L.push("");
    }
  }

  // ---- 7. persona spotlight ------------------------------------------------------------
  if (arcs.length > 0) {
    L.push("## 7. Persona Spotlight");
    L.push("");
    for (const a of arcs) {
      L.push(`### ${a.name} (${a.handle}) — ${a.archetype}`);
      L.push("");
      L.push(`*${a.bio}*`);
      L.push("");
      L.push(
        `${a.posts} posts · ${a.engagement} engagement received · platform ${a.platform} · arc: **${a.arcLabel}** (stance ${fmt(a.focusStart)} → ${fmt(a.focusEnd)}${a.delta !== 0 ? `, shift ${fmt(a.delta)}` : ""})`
      );
      L.push("");
      L.push("```");
      L.push(`before ${stanceBar(a.focusStart)}`);
      L.push(`after  ${stanceBar(a.focusEnd)}`);
      L.push("```");
      if (a.signatureQuote) {
        L.push(quoteLine(a.signatureQuote, focusEntity?.name));
      }
      L.push("");
    }
  }

  // ---- 8. simulated projection ----------------------------------------------------------------
  L.push("## 8. Trajectory Simulated Projection");
  L.push("");
  if (projection && focusEntity && ensemble && ensemble.length > 0) {
    // Ensemble UQ: seeded P10–P50–P90 bands replace the old 2-point line.
    const runs = world.config.ensemble?.runCount ?? 5;
    L.push(
      `**Simulated projection — seeded ensemble of ${runs} runs.** Each run refits the observed curve with per-run slope jitter (seeds \`${world.seed}:0\`…\`${world.seed}:${runs - 1}\`). ` +
        `Recorded rounds are identical in every run, so the band only opens on projected rounds — it quantifies model spread, not real-world uncertainty.`
    );
    L.push("");
    L.push("| Round | P10 | P50 | P90 |");
    L.push("|---|---|---|---|");
    for (const b of ensemble) {
      L.push(`| ${b.round} | ${fmt(b.p10)} | ${fmt(b.p50)} | ${fmt(b.p90)} |`);
    }
    L.push("");
  } else if (projection && focusEntity) {
    L.push("```mermaid");
    L.push("xychart-beta");
    L.push(`    title "Outlook - ${escapeMermaid(focusEntity.name)} (last ${projection.points.filter((p) => p.projected).length} rounds extrapolated)"`);
    L.push(`    x-axis [${projection.points.map((p) => p.round).join(", ")}]`);
    L.push('    y-axis "sentiment" -1 --> 1');
    L.push(`    line [${projection.points.map((p) => p.value.toFixed(2)).join(", ")}]`);
    L.push("```");
    L.push("");
    L.push(
      `Simulated projection — single-run trend for **${focusEntity.name}** (least-squares over this run only, assuming no new external events; no uncertainty band): slope ${projection.slope >= 0 ? "+" : ""}${projection.slope.toFixed(2)} per round → ` +
        projection.points
          .filter((p) => p.projected)
          .map((p) => `round ${p.round} ≈ ${fmt(p.value)}`)
          .join(", ") +
        `. Direction: **${projection.direction}**.`
    );
    L.push("");
  }
  L.push(d.trajectory);
  L.push("");

  // ---- 9. risk register ---------------------------------------------------------------------
  L.push("## 9. Risk Register");
  L.push("");
  if (d.risks.length > 0) {
    L.push("| # | Risk | Severity | Likelihood | Evidence |");
    L.push("|---|---|---|---|---|");
    d.risks.forEach((r, i) => {
      L.push(`| R${i + 1} | ${r.title} | ${(r.severity ?? "medium").toUpperCase()} | ${(r.likelihood ?? "medium").toUpperCase()} | ${r.postIds.map((id) => `\`${id}\``).join(", ")} |`);
    });
    L.push("");
    d.risks.forEach((r, i) => {
      L.push(`### R${i + 1}. ${r.title}`);
      L.push("");
      L.push(`**Severity** ${(r.severity ?? "medium").toUpperCase()} · **Likelihood** ${(r.likelihood ?? "medium").toUpperCase()}`);
      L.push("");
      L.push(r.rationale);
      L.push("");
      if (r.mitigation) {
        L.push(`**Mitigation —** ${r.mitigation}`);
        L.push("");
      }
      if (r.trigger) {
        L.push(`**Early-warning trigger —** ${r.trigger}`);
        L.push("");
      }
      L.push("**Evidence from the run:**");
      L.push("");
      for (const pid of r.postIds) {
        const p = storage.getPost(world.id, pid);
        if (p) {
          L.push(quoteLine({ id: p.id, by: handles.get(p.personaId) ?? p.personaId, round: p.round, plat: p.platform === "twitter" ? "tw" : "rd", body: p.body, sentiment: postSentiment(p), engagement: engagementScore(p.metrics) }));
          L.push("");
        }
      }
    });
  }

  // ---- 10. recommendations ----------------------------------------------------------------------
  if (d.recommendations && d.recommendations.length > 0) {
    L.push("## 10. Recommendations");
    L.push("");
    d.recommendations.forEach((r, i) => {
      L.push(`**${i + 1}. ${r.title}.** ${r.action}`);
      L.push("");
      L.push(`*Expected impact:* ${r.expectedImpact}`);
      L.push("");
    });
  }

  // ---- 11. confidence & limitations -----------------------------------------------------------------
  L.push("## 11. Confidence & Limitations");
  L.push("");
  L.push("**Strong signals** (multiple posts, consistent sentiment):");
  L.push("");
  for (const s of d.confidence.strongSignals) L.push(`- ${s}`);
  L.push("");
  if (d.confidence.contested.length > 0) {
    L.push("**Contested** (population split):");
    L.push("");
    for (const s of d.confidence.contested) L.push(`- ${s}`);
    L.push("");
  }
  const limitations = d.limitations && d.limitations.length > 0 ? d.limitations : defaultLimitations(personas.length);
  L.push("**Limitations:**");
  L.push("");
  for (const s of limitations) L.push(`- ${s}`);
  L.push("");

  // ---- narrative timeline --------------------------------------------------------------------------
  if (moments.length > 0) {
    L.push("## Timeline of the Run — the moments a launch team would replay");
    L.push("");
    for (const m of moments) {
      L.push(`- **Round ${m.round}** · ${m.kind}: ${m.text}${m.postIds.length > 0 ? ` (${m.postIds.map((id) => `\`${id}\``).join(", ")})` : ""}`);
    }
    L.push("");
  }

  // ---- appendix A -------------------------------------------------------------------------------------
  L.push("## Appendix A — Round-by-Round Statistics");
  L.push("");
  L.push("| Round | Twitter | Reddit | Engagement | Escalations | Injections | Lurkers |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    L.push(`| ${r.round} | ${r.twitter} | ${r.reddit} | ${r.engagement} | ${r.escalations} | ${r.injections} | ${r.lurkers} |`);
  }
  L.push("");
  if (rows.length >= 2) {
    L.push("```mermaid");
    L.push("xychart-beta");
    L.push('    title "Engagement by round"');
    L.push(`    x-axis [${rows.map((r) => r.round).join(", ")}]`);
    const maxEng = Math.max(...rows.map((r) => r.engagement), 1);
    L.push(`    y-axis "engagement" 0 --> ${Math.ceil(maxEng * 1.25)}`);
    L.push(`    bar [${rows.map((r) => r.engagement).join(", ")}]`);
    L.push("```");
    L.push("");
  }
  const peaks = engagementPeaks(rows);
  if (peaks.length > 0) L.push(`Engagement peaks (mean + 2σ): rounds ${peaks.join(", ")}.`);
  L.push("");

  // ---- appendix B ---------------------------------------------------------------------------------------
  L.push("## Appendix B — Escalation Chains");
  L.push("");
  if (chains.length > 0) {
    L.push("Reply/comment threads where sentiment intensified as the thread deepened — each step is a real post.");
    L.push("");
    for (const c of chains.slice(0, 4)) {
      L.push(`**Chain \`${c.rootId}\`** · depth ${c.depth} · final sentiment ${fmt(c.finalSentiment)} · severity ${c.severity.toFixed(2)}`);
      L.push("");
      let idx = 0;
      for (const pid of c.path) {
        const p = storage.getPost(world.id, pid);
        if (!p) continue;
        L.push(`${"  ".repeat(idx)}${idx === 0 ? "→" : "↳"} **${pid}** ${handles.get(p.personaId) ?? p.personaId}: "${truncate(p.body, 140)}"`);
        idx++;
      }
      L.push("");
    }
  } else {
    L.push("No escalation chains formed this run — disagreement stayed at post level instead of threading into reply spirals. That caps how fast either camp can recruit: intensity has nowhere to compound.");
    L.push("");
  }

  // ---- appendix C ------------------------------------------------------------------------------------------
  L.push("## Appendix C — Amplification");
  L.push("");
  if (amp.viralPosts.length > 0) {
    L.push("| Post | By | Round | Engagement | Amplified by | Excerpt |");
    L.push("|---|---|---|---|---|---|");
    for (const v of amp.viralPosts) {
      L.push(`| \`${v.id}\` | ${v.by} | ${v.round} | ${v.engagement} | ${v.amplifiers.length > 0 ? v.amplifiers.join(", ") : "organic reach"} | ${truncate(v.body, 90).replace(/\|/g, "\\|")} |`);
    }
    L.push("");
  } else {
    L.push("No post crossed the virality threshold this run — reach stayed inside the follow graph.");
    L.push("");
  }
  L.push(`Organic (engine-simulated bystander) engagement share: **${Math.round(amp.organicEngagementShare * 100)}%** — the rest came from activated personas engaging each other's content.`);
  L.push("");

  // ---- appendix D ----------------------------------------------------------------------------------------------
  L.push("## Appendix D — Post Index (evidence)");
  L.push("");
  L.push("| Id | By | Plat | R | Sentiment | Engagement | Excerpt |");
  L.push("|---|---|---|---|---|---|---|");
  for (const { post, sentiment } of topPostsByEngagement(storage, world, 25)) {
    const eng = engagementScore(post.metrics);
    L.push(`| ${post.id} | ${handles.get(post.personaId) ?? post.personaId} | ${post.platform === "twitter" ? "tw" : "rd"} | ${post.round} | ${fmt(sentiment)} | ${eng} | ${truncate(post.body, 90).replace(/\|/g, "\\|")} |`);
  }
  L.push("");

  // ---- appendix E ---------------------------------------------------------------------------------------------
  L.push("## Appendix E — Methodology & Reproducibility");
  L.push("");
  L.push(
    `Each round the engine activated a weighted subset of the ${personas.length}-persona population, composed personalized feeds from the follow graph and platform mechanics, ` +
      `and the host LLM wrote posts, replies and votes in character. Organic engagement, virality, stance migration (10%/round toward expressed sentiment), pairwise influence over the follow graph (Deffuant bounded confidence: ε=${world.config.dynamics?.epsilon ?? 0.4}, μ=${world.config.dynamics?.mu ?? 0.2}, ${(world.config.dynamics?.abstentionChance ?? 0.1) * 100}% chance of slight disengagement beyond ε) and escalation chains are deterministic functions of the recorded run. ` +
      `Sentiment is a lexical score over real post text, attributed to entities by mention. The report narrative was drafted by the host coding agent against the statistics pack; every quoted post id resolves to a stored post.`
  );
  L.push("");
  L.push(`**Reproduce:** initialize a world with seed \`${world.seed}\`, attach the same seeds, and drive the same host model through the plan/submit protocol. The engine's state — and therefore every number in this report — replays identically.`);
  L.push("");
  L.push(`**Leaderboard (top voices):** ${topBoard.map((l) => `${l.handle} (${l.archetype}, ${l.posts} posts, ${l.engagementReceived} engagement)`).join(" · ")}`);
  L.push("");
  return L.join("\n");
}

function engineFindings(factions: FactionAnalysis, controversy: ControversyAnalysis, mom: MomentumAnalysis, cross: CrossPlatformAnalysis, amp: AmplificationInfo): string[] {
  const out: string[] = [];
  const sup = factions.factions.find((f) => f.key === "supporters");
  const opp = factions.factions.find((f) => f.key === "opponents");
  if (sup && opp) out.push(`The population split ${sup.size} supporters vs ${opp.size} opponents around ${factions.focusEntity} (polarization ${(factions.polarization * 100).toFixed(0)}/100).`);
  out.push(`Controversy index ${controversy.score}/100 (${controversy.label}) — ${controversy.drivers.map((d) => d.label).join("; ")}.`);
  out.push(`Engagement is ${mom.trend} (${mom.pct > 0 ? "+" : ""}${Math.round(mom.pct * 100)}% second half vs first half).`);
  if (cross.maxDivergence && cross.maxDivergence.value >= 0.15) out.push(`Platforms disagree most on ${cross.maxDivergence.entity} (Δ ${cross.maxDivergence.value.toFixed(2)} between Twitter and Reddit sentiment).`);
  if (amp.viralPosts.length > 0) out.push(`${amp.viralPosts.length} post${amp.viralPosts.length === 1 ? "" : "s"} crossed the virality threshold; organic bystanders contributed ${Math.round(amp.organicEngagementShare * 100)}% of engagement.`);
  return out.slice(0, 5);
}

function defaultLimitations(population: number): string[] {
  return [
    `The simulated population is ${population} personas — directional, not a census; treat percentages as tendencies.`,
    "Sentiment is lexical over simulated text; irony and coded language can under- or over-score.",
    "Extrapolations assume no new external events; real launches rarely get that courtesy.",
  ];
}

export function entityById(entities: Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

export function clampReportFocus(focus: string | undefined): string {
  return clamp((focus ?? "").trim().length, 0, 200) === (focus ?? "").trim().length ? (focus ?? "").trim() : (focus ?? "").trim().slice(0, 200);
}

export type { Post, World, Persona };
