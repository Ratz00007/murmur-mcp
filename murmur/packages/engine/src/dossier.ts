/**
 * The Objection Dossier — the repositioned core deliverable.
 *
 * Murmur does not predict reactions (see METHODOLOGY.md and the two 2026
 * papers it cites). What it can do is surface the objections a change will
 * attract, steelman each one, show the evidence behind it, argue the counter-
 * case honestly, and hand over the five questions worth asking a real human.
 * That is this artifact.
 *
 * It is built from the SAME collected run data as the simulation report
 * (collectReportData) and held to the SAME integrity rules: every cited post
 * id must resolve in this world, and every number must resolve to a value this
 * run produced. The dossier reframes the evidence; it never invents any.
 *
 * Storage needs no migration: dossier versions live as world-dir JSON files
 * (dossier-N.json) beside the rendered dossier-N.md, versioned by counting
 * what exists. Task kind "dossier" needs no schema change either — the
 * generations table carries kind as free text.
 */
import type { Storage } from "./store/storage.js";
import type { World } from "./types.js";
import type { ItemError } from "./types.js";
import {
  collectReportData,
  buildReportTask,
  type ReportData,
} from "./report.js";
import { verifyNumericClaims } from "./report-claims.js";
import { truncate } from "./util/text.js";

export const DOSSIER_INSTRUCTIONS = `You are the adversarial critic for a change about to ship. You receive a deterministic statistics pack (real measured numbers from a recorded simulation run) and an evidence pack (real simulated posts). Your job is NOT to predict what will happen. It is to find the objections that would kill this change if they turned out to be true, state each one at its strongest, show the evidence behind it, argue the other side honestly, and hand over the questions worth asking a real human.

Return ONLY a JSON object with this shape:
{
  "objections": [
    { "label": "3-10 word name", "steelman": "the objection at its strongest, 3-5 sentences, citing concrete posts and numbers", "blastRadius": "high|medium|low", "threatenedDecision": "the concrete decision this objection threatens, 1 sentence", "postIds": ["po_x", "po_y"] }
  ],
  "strongestCritic": { "handle": "the persona who hates this most", "sentence": "the single sentence that makes them hate it, quoted or closely paraphrased" },
  "counterCase": "the strongest argument FOR shipping anyway, stated as well as the case against, 3-5 sentences",
  "weakestClaim": { "claim": "your plan's weakest load-bearing claim, 1 sentence", "breakingQuestion": "the single question that would break it" },
  "testPlan": [
    { "question": "a question for a real human", "discriminates": "which branch of your plan this answer decides, 1 sentence", "wouldNotShipIf": "the answer that should stop the launch" }
  ]
}
Rules:
- 4-7 objections, ranked most damaging first. Each MUST cite 2-3 real post ids from the evidence pack.
- blastRadius is damage IF TRUE, not likelihood. A certain papercut outranks a possible catastrophe only if you say why.
- The counterCase must be genuinely strong. An adversary-only dossier talks its reader out of good ideas; that failure mode is yours to prevent.
- At most 5 test-plan questions, ranked by how much each discriminates. A question whose every plausible answer leads to shipping is not a test.
- Every number you state must come from the stats pack. Never invent post ids, numbers or quotes. Use only the evidence pack and stats pack.
Return ONLY the JSON object.`;

export interface DossierObjection {
  label: string;
  steelman: string;
  blastRadius: "high" | "medium" | "low";
  threatenedDecision: string;
  postIds: string[];
}

export interface DossierDraft {
  objections: DossierObjection[];
  strongestCritic: { handle: string; sentence: string };
  counterCase: string;
  weakestClaim: { claim: string; breakingQuestion: string };
  testPlan: {
    question: string;
    discriminates: string;
    wouldNotShipIf: string;
  }[];
}

export function buildDossierTask(
  storage: Storage,
  world: World,
  focus: string | undefined,
): import("./types.js").GenerationTask {
  if (world.round === 0)
    throw new Error(
      'no rounds simulated yet — run sim({action:"next_batch"}) then sim({action:"submit"}) first',
    );
  // One task minted and saved, not two: buildReportTask accepts the kind,
  // instructions and schema as overrides, so no stray report task is left
  // behind consuming an id.
  return buildReportTask(storage, world, focus, {
    kind: "dossier",
    instructions: `${DOSSIER_INSTRUCTIONS}\n\nWorld: ${world.name}${focus ? ` — focus: ${focus}` : ""}`,
    outputSchema: {
      type: "object",
      required: [
        "objections",
        "strongestCritic",
        "counterCase",
        "weakestClaim",
        "testPlan",
      ],
      properties: {
        objections: { type: "array", minItems: 4, maxItems: 7 },
        strongestCritic: { type: "object", required: ["handle", "sentence"] },
        counterCase: { type: "string", minLength: 120 },
        weakestClaim: {
          type: "object",
          required: ["claim", "breakingQuestion"],
        },
        testPlan: { type: "array", minItems: 1, maxItems: 5 },
      },
    },
  });
}

export function validateDossierDraft(
  storage: Storage,
  world: World,
  draft: unknown,
): { draft: DossierDraft; rejected: ItemError[] } {
  const d = (draft ?? {}) as Record<string, unknown>;
  const rejected: ItemError[] = [];

  const rawObj = Array.isArray(d.objections) ? d.objections : [];
  if (rawObj.length < 4 || rawObj.length > 7) {
    rejected.push({
      ref: "objections",
      message: `need 4-7 objections ranked most damaging first (got ${rawObj.length})`,
    });
  }
  const objections: DossierObjection[] = [];
  for (let i = 0; i < rawObj.length; i++) {
    const r = (rawObj[i] ?? {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const steelman = typeof r.steelman === "string" ? r.steelman.trim() : "";
    const blast = String(r.blastRadius ?? "");
    const threatened =
      typeof r.threatenedDecision === "string"
        ? r.threatenedDecision.trim()
        : "";
    const postIds = Array.isArray(r.postIds)
      ? r.postIds.map(String).filter(Boolean)
      : [];
    if (label.length < 3 || label.split(/\s+/).length > 10) {
      rejected.push({
        ref: `objections[${i}].label`,
        message: "label must be 3-10 words",
      });
    }
    if (steelman.length < 120) {
      rejected.push({
        ref: `objections[${i}].steelman`,
        message: `steelman too thin (${steelman.length} chars, min 120) — state the objection at its strongest, with posts and numbers`,
      });
    }
    if (!["high", "medium", "low"].includes(blast)) {
      rejected.push({
        ref: `objections[${i}].blastRadius`,
        message: `invalid blastRadius "${blast}" — damage IF TRUE, not likelihood`,
      });
    }
    if (threatened.length < 10) {
      rejected.push({
        ref: `objections[${i}].threatenedDecision`,
        message: "name the concrete decision this threatens (min 10 chars)",
      });
    }
    if (postIds.length < 2 || postIds.length > 3) {
      rejected.push({
        ref: `objections[${i}].postIds`,
        message: `each objection must cite 2-3 real post ids (got ${postIds.length})`,
      });
    }
    for (const pid of postIds) {
      if (!storage.getPost(world.id, pid))
        rejected.push({
          ref: `objections[${i}].postIds`,
          message: `unknown post id "${pid}"`,
        });
    }
    if (rejected.every((e) => !e.ref.startsWith(`objections[${i}]`))) {
      objections.push({
        label,
        steelman,
        blastRadius: blast as "high" | "medium" | "low",
        threatenedDecision: threatened,
        postIds: postIds.slice(0, 3),
      });
    }
  }

  const sc = (d.strongestCritic ?? {}) as Record<string, unknown>;
  const scHandle = typeof sc.handle === "string" ? sc.handle.trim() : "";
  const scSentence = typeof sc.sentence === "string" ? sc.sentence.trim() : "";
  if (scHandle.length < 2)
    rejected.push({
      ref: "strongestCritic.handle",
      message: "name the persona who hates this most",
    });
  if (scSentence.length < 20)
    rejected.push({
      ref: "strongestCritic.sentence",
      message:
        "quote or closely paraphrase the sentence that makes them hate it (min 20 chars)",
    });

  const counter = typeof d.counterCase === "string" ? d.counterCase.trim() : "";
  if (counter.length < 120) {
    rejected.push({
      ref: "counterCase",
      message: `counter-case too thin (${counter.length} chars, min 120) — an adversary-only dossier talks its reader out of good ideas`,
    });
  }

  const wc = (d.weakestClaim ?? {}) as Record<string, unknown>;
  const wcClaim = typeof wc.claim === "string" ? wc.claim.trim() : "";
  const wcQ =
    typeof wc.breakingQuestion === "string" ? wc.breakingQuestion.trim() : "";
  if (wcClaim.length < 10)
    rejected.push({
      ref: "weakestClaim.claim",
      message: "state your plan's weakest load-bearing claim (min 10 chars)",
    });
  if (wcQ.length < 10)
    rejected.push({
      ref: "weakestClaim.breakingQuestion",
      message: "ask the single question that would break it (min 10 chars)",
    });

  const rawPlan = Array.isArray(d.testPlan) ? d.testPlan : [];
  if (rawPlan.length < 1 || rawPlan.length > 5) {
    rejected.push({
      ref: "testPlan",
      message: `need 1-5 ranked test questions (got ${rawPlan.length})`,
    });
  }
  const testPlan: DossierDraft["testPlan"] = [];
  for (let i = 0; i < rawPlan.length; i++) {
    const t = (rawPlan[i] ?? {}) as Record<string, unknown>;
    const question = typeof t.question === "string" ? t.question.trim() : "";
    const discriminates =
      typeof t.discriminates === "string" ? t.discriminates.trim() : "";
    const stop =
      typeof t.wouldNotShipIf === "string" ? t.wouldNotShipIf.trim() : "";
    if (question.length < 10)
      rejected.push({
        ref: `testPlan[${i}].question`,
        message: "ask a real question (min 10 chars)",
      });
    if (discriminates.length < 10)
      rejected.push({
        ref: `testPlan[${i}].discriminates`,
        message:
          "say which branch of the plan this answer decides (min 10 chars)",
      });
    if (stop.length < 10)
      rejected.push({
        ref: `testPlan[${i}].wouldNotShipIf`,
        message:
          "state the answer that should stop the launch — a question whose every answer leads to shipping is not a test (min 10 chars)",
      });
    if (rejected.every((e) => !e.ref.startsWith(`testPlan[${i}]`))) {
      testPlan.push({ question, discriminates, wouldNotShipIf: stop });
    }
  }

  const out: DossierDraft = {
    objections,
    strongestCritic: { handle: scHandle, sentence: scSentence },
    counterCase: counter,
    weakestClaim: { claim: wcClaim, breakingQuestion: wcQ },
    testPlan,
  };

  // Same numeric integrity as the report: every number must resolve to a value
  // this run produced. An objection that invents a figure is rejected even if
  // its citations are perfect.
  const verdict = verifyNumericClaims(
    collectReportData(storage, world, {
      focus: "",
      createdAt: world.createdAt,
    } as never),
    {
      executiveSummary: [counter, wcClaim, scSentence].join(" "),
      keyFindings: objections.map(
        (o) => `${o.label}. ${o.steelman} ${o.threatenedDecision}`,
      ),
      risks: [],
      confidence: {
        strongSignals: testPlan.map(
          (t) => `${t.question} ${t.discriminates} ${t.wouldNotShipIf}`,
        ),
        contested: [],
      },
    } as never,
    {
      rounds: world.config.rounds,
      population: storage.countPersonas(world.id),
    },
  );
  for (const bad of verdict.unverified.slice(0, 6)) {
    rejected.push({
      ref: bad.ref,
      message: `unverified number "${bad.token}" — this run does not contain that value. Use only figures from the stats pack (${verdict.available}), or state the claim without a number.`,
    });
  }

  return { draft: out, rejected };
}

export function renderDossierMarkdown(
  world: World,
  draft: DossierDraft,
  version: number,
): string {
  const L: string[] = [];
  L.push(`# Objection Dossier — ${world.name} (v${version})`);
  L.push("");
  L.push(
    `> A structured set of arguments against shipping, generated from a simulated run. Not a prediction. Take the objections, test the top ones with a real human, and ship or stop on what you learn.`,
  );
  L.push("");
  L.push(`## The objections, most damaging first`);
  L.push("");
  draft.objections.forEach((o, i) => {
    L.push(
      `### ${i + 1}. ${o.label} — blast radius: ${o.blastRadius.toUpperCase()}`,
    );
    L.push("");
    L.push(o.steelman);
    L.push("");
    L.push(`*Threatens:* ${o.threatenedDecision}`);
    L.push("");
    L.push(`*Evidence:* ${o.postIds.map((p) => `\`${p}\``).join(", ")}`);
    L.push("");
  });
  L.push(`## The critic who hates this most`);
  L.push("");
  L.push(
    `**${draft.strongestCritic.handle}**: "${draft.strongestCritic.sentence}"`,
  );
  L.push("");
  L.push(`## The counter-case — why ship anyway`);
  L.push("");
  L.push(draft.counterCase);
  L.push("");
  L.push(`## The weakest load-bearing claim`);
  L.push("");
  L.push(`**Claim:** ${draft.weakestClaim.claim}`);
  L.push("");
  L.push(`**Breaking question:** ${draft.weakestClaim.breakingQuestion}`);
  L.push("");
  L.push(`## Test plan — five questions for a real human, ranked`);
  L.push("");
  draft.testPlan.forEach((t, i) => {
    L.push(`${i + 1}. **${t.question}**`);
    L.push(`   - Decides: ${t.discriminates}`);
    L.push(`   - Do not ship if: ${t.wouldNotShipIf}`);
  });
  L.push("");
  L.push(`---`);
  L.push(
    `*Method: Murmur adversarial-critic mode. Personas are invented, sentiment is lexical, the projection band is slope sensitivity. See METHODOLOGY.md. Every post id above resolves in this world's database; every number was verified against the run.*`,
  );
  return L.join("\n");
}

export function quoteForObjection(d: ReportData, postId: string): string {
  const hit =
    d.quotes.positive.find((q) => q.id === postId) ??
    d.quotes.negative.find((q) => q.id === postId) ??
    d.quotes.mixed.find((q) => q.id === postId);
  return hit ? truncate(hit.body ?? "", 220) : "";
}
