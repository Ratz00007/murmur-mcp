/**
 * Interface contracts for Market Twin Simulation Platform.
 * Derived from PROJECT.md § Interface Contracts and TEST_INFRA.md.
 */

export interface DiscoursePost {
  postId: string;
  parentId?: string;
  author: string;
  text: string;
  timestamp: string;
  score: number;
  aspects?: Record<string, number>;
}

export interface DiscourseThread {
  platform: "reddit" | "hackernews" | "twitter" | "github";
  threadId: string;
  title: string;
  author: string;
  url: string;
  timestamp: string;
  metrics: {
    upvotes: number;
    comments: number;
    shares?: number;
  };
  posts: DiscoursePost[];
}

export interface HistoricalBacklashCase {
  id: string; // e.g. "unity-runtime-fee-2023"
  title: string;
  vendor: string;
  announcementDate: string;
  policySummary: string;
  objections: Array<{
    category: string;
    severity: number; // 0 to 10
    claim: string;
  }>;
  timeline: Array<{
    stage: "announcement" | "outrage" | "boycott" | "walkback" | "aftermath";
    daysAfterT0: number;
    headline: string;
    sentimentScore: number; // [-1.0, 1.0]
  }>;
  churnImpact: {
    estimatedARRChurnPercent: number;
    primaryMigrationDestinations: Array<{
      competitor: string;
      inflowShare: number;
    }>;
  };
}

export interface MacroGraphState {
  nodeCount: number;
  edgeCount: number;
  stances: Float32Array; // [-1.0, 1.0]
  outrage: Float32Array; // [0.0, 1.0]
  susceptibility: Float32Array; // [0.0, 1.0]
  kolWeight: Float32Array; // [1.0, 100.0]
  states: Uint8Array; // 0=Susceptible, 1=Exposed, 2=Infected, 3=Contagious, 4=Churned
  rowPointers: Int32Array;
  columnIndices: Int32Array;
  edgeWeights: Float32Array;
}

export interface MacroStepResult {
  round: number;
  meanStance: number;
  outrageIndex: number;
  churnCount: number;
  stateDistribution: {
    susceptible: number;
    exposed: number;
    infected: number;
    contagious: number;
    churned: number;
  };
  durationMs: number;
}

export interface MinimaxDebateTurn {
  role: "prosecution" | "defense" | "adjudicator";
  turnIndex: number;
  claim: string;
  arguments: string[];
  evidence: string[];
}

export interface KillingObjection {
  rank: number;
  title: string;
  economicOrLegalMechanism: string;
  unrebuttableFact: string;
  severityScore: number; // 0 to 10
}

export interface FragileAssumption {
  assumption: string;
  failureCondition: string;
  probabilityOfFailure: number; // 0 to 1
}

export interface MinimaxDebateResult {
  topic: string;
  turns: MinimaxDebateTurn[];
  killingObjections: KillingObjection[];
  fragileAssumptions: FragileAssumption[];
  adjudicatorVerdict: {
    summary: string;
    viabilityScore: number; // 0 to 100
    recommendation: "proceed" | "revise_terms" | "full_retraction";
  };
}

export interface ExecutiveDecisionReport {
  arrRisk: {
    totalARR: number;
    grossARRAtRisk: number;
    expectedChurnLossARR: number;
    baseCaseLoss: number;
    p90CaseLoss: number;
    mitigatedCaseLoss: number;
    netARRWaterfall: Array<{
      stage: string;
      deltaARR: number;
      balance: number;
    }>;
  };
  competitorMigration: Array<{
    competitor: string;
    inflowSharePercent: number;
    migratedAccounts: number;
    migratedARR: number;
    keyDefectionDrivers: string[];
  }>;
  mediaHeadlines: Array<{
    tier: "aggregators" | "dev_press" | "tech_press" | "financial_press";
    predictedHeadline: string;
    sensationalismScore: number; // 0 to 10
    sentimentScore: number; // -1 to 1
  }>;
  vaccineRewrites: Array<{
    strategy: "grandfathering_shield" | "transparent_unit_cost" | "safe_harbor_free_tier";
    revisedCopy: string;
    neutralizedObjections: string[];
    preservedRevenuePercent: number;
    projectedSentimentRecovery: number;
  }>;
  renderedHtmlDashboard: string;
}

// Contract Validators

export function validateDiscourseThread(obj: unknown): DiscourseThread {
  if (!obj || typeof obj !== "object") throw new Error("DiscourseThread must be an object");
  const t = obj as Partial<DiscourseThread>;
  if (!["reddit", "hackernews", "twitter", "github"].includes(t.platform as string)) {
    throw new Error(`Invalid platform: ${t.platform}`);
  }
  if (!t.threadId || typeof t.threadId !== "string") throw new Error("Missing threadId");
  if (!t.title || typeof t.title !== "string") throw new Error("Missing title");
  if (!t.author || typeof t.author !== "string") throw new Error("Missing author");
  if (!t.url || typeof t.url !== "string") throw new Error("Missing url");
  if (!t.timestamp || typeof t.timestamp !== "string") throw new Error("Missing timestamp");
  if (!t.metrics || typeof t.metrics.upvotes !== "number" || typeof t.metrics.comments !== "number") {
    throw new Error("Invalid metrics");
  }
  if (!Array.isArray(t.posts) || t.posts.length === 0) {
    throw new Error("DiscourseThread must have at least one post");
  }
  for (const p of t.posts) {
    if (!p.postId || typeof p.postId !== "string") throw new Error("Invalid postId");
    if (!p.author || typeof p.author !== "string") throw new Error("Invalid post author");
    if (typeof p.text !== "string") throw new Error("Invalid post text");
    if (typeof p.score !== "number") throw new Error("Invalid post score");
  }
  return t as DiscourseThread;
}

export function validateHistoricalBacklashCase(obj: unknown): HistoricalBacklashCase {
  if (!obj || typeof obj !== "object") throw new Error("HistoricalBacklashCase must be an object");
  const c = obj as Partial<HistoricalBacklashCase>;
  if (!c.id || typeof c.id !== "string") throw new Error("Missing case id");
  if (!c.title || typeof c.title !== "string") throw new Error("Missing title");
  if (!c.vendor || typeof c.vendor !== "string") throw new Error("Missing vendor");
  if (!c.announcementDate || typeof c.announcementDate !== "string") throw new Error("Missing announcementDate");
  if (!c.policySummary || typeof c.policySummary !== "string") throw new Error("Missing policySummary");
  if (!Array.isArray(c.objections) || c.objections.length === 0) throw new Error("Must have objections");
  for (const objItem of c.objections) {
    if (!objItem.category || typeof objItem.category !== "string") throw new Error("Missing objection category");
    if (typeof objItem.severity !== "number" || objItem.severity < 0 || objItem.severity > 10) {
      throw new Error(`Invalid severity: ${objItem.severity}`);
    }
    if (!objItem.claim || typeof objItem.claim !== "string") throw new Error("Missing objection claim");
  }
  if (!Array.isArray(c.timeline) || c.timeline.length === 0) throw new Error("Must have timeline");
  for (const tl of c.timeline) {
    if (!["announcement", "outrage", "boycott", "walkback", "aftermath"].includes(tl.stage)) {
      throw new Error(`Invalid stage: ${tl.stage}`);
    }
    if (typeof tl.daysAfterT0 !== "number") throw new Error("Invalid daysAfterT0");
    if (!tl.headline || typeof tl.headline !== "string") throw new Error("Invalid headline");
    if (typeof tl.sentimentScore !== "number" || tl.sentimentScore < -1 || tl.sentimentScore > 1) {
      throw new Error(`Invalid sentimentScore: ${tl.sentimentScore}`);
    }
  }
  if (!c.churnImpact || typeof c.churnImpact.estimatedARRChurnPercent !== "number") {
    throw new Error("Invalid churnImpact");
  }
  if (!Array.isArray(c.churnImpact.primaryMigrationDestinations)) {
    throw new Error("Invalid primaryMigrationDestinations");
  }
  return c as HistoricalBacklashCase;
}

export function validateMacroGraphState(obj: unknown): MacroGraphState {
  if (!obj || typeof obj !== "object") throw new Error("MacroGraphState must be an object");
  const s = obj as Partial<MacroGraphState>;
  if (typeof s.nodeCount !== "number" || s.nodeCount <= 0) throw new Error("Invalid nodeCount");
  if (typeof s.edgeCount !== "number" || s.edgeCount < 0) throw new Error("Invalid edgeCount");
  if (!(s.stances instanceof Float32Array) || s.stances.length !== s.nodeCount) {
    throw new Error("stances must be Float32Array of length nodeCount");
  }
  if (!(s.outrage instanceof Float32Array) || s.outrage.length !== s.nodeCount) {
    throw new Error("outrage must be Float32Array of length nodeCount");
  }
  if (!(s.susceptibility instanceof Float32Array) || s.susceptibility.length !== s.nodeCount) {
    throw new Error("susceptibility must be Float32Array of length nodeCount");
  }
  if (!(s.kolWeight instanceof Float32Array) || s.kolWeight.length !== s.nodeCount) {
    throw new Error("kolWeight must be Float32Array of length nodeCount");
  }
  if (!(s.states instanceof Uint8Array) || s.states.length !== s.nodeCount) {
    throw new Error("states must be Uint8Array of length nodeCount");
  }
  if (!(s.rowPointers instanceof Int32Array) || s.rowPointers.length !== s.nodeCount + 1) {
    throw new Error("rowPointers must be Int32Array of length nodeCount + 1");
  }
  if (!(s.columnIndices instanceof Int32Array) || s.columnIndices.length !== s.edgeCount) {
    throw new Error("columnIndices must be Int32Array of length edgeCount");
  }
  if (!(s.edgeWeights instanceof Float32Array) || s.edgeWeights.length !== s.edgeCount) {
    throw new Error("edgeWeights must be Float32Array of length edgeCount");
  }
  return s as MacroGraphState;
}

export function validateMinimaxDebateResult(obj: unknown): MinimaxDebateResult {
  if (!obj || typeof obj !== "object") throw new Error("MinimaxDebateResult must be an object");
  const d = obj as Partial<MinimaxDebateResult>;
  if (!d.topic || typeof d.topic !== "string") throw new Error("Missing topic");
  if (!Array.isArray(d.turns) || d.turns.length < 4) {
    throw new Error("Debate must contain at least 4 dialectic turns");
  }
  const roles = d.turns.map((t) => t.role);
  if (!roles.includes("prosecution") || !roles.includes("defense") || !roles.includes("adjudicator")) {
    throw new Error("Debate must include prosecution, defense, and adjudicator");
  }
  if (!Array.isArray(d.killingObjections) || d.killingObjections.length === 0) {
    throw new Error("Debate must extract killing objections");
  }
  for (const ko of d.killingObjections) {
    if (typeof ko.rank !== "number" || typeof ko.severityScore !== "number") {
      throw new Error("Invalid killing objection structure");
    }
  }
  if (!d.adjudicatorVerdict || typeof d.adjudicatorVerdict.viabilityScore !== "number") {
    throw new Error("Missing adjudicatorVerdict");
  }
  return d as MinimaxDebateResult;
}

export function validateExecutiveDecisionReport(obj: unknown): ExecutiveDecisionReport {
  if (!obj || typeof obj !== "object") throw new Error("ExecutiveDecisionReport must be an object");
  const r = obj as Partial<ExecutiveDecisionReport>;
  if (!r.arrRisk || typeof r.arrRisk.totalARR !== "number" || typeof r.arrRisk.expectedChurnLossARR !== "number") {
    throw new Error("Invalid arrRisk");
  }
  if (!Array.isArray(r.arrRisk.netARRWaterfall) || r.arrRisk.netARRWaterfall.length === 0) {
    throw new Error("Invalid netARRWaterfall");
  }
  if (!Array.isArray(r.competitorMigration) || r.competitorMigration.length === 0) {
    throw new Error("Invalid competitorMigration");
  }
  if (!Array.isArray(r.mediaHeadlines) || r.mediaHeadlines.length === 0) {
    throw new Error("Invalid mediaHeadlines");
  }
  if (!Array.isArray(r.vaccineRewrites) || r.vaccineRewrites.length === 0) {
    throw new Error("Invalid vaccineRewrites");
  }
  if (typeof r.renderedHtmlDashboard !== "string" || !r.renderedHtmlDashboard.includes("<html")) {
    throw new Error("Invalid renderedHtmlDashboard");
  }
  return r as ExecutiveDecisionReport;
}
