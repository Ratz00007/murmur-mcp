/**
 * @murmur/engine — deterministic, LLM-free social-simulation engine.
 *
 * Pure core + SQLite storage adapter. The engine never calls a model, never
 * touches the network, and produces byte-identical state transitions for
 * identical seeds, parameters and submitted generations.
 */
export * from "./types.js";
export { hashString, hashHex, mulberry32, Rng, streamRng } from "./util/rng.js";
export {
  clamp,
  round2Safe,
  estTokens,
  estTokensJson,
  nowIso,
  truncate,
  slugify,
  escapeMermaid,
  sentimentLabel,
  stanceBar,
  stableStringify,
  splitSentences,
  topKeywords,
  wordCount,
  normalizeName,
} from "./util/text.js";
export { openDatabase, Storage } from "./store/storage.js";
export { SCHEMA_VERSION, MIGRATIONS } from "./store/schema.js";
export { Workspace, findWorkspaceRoot } from "./worlddir.js";
export { extractPdfText } from "./ingest/pdf.js";
export { makeDigest, coverageStats, MAX_SEED_BYTES } from "./ingest/digest.js";
export { buildOntologyTask, applyOntology, ONTOLOGY_INSTRUCTIONS, normalizeSubmission } from "./ontology.js";
export {
  deriveRelations,
  buildCommunities,
  buildFollowGraph,
  buildGraph,
  graphQuery,
  toMermaid,
  findEntity,
  stanceCosine,
  communitiesFor,
} from "./graph.js";
export { buildPersonasTask, applyPersonas, personaCard, personaPatch, ARCHETYPES, PERSONAS_INSTRUCTIONS } from "./personas.js";
export { scoreSentiment, entityMentions, round2 } from "./sentiment.js";
export { activatePersonas, engagementOf } from "./sim/activation.js";
export { buildFeed, twitterScore, redditScore, engagementNorm, trendingEntities } from "./sim/feed.js";
export { buildSimBatch, buildPersonaDigest, batchBrief, SIM_INSTRUCTIONS } from "./sim/batch.js";
export { submitGenerations } from "./sim/ingest.js";
export { workingMemory, appendEpisodic, compactIfNeeded, collectiveView, memoryTimeline } from "./memory.js";
export {
  escalationChains,
  postSentiment,
  leaderboards,
  timeline,
  engagementPeaks,
  sentimentCurve,
  topPostsByEngagement,
  computeMovers,
  buildRoundStats,
  mean,
} from "./aggregate.js";
export {
  factionAnalysis,
  controversyIndex,
  crossPlatform,
  entityTrends,
  personaArcs,
  quoteBank,
  narrativeTimeline,
  momentum,
  projectCurve,
  amplification,
} from "./analytics.js";
export {
  buildReportTask,
  validateReportDraft,
  storeReport,
  renderReportMarkdown,
  REPORT_INSTRUCTIONS,
} from "./report.js";
export {
  buildInterviewPack,
  buildAskPack,
  qaEntry,
  INTERVIEW_INSTRUCTIONS,
  ASK_INSTRUCTIONS,
} from "./interact.js";
export { worldStatus, roundSummary, worldListRow } from "./stats.js";
