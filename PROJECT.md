# Project: Market Twin Simulation Platform (`murmur-mcp`)

## Architecture
`murmur-mcp` is an enterprise-grade Market Twin simulation platform for strategic market forecasting and decision intelligence. It decouples micro qualitative LLM reasoning (cohort thread synthesis, adversarial red-team debates) from macro quantitative population dynamics (local mathematical graph dynamics over 100k+ nodes in SQLite/local engine with zero LLM token burn).

```
Host Agent / MCP Client (Claude Desktop, Antigravity, Custom)
      │
      ▼  JSON-RPC stdio
[packages/server (McpServer)]
      │
      ├─► World & Seeds Management (Discourse Adapters & Historical Corpus)
      ├─► Micro Discourse Reasoning (Exemplar LLM Personas & 4-Turn Minimax War Room)
      ├─► Macro Population Engine (100k+ Nodes TypedArray / SQLite Zero-Token Dynamics)
      ├─► Algorithmic Feed Engine (Outrage Amplification, The Ratio, KOL Weights)
      └─► Executive Intelligence (ARR Risk, Migration Maps, Headlines, Vaccine Rewriter)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Windows Test Timeout & Stability Fixes | Configure 60s test timeouts in Vitest, eliminate `process.chdir()`, fix SQLite unclosed handles causing `EBUSY` on Windows, isolate tmp probe files | M1 | Survey E1 |
| 2 | Aspect-Based / Model-Assisted Sentiment | Upgrade `sentiment.ts` to attribute sentiment specifically to mentioned entities rather than global text score; support model-assisted scoring with deterministic fallback | M1 | Survey E1 |
| 3 | Fix Negative-Sentiment Lurker Bug | Remove suppression in `sim/ingest.ts:786, 898` so negative sentiment actively amplifies cascades rather than silently lurking | M1 | Survey E2 |
| 4 | Multi-Platform Discourse Ingestion Adapters | Normalized adapters for Reddit (`r/devops`), Hacker News (Algolia API), X/Twitter, and GitHub Issues under Tri-Tier Credential Strategy | M2 | Survey E2 |
| 5 | Canonical Historical Backlash Corpus | Structured historical corpus schemas and case studies: Unity runtime fee (2023), Docker Hub free team deprecation (2023), Redis/HashiCorp licensing pivots (2023-2024) | M2 | Survey E2 |
| 6 | Seed Ingestion MCP Extensions | Modernize `seed_add` with `source: "corpus"` and `source: "discourse"` | M2 | Survey E2 |
| 7 | Vectorized Macro Graph Dynamics Engine | SQLite `macro_nodes`/`macro_edges` schema and flat `Float32Array` CSR graph buffers simulating 100k+ nodes & 1M+ edges with 0 LLM token burn (<20ms/round) | M3 | Survey E3 |
| 8 | Micro-Macro Decoupled Simulation Loop | Decouple 10-30 exemplar personas generating qualitative micro threads from macro population dynamics propagation | M3 | Survey E3 |
| 9 | Outrage Amplification & The Ratio | Outrage multiplier ($M_{\text{outrage}}$), controversial reply/quote weighting ("The Ratio"), and quote-tweet rebuttal propagation | M4 | Survey E2 |
| 10 | KOL / Influencer Network Centrality | Power-law in-degree reach and PageRank authority weighting ($W_{\text{KOL}}$) in feed ranking | M4 | Survey E2 |
| 11 | Adversarial Minimax War Room | 4-turn dialectic debate (Prosecution Indictment -> Defense -> Cross-Exam -> Adjudication) extracting ranked Killing Objections and fragile assumptions | M5 | Survey E3 |
| 12 | Executive Churn ARR Risk Projections | Logistic hazard churn modeling, gross ARR at risk, expected ARR churn loss, base/P90/mitigated scenarios, and net ARR waterfall | M5 | Survey E3 |
| 13 | Competitor Migration Inflow Maps | Multinomial logit destination choice predicting churn migration distributions (e.g. Godot, OpenTofu, Valkey) | M5 | Survey E3 |
| 14 | Media & Press Headline Predictor | 4-tier press lifecycle simulator (Aggregators, Dev Press, Tech Press, Financial Press) predicting sensational headlines and PR sentiment | M5 | Survey E3 |
| 15 | Automated "Vaccine" Copy Rewriting | Strategic copy generator producing 3 neutralizing alternatives (Grandfathering Shield, Transparent Unit-Cost, Safe Harbor Free Tier) preserving $\ge 80\%$ target revenue | M5 | Survey E3 |
| 16 | Modernized MCP Tools Integration | Expose simulation, Minimax war room, corpus loading, and executive deliverables through MCP server tools with full schemas | M5 | Survey E1, E3 |
| 17 | Comprehensive E2E Testing Suite (Tiers 1-4) | Opaque-box test suite verifying all features against user requirements | E2E Track | Architecture |
| 18 | Adversarial Coverage Hardening (Tier 5) | White-box stress testing, boundary condition verification, and zero-egress validation | Final Phase 2 | Architecture |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Windows Stability & Codebase Modernization | Features 1, 2, 3 | none | DONE |
| M2 | Real-World Ground Truth Ingestion & Backlash Corpus | Features 4, 5, 6 | M1 | DONE |
| M3 | Macro-Micro Multi-Scale Modeling Engine (100k+ Nodes) | Features 7, 8 | M1 | DONE (macro engine implemented as library; wiring tracked in M6) |
| M4 | Algorithmic Feed Dynamics & Controversy Amplification | Features 9, 10 | M1, M3 | DONE |
| M5 | Adversarial War Room & Executive Decision Intelligence | Features 11, 12, 13, 14, 15, 16 | M2, M3, M4 | DONE (executive + minimax tools live; covered by market-twin e2e) |
| M6 | Final Dual-Track E2E Test Suite Pass & Adversarial Hardening | Features 17, 18 | M1-M5, TEST_READY | DONE (macro-engine wiring + e2e parity pending) |

Status is measured, not declared: 651/651 unit+golden, 193/193 e2e (last
measured, 188 market-twin contracts), lint: 0 errors, 16 warnings
(noExplicitAny), typecheck 0, cleanroom GATE GREEN when rebuilt. The
milestone table said M5 IN_PROGRESS / M6 PLANNED while every gate was green,
which is the same class of stale-doc defect the claim gate exists to catch.

## Interface Contracts

### 1. Ingestion Adapter Contract (`packages/engine/src/ingest/discourse/types.ts`)
```ts
export interface DiscourseThread {
  platform: "reddit" | "hackernews" | "twitter" | "github";
  threadId: string;
  title: string;
  author: string;
  url: string;
  timestamp: string;
  metrics: { upvotes: number; comments: number; shares?: number };
  posts: Array<{
    postId: string;
    parentId?: string;
    author: string;
    text: string;
    timestamp: string;
    score: number;
    aspects?: Record<string, number>;
  }>;
}

export interface HistoricalBacklashCase {
  id: string; // e.g. "unity-runtime-fee-2023"
  title: string;
  vendor: string;
  announcementDate: string;
  policySummary: string;
  objections: Array<{ category: string; severity: number; claim: string }>;
  timeline: Array<{ stage: "announcement" | "outrage" | "boycott" | "walkback" | "aftermath"; daysAfterT0: number; headline: string; sentimentScore: number }>;
  churnImpact: { estimatedARRChurnPercent: number; primaryMigrationDestinations: Array<{ competitor: string; inflowShare: number }> };
}
```

### 2. Macro Graph Dynamics Contract (`packages/engine/src/dynamics/macro-graph.ts`)
```ts
export interface MacroGraphState {
  nodeCount: number;
  edgeCount: number;
  // Node buffers: Float32Array
  stances: Float32Array; // [-1.0, 1.0]
  outrage: Float32Array; // [0.0, 1.0]
  susceptibility: Float32Array; // [0.0, 1.0]
  kolWeight: Float32Array; // [1.0, 100.0]
  states: Uint8Array; // 0=Susceptible, 1=Exposed, 2=Infected, 3=Contagious, 4=Churned
  // Graph CSR buffers
  rowPointers: Int32Array;
  columnIndices: Int32Array;
  edgeWeights: Float32Array;
}

export interface MacroStepResult {
  round: number;
  meanStance: number;
  outrageIndex: number;
  churnCount: number;
  stateDistribution: { susceptible: number; exposed: number; infected: number; contagious: number; churned: number };
  durationMs: number;
}
```

### 3. Minimax Debate War-Room Contract (`packages/engine/src/sim/war-room.ts`)
```ts
export interface MinimaxDebateResult {
  topic: string;
  turns: Array<{
    role: "prosecution" | "defense" | "adjudicator";
    turnIndex: number;
    claim: string;
    arguments: string[];
    evidence: string[];
  }>;
  killingObjections: Array<{
    rank: number;
    title: string;
    economicOrLegalMechanism: string;
    unrebuttableFact: string;
    severityScore: number; // 0 to 10
  }>;
  fragileAssumptions: Array<{
    assumption: string;
    failureCondition: string;
    probabilityOfFailure: number;
  }>;
  adjudicatorVerdict: {
    summary: string;
    viabilityScore: number; // 0 to 100
    recommendation: "proceed" | "revise_terms" | "full_retraction";
  };
}
```

### 4. Executive Decision Report Contract (`packages/engine/src/report-executive.ts`)
```ts
export interface ExecutiveDecisionReport {
  arrRisk: {
    totalARR: number;
    grossARRAtRisk: number;
    expectedChurnLossARR: number;
    baseCaseLoss: number;
    p90CaseLoss: number;
    mitigatedCaseLoss: number;
    netARRWaterfall: Array<{ stage: string; deltaARR: number; balance: number }>;
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
```

## Code Layout
- `murmur/vitest.config.ts`: Test timeout and project configuration (M1)
- `murmur/packages/engine/src/sentiment.ts`: Aspect-based & model-assisted sentiment (M1)
- `murmur/packages/engine/src/sim/ingest.ts`: Cascade logic & lurker bug fix (M1)
- `murmur/packages/engine/src/ingest/discourse/`: Discourse adapters (Reddit, HN, X, GitHub) (M2)
- `murmur/packages/engine/src/ingest/corpus/`: Historical backlash cases (Unity, Docker, Redis/HashiCorp) (M2)
- `murmur/packages/engine/src/dynamics/macro-graph.ts`: 100k+ node CSR/TypedArray dynamics (M3)
- `murmur/packages/engine/src/sim/feed.ts`: Algorithmic feed, outrage multiplier, The Ratio, KOL weighting (M4)
- `murmur/packages/engine/src/sim/war-room.ts`: Minimax adversarial dialectic debate (M5)
- `murmur/packages/engine/src/report-executive.ts`: Churn ARR, migration maps, headlines, Vaccine rewrites (M5)
- `murmur/packages/server/src/tools/`: Updated and extended MCP tools (M5)
- `murmur/tests/e2e/market-twin/`: E2E test suite Tiers 1-4 (E2E Track)
