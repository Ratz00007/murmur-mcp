/**
 * Every tool's `outputSchema` — the contract a strict MCP client validates
 * `structuredContent` against.
 *
 * Two rules shape this file:
 *
 * 1. **Derived from the actual reply, not invented.** Each schema mirrors the
 *    object a tool really returns. The plan/submit tools do not restate the
 *    submission shape: the engine already attaches `task.outputSchema` to every
 *    generation task (engine/src/{ontology,personas,sim/batch,report}.ts), so
 *    the plan receipt carries the exact contract the submit action accepts.
 *
 * 2. **`ok` + `next` are the only required fields.** `ServerContext.reply`
 *    enforces the response-token budget by replacing an oversized payload with
 *    a spill receipt (`{ok, spilled, reason, artifact, fullTokens, next}`).
 *    A required field the receipt cannot carry would make the SDK reject a
 *    perfectly valid answer, so the per-tool fields are described but optional;
 *    `ok` and `next` are the invariant that survives every path.
 */
import { z } from "zod";
import { ENTITY_TYPES, SURROGATE_DISCLAIMER } from "@murmur/engine";

/** Fields every structured reply carries, including the oversize spill receipt. */
const ENVELOPE = {
  ok: z.boolean().describe("True when the call did what it was asked to do"),
  next: z
    .string()
    .describe("The next tool call this receipt is teaching you to make"),
  spilled: z
    .literal(true)
    .optional()
    .describe(
      "Set when the payload spilled to disk and this is a pointer receipt",
    ),
  reason: z
    .string()
    .optional()
    .describe("Why the payload spilled (spill receipts only)"),
  artifact: z
    .string()
    .optional()
    .describe(
      "Workspace-relative path of the full payload (spill receipts only)",
    ),
  fullTokens: z
    .number()
    .optional()
    .describe("Token size of the spilled payload (spill receipts only)"),
};

/** Compose a tool's outputSchema from the shared envelope plus its own fields. */
export function toolOutput<T extends z.ZodRawShape>(fields: T) {
  return z.object({ ...ENVELOPE, ...fields });
}

// ---------------------------------------------------------------------------
// Shared sub-shapes (mirroring the engine's own return types)
// ---------------------------------------------------------------------------

/** Rejection item list: what was refused, where, and why. */
const rejected = z
  .array(
    z.object({
      ref: z.string(),
      field: z.string().optional(),
      message: z.string(),
    }),
  )
  .optional()
  .describe(
    "Items the engine refused; fix only these and resubmit the same task_id",
  );

const stageRow = z.object({
  stage: z.string(),
  tools: z
    .string()
    .describe("The tools that make up this stage, in call order"),
  produces: z
    .string()
    .describe("What the stage leaves behind in the world directory"),
});

/** The generation task returned by every `action: "plan"` call. */
const task = z
  .object({
    id: z
      .string()
      .describe("Task id — pass it back to the matching submit action"),
    worldId: z.string(),
    kind: z.enum(["ontology", "personas", "sim", "report"]),
    round: z.number().nullable(),
    instructions: z
      .string()
      .describe("What you must produce, and the grounding rules"),
    outputSchema: z
      .record(z.unknown())
      .describe("JSON Schema your submission must satisfy"),
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        tokens: z.number(),
        payload: z.unknown(),
      }),
    ),
    createdAt: z.string(),
  })
  .describe("The work to complete yourself before submitting");

const coverage = z
  .object({
    seeds: z.number(),
    totalBytes: z.number(),
    largest: z.number(),
    notes: z.array(z.string()),
  })
  .describe("Corpus size and the coverage warnings the engine raises about it");

/** Full deterministic round statistics (engine `RoundStats`). */
const roundStats = z.object({
  round: z.number(),
  postsByPlatform: z.object({ twitter: z.number(), reddit: z.number() }),
  actions: z.object({
    posts: z.number(),
    replies: z.number(),
    comments: z.number(),
    reposts: z.number(),
    quotes: z.number(),
    votes: z.number(),
  }),
  engagement: z.object({
    likes: z.number(),
    reposts: z.number(),
    upvotes: z.number(),
    downvotes: z.number(),
    impressions: z.number(),
  }),
  sentimentByEntity: z.record(z.number()),
  topMovers: z.array(
    z.object({
      personaId: z.string(),
      entity: z.string(),
      from: z.number(),
      to: z.number(),
    }),
  ),
  escalations: z.array(
    z
      .object({
        rootId: z.string(),
        path: z.array(z.string()),
        depth: z.number(),
        finalSentiment: z.number(),
        severity: z.number(),
      })
      .passthrough(),
  ),
  newViral: z.array(z.string()),
  injections: z.array(z.string()),
  activated: z.array(z.string()),
  lurkers: z.array(z.string()),
});

/** The trimmed variant the sim submit receipt carries instead of the full stats.
 *
 * It is a DIFFERENT shape on purpose: the receipt carries what a model needs
 * to continue the loop (round totals, platform split, engagement, sentiment,
 * escalation count, top movers), not the full RoundStats record. Extending the
 * full schema and then requiring the fields the receipt deliberately omits is
 * exactly the mismatch a strict client rejects — which is how this was found.
 */
const roundStatsDigest = z.object({
  round: z.number(),
  postsByPlatform: z.object({ twitter: z.number(), reddit: z.number() }),
  engagement: z.object({
    likes: z.number(),
    reposts: z.number(),
    upvotes: z.number(),
    downvotes: z.number(),
    impressions: z.number(),
  }),
  sentimentByEntity: z.record(z.number()),
  escalations: z
    .number()
    .describe("Count of escalation chains started this round"),
  topMovers: z.array(
    z.object({
      personaId: z.string(),
      entity: z.string(),
      from: z.number(),
      to: z.number(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Tool output schemas
// ---------------------------------------------------------------------------

export const WORLD_INIT_OUTPUT = toolOutput({
  world: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      stage: z.string(),
      seed: z.string(),
    })
    .optional(),
  stageMap: z
    .array(stageRow)
    .optional()
    .describe("The ordered pipeline and what each stage produces"),
});

export const WORLD_LIST_OUTPUT = toolOutput({
  active: z
    .string()
    .nullable()
    .optional()
    .describe("Id of the world later calls resolve to by default"),
  worlds: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        stage: z.string(),
        round: z.string().describe("Completed rounds out of configured rounds"),
        personas: z.number().optional(),
        posts: z.number().optional(),
        createdAt: z.string().optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .optional()
    .describe("Every saved world (detail: 'rows')"),
  world: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      stage: z.string(),
      round: z.string().optional(),
    })
    .optional()
    .describe("The world you just made active (detail: 'open')"),
  stageMap: z.array(stageRow).optional(),
  counts: z
    .object({
      seeds: z.number(),
      entities: z.number(),
      personas: z.number(),
      posts: z.number(),
      memories: z.number(),
      events: z.number(),
      reports: z.number(),
    })
    .optional()
    .describe("Entity/post counts (detail: 'status')"),
  pendingTask: z
    .object({ id: z.string(), kind: z.string() })
    .nullable()
    .optional(),
  trending: z.array(z.string()).optional(),
});

export const WORLD_CONFIG_OUTPUT = toolOutput({
  config: z
    .object({
      rounds: z.number(),
      batch: z
        .object({
          maxPersonas: z.number(),
          maxFeedItems: z.number(),
          personaCardTokens: z.number(),
        })
        .passthrough(),
      context: z.object({ maxResponseTokens: z.number() }),
    })
    .optional()
    .describe("The stored configuration after the update"),
  limits: z
    .object({
      rounds: z.object({ min: z.number(), max: z.number() }),
      maxPersonas: z.object({ min: z.number(), max: z.number() }),
      maxFeedItems: z.object({ min: z.number(), max: z.number() }),
      maxResponseTokens: z.object({ min: z.number(), max: z.number() }),
      population: z.object({
        min: z.number(),
        max: z.number(),
        default: z.number(),
      }),
      sensitivityRefitCount: z.object({
        min: z.number(),
        max: z.number(),
        default: z.number(),
      }),
    })
    .optional()
    .describe("The engine's hard limits for every tunable"),
  stage: z.string().optional().describe("World stage after the update"),
  rounds: z.number().optional().describe("Configured round count"),
});

export const SEED_ADD_OUTPUT = toolOutput({
  seeds: z
    .array(
      z.object({
        path: z.string().describe("Workspace-relative path"),
        ok: z.boolean(),
        seedId: z.string().optional(),
        bytes: z.number().optional(),
        duplicate: z
          .boolean()
          .optional()
          .describe("True when the byte hash was already ingested"),
        note: z.string().optional(),
        error: z.string().optional(),
      }),
    )
    .optional()
    .describe("One row per file (source: 'files')"),
  seed: z
    .object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      ref: z.string(),
      bytes: z.number(),
      digest: z.string(),
    })
    .optional()
    .describe("The stored seed (source: 'url' | 'text')"),
  duplicate: z.boolean().optional(),
  coverage: coverage
    .optional()
    .describe("Corpus size after this call (source: 'files')"),
});

export const SEEDS_REVIEW_OUTPUT = toolOutput({
  seeds: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        title: z.string(),
        ref: z.string(),
        bytes: z.number(),
        digest: z.string(),
      }),
    )
    .optional(),
  coverage: coverage.optional(),
});

export const ONTOLOGY_OUTPUT = toolOutput({
  taskId: z.string().optional().describe("Task id (action: 'plan')"),
  how: z
    .string()
    .optional()
    .describe("How to complete the task and hand it back"),
  task: task.optional(),
  inserted: z
    .number()
    .optional()
    .describe("Entities applied (action: 'submit')"),
  entities: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(ENTITY_TYPES),
        salience: z.number(),
      }),
    )
    .optional(),
  skippedExisting: z
    .array(z.string())
    .optional()
    .describe("Entities already present — resubmitting skips them"),
  rejected,
  hint: z.string().optional(),
});

export const GRAPH_OUTPUT = toolOutput({
  relations: z
    .number()
    .optional()
    .describe("Typed relations derived (action: 'build')"),
  tensionsAbove05: z
    .number()
    .optional()
    .describe("Relations above 0.5 tension"),
  communities: z.number().optional().describe("Communities detected"),
  topTensions: z
    .array(z.string())
    .optional()
    .describe("The hottest edges, rendered as readable lines"),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        salience: z.number(),
      }),
    )
    .optional(),
  edges: z
    .array(
      z.object({
        src: z.string(),
        dst: z.string(),
        type: z.enum(["alliance", "opposition", "influence", "ownership"]),
        weight: z.number(),
        tension: z.number(),
      }),
    )
    .optional(),
  tokens: z
    .number()
    .optional()
    .describe("Size of the traversal (action: 'query')"),
  truncated: z
    .boolean()
    .optional()
    .describe("True when the traversal hit the token budget (action: 'query')"),
  path: z
    .string()
    .optional()
    .describe("Where the diagram was written (action: 'export')"),
  nodeCount: z
    .number()
    .optional()
    .describe("Nodes in the written diagram (action: 'export')"),
  edgeCount: z
    .number()
    .optional()
    .describe("Edges in the written diagram (action: 'export')"),
});

/**
 * The honesty block every fabric-derived output must carry (METHODOLOGY.md):
 * personaCount next to the surrogate's holdout metrics next to the disclaimer.
 */
export const FABRIC_HONESTY = z
  .object({
    personaCount: z
      .number()
      .int()
      .describe("How many surrogate personas the derived numbers describe"),
    surrogate: z
      .object({
        holdoutAccuracy: z
          .number()
          .describe("Holdout accuracy of the fitted surrogate (0 when none)"),
        labeledCount: z
          .number()
          .int()
          .describe("Labeled examples the surrogate was fit on (0 when none)"),
        effectiveSampleSize: z
          .number()
          .int()
          .describe("Same as labeledCount — every label is a real example"),
      })
      .describe("Surrogate quality figures — a model with 0 labels is UNCALIBRATED"),
    disclaimer: z
      .literal(SURROGATE_DISCLAIMER)
      .describe("Print next to every fabric-derived number"),
  })
  .describe(
    "Honesty block: the numbers above are a compressed model of labeled opinions, not data about real people",
  );

export const PERSONAS_OUTPUT = toolOutput({
  taskId: z.string().optional().describe("Task id (action: 'plan')"),
  how: z.string().optional(),
  task: task.optional(),
  population: z
    .number()
    .optional()
    .describe("Personas stored (action: 'submit')"),
  personaIds: z.array(z.string()).optional(),
  platformBreakdown: z.record(z.number()).optional(),
  archetypeBreakdown: z.record(z.number()).optional(),
  followEdges: z.number().optional().describe("Follow edges wired in"),
  communityMemberships: z.number().optional(),
  persona: z
    .object({
      id: z.string(),
      name: z.string(),
      handle: z.string(),
      archetype: z.string(),
    })
    .passthrough()
    .nullable()
    .optional()
    .describe(
      "The persona audited (action: 'inspect') or patched (action: 'edit')",
    ),
  card: z
    .object({ card: z.record(z.unknown()), tokens: z.number() })
    .optional()
    .describe("The compact, digest-sized persona card"),
  stancesDetailed: z
    .array(z.object({ entity: z.string(), stance: z.number() }))
    .optional()
    .describe("Every stance, resolved to entity names (action: 'inspect')"),
  recentPosts: z
    .array(
      z.object({
        id: z.string(),
        round: z.number(),
        platform: z.string(),
        kind: z.string(),
        body: z.string(),
      }),
    )
    .optional(),
  rejected,
  hint: z.string().optional(),
  note: z.string().optional(),
  fabric: z
    .object({
      population: z.number().describe("Fabricated surrogate persona count"),
      seed: z.string().describe("Fabric seed — same seed replays byte-identically"),
      archetypeShares: z
        .record(z.number())
        .describe("Share of each fabric archetype in the population"),
      traitMeans: z.record(z.number()).describe("Population mean per trait"),
      modelAttached: z
        .boolean()
        .describe("True when a fitted surrogate model is active for this world"),
      memoryEntries: z
        .number()
        .optional()
        .describe("Persona memory entries carried over (same-seed refabrication)"),
      honesty: FABRIC_HONESTY,
    })
    .optional()
    .describe("Active fabric population summary (action: 'fabricate')"),
  personaView: z
    .object({
      personaId: z.string().describe("Canonical id ('#i')"),
      archetype: z.string(),
      archetypeDescription: z.string(),
      claimId: z.string().nullable(),
      traits: z.record(z.number()).describe("This persona's trait values"),
      stance: z
        .number()
        .describe("Signed stance in [-1, 1] toward the claim (0 when uncalibrated)"),
      intensity: z.number().describe("|stance| in [0, 1]"),
      topObjectionId: z.string().nullable(),
      migrationChoiceId: z.string().nullable(),
      calibration: z
        .enum(["calibrated", "uncalibrated"])
        .describe("'uncalibrated' views have no fitted surrogate head — label them UNCALIBRATED"),
      rationale: z
        .string()
        .describe("Deterministic template rationale (archetype + dominant traits + model weights) — no LLM"),
      memory: z
        .array(
          z.object({
            seq: z.number(),
            personaId: z.string(),
            text: z.string(),
          }),
        )
        .describe("Prior persona-memory entries referenced by this view"),
      honesty: FABRIC_HONESTY,
    })
    .optional()
    .describe("The materialized surrogate persona (action: 'materialize')"),
  personaId: z
    .string()
    .optional()
    .describe("Canonical persona id the memory was written for (action: 'remember')"),
  remembered: z
    .number()
    .optional()
    .describe("Memory entries now held for the persona (action: 'remember')"),
  uncalibrated: z
    .boolean()
    .optional()
    .describe("True when the claim has no fitted surrogate support (action: 'materialize')"),
  honesty: FABRIC_HONESTY.optional(),
});

export const SIM_OUTPUT = toolOutput({
  taskId: z.string().optional(),
  round: z.number().optional().describe("Round this call advances or reports"),
  personas: z
    .number()
    .optional()
    .describe("Personas activated in the batch (action: 'next_batch')"),
  totalTokens: z.number().optional(),
  feedItemsTotal: z.number().optional(),
  how: z
    .string()
    .optional()
    .describe("How to complete the batch and hand it back"),
  task: task.optional(),
  samplingUsed: z
    .number()
    .optional()
    .describe("Personas the client's sampling capability filled in"),
  advanced: z.boolean().optional().describe("True when the round closed"),
  completed: z
    .boolean()
    .optional()
    .describe("True when this was the final configured round"),
  appliedPersonas: z.number().optional(),
  lurkers: z
    .number()
    .optional()
    .describe("Personas that did not act this round"),
  postsCreated: z.number().optional(),
  statsDigest: roundStatsDigest
    .optional()
    .describe("Trimmed round statistics carried on the submit receipt"),
  stats: roundStats
    .nullable()
    .optional()
    .describe("Full round statistics (action: 'summary')"),
  eventId: z
    .string()
    .optional()
    .describe("The injected event (action: 'inject')"),
  landsInRound: z
    .number()
    .optional()
    .describe("Which round the event lands in"),
  note: z.string().optional(),
  rounds: z
    .number()
    .optional()
    .describe("Completed rounds (action: 'timeline')"),
  of: z.number().optional().describe("Configured rounds"),
  timeline: z
    .array(
      z.object({
        round: z.number(),
        twitter: z.number(),
        reddit: z.number(),
        engagement: z.number(),
        sentimentByEntity: z.record(z.number()),
        escalations: z.number(),
        injections: z.number(),
        lurkers: z.number(),
      }),
    )
    .optional()
    .describe("One compact row per completed round (action: 'timeline')"),
  engagementPeaks: z
    .array(z.number())
    .optional()
    .describe("Rounds whose engagement exceeded mean + 2 sigma"),
  fabric: z
    .object({
      active: z.literal(true),
      honesty: FABRIC_HONESTY,
    })
    .optional()
    .describe(
      "Present when a persona-fabric population is active for this world — its aggregates are surrogate-derived",
    ),
  rejected,
});

export const REPORT_OUTPUT = toolOutput({
  taskId: z.string().optional(),
  how: z.string().optional(),
  task: task.optional(),
  version: z.number().optional().describe("Stored report version"),
  risks: z
    .array(z.string())
    .optional()
    .describe("Risk register as stored, with the post ids each risk cites"),
  files: z
    .array(z.object({ path: z.string(), bytes: z.number() }))
    .optional()
    .describe("Files written (action: 'export')"),
  open: z
    .string()
    .optional()
    .describe("Path of the self-contained HTML dashboard"),
  hint: z.string().optional(),
  rejected,
});

export const MACRO_SIM_OUTPUT = toolOutput({
  world: z
    .string()
    .optional()
    .describe("World id the simulation ran against"),
  nodeCount: z.number().optional().describe("Population size simulated"),
  averageDegree: z.number().optional().describe("Directed edges per node"),
  rounds: z.number().optional().describe("Rounds completed"),
  summaries: z
    .array(
      z.object({
        round: z.number(),
        nodeCount: z.number(),
        edgeCount: z.number(),
        distribution: z.object({
          susceptible: z.number(),
          exposed: z.number(),
          infected: z.number(),
          contagious: z.number(),
          churned: z.number(),
        }),
        meanStance: z.number(),
        outrageIndex: z.number(),
        contagion: z.number().describe("Nodes in the contagious compartment"),
        durationMs: z.number(),
      }),
    )
    .optional()
    .describe("One compact row per completed round"),
});

export const INTERACT_OUTPUT = toolOutput({
  logged: z
    .boolean()
    .optional()
    .describe(
      "True when this call recorded an answer, false when it returned a pack",
    ),
  persona: z
    .string()
    .optional()
    .describe("The persona interviewed (target: 'persona')"),
  file: z.string().optional().describe("Where the exchange was appended"),
  how: z
    .string()
    .optional()
    .describe("How to answer from the pack and hand the answer back"),
  pack: z
    .object({
      question: z.string(),
      persona: z
        .record(z.unknown())
        .optional()
        .describe("Persona card with full stances and traits"),
      matchedEntities: z.array(z.string()).optional(),
      matchedPersonas: z.array(z.string()).optional(),
      posts: z
        .array(
          z.object({
            id: z.string(),
            round: z.number(),
            platform: z.string(),
            body: z.string(),
            sentiment: z.number(),
          }),
        )
        .optional()
        .describe("This persona's own posts (target: 'persona')"),
      memory: z
        .array(
          z.object({
            round: z.number(),
            kind: z.string(),
            content: z.string(),
          }),
        )
        .optional(),
      evidence: z
        .array(
          z
            .object({
              id: z.string(),
              by: z.string(),
              plat: z.string(),
              round: z.number(),
              body: z.string(),
            })
            .passthrough(),
        )
        .optional()
        .describe("Posts across the whole run (target: 'run')"),
      stats: z.record(z.unknown()).optional(),
      instructions: z.string().optional(),
    })
    .optional()
    .describe("The grounded evidence pack you must answer from"),
});

/** Every tool's declared outputSchema, keyed by tool name. */
export const TOOL_OUTPUTS = {
  world_init: WORLD_INIT_OUTPUT,
  world_list: WORLD_LIST_OUTPUT,
  world_config: WORLD_CONFIG_OUTPUT,
  seed_add: SEED_ADD_OUTPUT,
  seeds_review: SEEDS_REVIEW_OUTPUT,
  ontology: ONTOLOGY_OUTPUT,
  graph: GRAPH_OUTPUT,
  personas: PERSONAS_OUTPUT,
  sim: SIM_OUTPUT,
  report: REPORT_OUTPUT,
  macro_sim: MACRO_SIM_OUTPUT,
  interact: INTERACT_OUTPUT,
} as const;
