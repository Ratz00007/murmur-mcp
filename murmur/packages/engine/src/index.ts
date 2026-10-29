/**
 * @murmur/engine — deterministic, LLM-free social-simulation engine.
 *
 * Pure core + SQLite storage adapter. The engine never calls a model, never
 * touches the network, and produces byte-identical state transitions for
 * identical seeds, parameters and submitted generations.
 */
export * from "./types.js";
export { hashString, hashHex, mulberry32, Rng, streamRng } from "./util/rng.js";
export { engagementOf, engagementScore } from "./util/engagement.js";
export {
  clamp,
  round2Safe,
  estTokens,
  estTokensJson,
  escapeRegExp,
  FETCH_ALL,
  fmtSigned,
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
export * from "./ingest/discourse/index.js";
export * from "./ingest/corpus/index.js";
export {
  buildOntologyTask,
  applyOntology,
  ONTOLOGY_INSTRUCTIONS,
  normalizeSubmission,
} from "./ontology.js";
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
export {
  buildPersonasTask,
  applyPersonas,
  personaCard,
  personaPatch,
  ARCHETYPES,
  PERSONAS_INSTRUCTIONS,
} from "./personas.js";
export { scoreSentiment, entityMentions, round2 } from "./sentiment.js";
export { activatePersonas } from "./sim/activation.js";
export {
  buildFeed,
  twitterScore,
  redditScore,
  engagementNorm,
  trendingEntities,
  computeOutrageMultiplier,
  computeTheRatio,
  calculateKOLWeight,
  rankFeedPostsWithKOL,
  type TheRatioResult,
  type FeedPostKOLCandidate,
  type RankedFeedPostKOLResult,
} from "./sim/feed.js";
export {
  buildSimBatch,
  buildPersonaDigest,
  batchBrief,
  SIM_INSTRUCTIONS,
} from "./sim/batch.js";
export { submitGenerations } from "./sim/ingest.js";
export { deffuantUpdate, applyOpinionDynamics } from "./dynamics/opinion.js";
export type {
  DeffuantParams,
  DeffuantResult,
  OpinionAgent,
  OpinionDynamicsParams,
  OpinionStanceChange,
  OpinionDynamicsResult,
} from "./dynamics/opinion.js";
export {
  sensitivityIntervals,
  refitSpread,
  projectionRefits,
  MAX_SENSITIVITY_REFITS,
} from "./dynamics/sensitivity.js";
export type {
  TrajectoryPoint,
  SensitivityInterval,
} from "./dynamics/sensitivity.js";
export { calibrate, ENGAGEMENT_BOUNDS } from "./calibrate/calibrate.js";
export type { ParamBound, CalibrateResult } from "./calibrate/calibrate.js";
export {
  workingMemory,
  appendEpisodic,
  compactIfNeeded,
  collectiveView,
  memoryTimeline,
} from "./memory.js";
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
  collectReportData,
  REPORT_INSTRUCTIONS,
  type ReportData,
} from "./report.js";
export { renderReportHtml } from "./report-html.js";
export {
  buildDossierTask,
  validateDossierDraft,
  renderDossierMarkdown,
  DOSSIER_INSTRUCTIONS,
  type DossierDraft,
  type DossierObjection,
} from "./dossier.js";
export {
  verifyNumericClaims,
  extractNumbers,
  allowedNumbers,
  type ClaimVerdict,
  type NumericClaim,
} from "./report-claims.js";
export {
  buildInterviewPack,
  buildAskPack,
  qaEntry,
  INTERVIEW_INSTRUCTIONS,
  ASK_INSTRUCTIONS,
} from "./interact.js";
export { worldStatus, roundSummary, worldListRow } from "./stats.js";

// Macro-Micro Multi-Scale Modeling Engine (M3)
export {
  MacroCompartment,
  type MacroCompartmentType,
  type MacroGraphState,
  type MacroStepResult,
  type MacroGraphInitOptions,
  type MacroStepOptions,
  type MacroSnapshotRow,
  createMacroGraphState,
  stepMacroGraph,
  serializeMacroGraph,
  deserializeMacroGraph,
  saveMacroSnapshot,
  loadMacroSnapshot,
  persistMacroNodesRelational,
  persistMacroEdgesRelational,
} from "./dynamics/macro-graph.js";

export {
  type MacroPriorSummary,
  type SemanticShockwave,
  type MicroPersonaState,
  type DecoupledSimulationParams,
  type DecoupledSimulationResult,
  formatMacroPriors,
  injectSemanticShockwave,
  updateMicroPersonasFromMacro,
  mapMicroPersonasToMacroShock,
  runDecoupledSimulationRound,
} from "./sim/macro-sim.js";

// Adversarial War Room & Executive Decision Intelligence (Milestone M5)
export {
  type MinimaxDebateTurn,
  type KillingObjection,
  type FragileAssumption,
  type MinimaxDebateVerdict,
  type MinimaxDebateResult,
  executeMinimaxDebate,
} from "./sim/war-room.js";

export {
  type NetARRWaterfallStage,
  type ExecutiveARRRisk,
  type CompetitorMigrationItem,
  type MediaHeadlineItem,
  type VaccineRewriteItem,
  type ExecutiveDecisionReport,
  computeExecutiveARRRisk,
  computeCompetitorMigration,
  generateMediaHeadlines,
  generateVaccineRewrites,
  buildCompleteExecutiveReport,
} from "./report-executive.js";
