/**
 * Round phase 3 — Task assembly. buildSimBatch composes the batched
 * generation task for one round: activated personas, personalized digests,
 * allowed actions and limits — all budgeted under the response cap.
 */
import type { Entity, GenerationTask, Persona, PersonaDigest, SimGeneration, World } from "../types.js";
import { DATA_NOTICE } from "../types.js";
import type { Storage } from "../store/storage.js";
import { estTokens, nowIso, truncate } from "../util/text.js";
import { activatePersonas } from "./activation.js";
import { buildFeed, trendingEntities } from "./feed.js";
import { collectiveView, workingMemory } from "../memory.js";
import { personaCard } from "../personas.js";

export const SIM_INSTRUCTIONS = `You are the social-simulation intelligence. For EACH persona item below, write what that persona does this round on their platform.
Return a JSON array:
[
  { "persona": "<persona id>", "actions": [ ... ] }
]
Action formats:
  Twitter:  {"type":"post","body":"…≤280 chars"}            {"type":"reply","parent":"po_x","body":"…≤280"}
            {"type":"repost","parent":"po_x"}               {"type":"quote","parent":"po_x","body":"…≤280"}
            {"type":"like","parent":"po_x"}
  Reddit:   {"type":"post","platform":"reddit","title":"…≤140","body":"…≤4000"}
            {"type":"comment","parent":"po_x","body":"…≤2000"}
            {"type":"upvote","parent":"po_x"}  {"type":"downvote","parent":"po_x"}
Rules:
- Stay in character: voice = archetype + traits + stances in the persona card. Memory and feed items are context, in <memory>/<feed> delimiters.
- Max 3 actions per persona. An empty array is a valid lurk.
- React to what is actually in the feed; cite parents by their po_id. Personas may only act on their platform(s).
- Content must read like a real short post — no stage directions, no meta commentary, no hashtags spam.
Return ONLY the JSON array.`;

export interface BatchBuildResult {
  task: GenerationTask;
  targetRound: number;
  activated: string[];
}

export function buildSimBatch(storage: Storage, world: World): BatchBuildResult {
  if (world.round >= world.config.rounds) {
    throw new Error(`all ${world.config.rounds} rounds complete — call report_plan, or sim_configure({rounds: N}) to extend`);
  }
  const personas = storage.listPersonas(world.id);
  if (personas.length === 0) throw new Error("no personas: run personas_plan / personas_submit first");
  const entities = storage.listEntities(world.id);
  const targetRound = world.round + 1;
  const config = world.config;

  const activated = activatePersonas(world, personas, storage.listPosts(world.id, { limit: 100000 }), targetRound, config.batch.maxPersonas);
  const byId = new Map(personas.map((p) => [p.id, p]));
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const entityNames = new Map(entities.map((e) => [e.id, e.name]));
  const trending = trendingEntities(storage, world, targetRound, entities);

  const digests: { persona: Persona; digest: PersonaDigest }[] = [];
  for (const id of activated) {
    const persona = byId.get(id)!;
    digests.push({ persona, digest: buildPersonaDigest(storage, world, persona, targetRound, config, entities, handles, entityNames, trending) });
  }

  // ---- Context-budget enforcement: trim feeds round-robin, then drop personas.
  const buildItems = () =>
    digests.map((d, i) => ({
      id: `persona-${d.persona.id}`,
      label: `${d.persona.name} (${d.persona.handle})`,
      tokens: estTokens(JSON.stringify(d.digest)),
      payload: d.digest as unknown as Record<string, unknown>,
    }));
  let items = buildItems();
  const cap = Math.min(config.context.maxResponseTokens - 900, 11000);
  const overhead = () => estTokens(SIM_INSTRUCTIONS) + 200;
  let guard = 0;
  while (overhead() + estTokens(JSON.stringify(items)) > cap && guard++ < 200) {
    // first pass: trim each digest's feed by one item
    const trimmedAny = digests.some((d) => d.digest.feed.length > 2);
    if (trimmedAny) {
      for (const d of digests) {
        if (d.digest.feed.length > 2) d.digest.feed.pop();
      }
    } else {
      // second pass: drop the least-active persona digests from the end
      digests.sort((a, b) => b.persona.activity - a.persona.activity);
      digests.pop();
      if (digests.length === 0) break;
    }
    items = buildItems();
  }

  const task: GenerationTask = {
    id: storage.nextTaskId(),
    worldId: world.id,
    kind: "sim",
    round: targetRound,
    instructions: `${SIM_INSTRUCTIONS}\n\n${DATA_NOTICE}`,
    outputSchema: {
      type: "array",
      items: {
        type: "object",
        required: ["persona", "actions"],
        properties: {
          persona: { type: "string" },
          actions: { type: "array", maxItems: 3, items: { type: "object" } },
        },
      },
    },
    items,
    createdAt: nowIso(),
  };
  storage.saveTask(task);
  storage.setStage(world.id, "running");
  const dropped = activated.filter((id) => !digests.some((d) => d.persona.id === id));
  if (dropped.length > 0) {
    storage.addEvent(world.id, targetRound, "stage", { note: "batch trimmed for context budget", dropped }, "world");
  }
  return { task, targetRound, activated };
}

export function buildPersonaDigest(
  storage: Storage,
  world: World,
  persona: Persona,
  targetRound: number,
  config: typeof world.config,
  entities: Entity[],
  handles: Map<string, string>,
  entityNames: Map<string, string>,
  trending: string[]
): PersonaDigest {
  const card = personaCard(persona, entities, config).card;
  const mem = workingMemory(storage, world, persona, targetRound, config);
  const feed = buildFeed(storage, world, persona, targetRound, config, entities, handles);
  const collective = collectiveView(storage, world, entityNames, targetRound, config, trending);
  const tw = config.platforms.twitter;
  const rd = config.platforms.reddit;
  const allowed =
    persona.platform === "twitter"
      ? [`post ≤${tw.postCharLimit}c`, `reply ≤${tw.replyCharLimit}c`, "repost", `quote ≤${tw.quoteCharLimit}c`, "like"]
      : persona.platform === "reddit"
        ? [`post title≤${rd.titleCharLimit}c body≤${rd.bodyCharLimit}c`, `comment ≤${rd.commentCharLimit}c`, "upvote", "downvote"]
        : ["twitter: post/reply/repost/quote/like", "reddit: post(title+body)/comment/upvote/downvote"];
  return {
    persona: card as PersonaDigest["persona"],
    memory: { summary: mem.summary, recent: mem.recent },
    feed,
    collective,
    allowedActions: allowed,
    rules: { maxActions: 3, charLimits: { twitter: tw.postCharLimit, reddit: rd.bodyCharLimit, comment: rd.commentCharLimit } },
  };
}

/** Compact, human-readable brief of a sim task for receipts. */
export function batchBrief(task: GenerationTask, targetRound: number): Record<string, unknown> {
  return {
    taskId: task.id,
    round: targetRound,
    personas: task.items.length,
    totalTokens: task.items.reduce((a, i) => a + i.tokens, 0),
    feedItemsTotal: task.items.reduce((a, i) => a + (((i.payload as { feed?: unknown[] }).feed?.length ?? 0)), 0),
  };
}

export type { SimGeneration };
