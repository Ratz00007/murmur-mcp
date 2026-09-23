/**
 * Round phases 4-5 — Ingestion + aggregation. Validates submitted generations
 * item by item (surgical retry), applies them through the platform mechanics,
 * runs deterministic organic engagement, updates memory and stances, computes
 * round statistics and advances the round.
 */
import { DEFAULT_CONFIG } from "../types.js";
import type { Entity, ItemError, Persona, Post, RoundStats, SimAction, SimGeneration, TaskVerdict, World } from "../types.js";
import type { Storage } from "../store/storage.js";
import { engagementScore } from "../util/engagement.js";
import { streamRng } from "../util/rng.js";
import { clamp, round2Safe, truncate } from "../util/text.js";
import { entityMentions, scoreSentiment } from "../sentiment.js";
import { appendEpisodic, compactIfNeeded } from "../memory.js";
import { buildRoundStats, computeMovers } from "../aggregate.js";

export interface SimSubmitResult {
  taskId: string;
  round: number | null;
  advanced: boolean;
  completed: boolean;
  appliedPersonas: string[];
  lurkers: string[];
  rejected: ItemError[];
  postsCreated: number;
  stats: RoundStats | null;
  next: string;
}

export function submitGenerations(
  storage: Storage,
  world: World,
  taskId: string,
  submissions: SimGeneration[],
  opts: { finalize?: boolean } = {}
): SimSubmitResult {
  const task = storage.getTask(taskId);
  if (!task || task.worldId !== world.id || task.kind !== "sim") {
    throw new Error(`unknown sim task: ${taskId}`);
  }
  const targetRound = task.round ?? world.round + 1;
  if (targetRound !== world.round + 1) {
    throw new Error(`task round ${targetRound} does not match world state (next expected round ${world.round + 1}) — the round already advanced`);
  }
  const config = world.config;
  const personas = storage.listPersonas(world.id);
  const entities = storage.listEntities(world.id);
  const handles = new Map(personas.map((p) => [p.handle.toLowerCase(), p]));
  const byId = new Map(personas.map((p) => [p.id, p]));

  const activated: Persona[] = task.items.map((i) => byId.get(String(i.id).replace(/^persona-/, ""))).filter((p): p is Persona => !!p);
  const activatedIds = new Set(activated.map((p) => p.id));
  const itemPersona = new Map<string, Persona>(activated.map((p) => [p.id, p]));
  for (const p of activated) itemPersona.set(p.handle.toLowerCase(), p);

  const priorVerdicts = storage.getTaskVerdicts(taskId);
  const alreadyApplied = new Set(priorVerdicts?.applied ?? []);

  const rejected: ItemError[] = [];
  const valid: { persona: Persona; actions: SimAction[] }[] = [];
  const seen = new Set<string>();

  const raw = Array.isArray(submissions) ? submissions : [];
  raw.forEach((g, gi) => {
    const ref = `generations[${gi}] (${g?.persona ?? "?"})`;
    let persona = byId.get(String(g?.persona));
    if (!persona) persona = handles.get(String(g?.persona ?? "").toLowerCase());
    if (!persona) {
      rejected.push({ ref, field: "persona", message: `unknown persona "${g?.persona}"`, hint: "use persona ids from the task items (e.g. p_3)" });
      return;
    }
    if (!activatedIds.has(persona.id)) {
      rejected.push({ ref, field: "persona", message: `${persona.name} (${persona.id}) is not activated in this batch`, hint: "only personas listed in the task may act this round" });
      return;
    }
    if (alreadyApplied.has(persona.id) || seen.has(persona.id)) {
      rejected.push({ ref, field: "persona", message: `${persona.id} already applied in this round` });
      return;
    }
    const actions = Array.isArray(g?.actions) ? g.actions : [];
    if (actions.length > 3) {
      rejected.push({ ref, field: "actions", message: `${actions.length} actions (max 3)` });
      return;
    }
    const actionErrors = validateActions(storage, world, persona, actions, entities);
    if (actionErrors.length > 0) {
      rejected.push(...actionErrors.map((e) => ({ ...e, ref: `${ref} ${e.ref}` })));
      return;
    }
    seen.add(persona.id);
    valid.push({ persona, actions });
  });

  // ---- Apply valid generations deterministically -------------------------
  const appliedPersonas = new Set([...alreadyApplied]);
  const lurkers: string[] = [];
  // Per-world count so post ids are deterministic for this world alone and
  // never depend on how many posts other worlds happen to hold.
  let postIdBase = storage.countPosts(world.id) + 1;
  const mintId = () => `po_${postIdBase++}`;
  const newPosts: Post[] = [];

  for (const { persona, actions } of valid) {
    if (actions.length === 0) {
      lurkers.push(persona.id);
      appliedPersonas.add(persona.id);
      continue;
    }
    // persona witnesses active injections (episodic)
    for (const ev of storage.listEvents(world.id, { type: "injection" })) {
      if (ev.round === targetRound) {
        appendEpisodic(storage, world, persona.id, targetRound, `Witnessed news: ${truncate(String(ev.payload.text ?? ""), 160)}`, 0.7);
      }
    }
    for (const action of actions) {
      applyAction(storage, world, persona, action, targetRound, entities, mintId, newPosts);
    }
    appliedPersonas.add(persona.id);
  }

  // ---- Decide whether the round advances ---------------------------------
  // Sticky hold: prior rejections that are still unfixed keep the round held,
  // even if this particular submission introduced no new errors.
  const stickyRejects = (priorVerdicts?.rejected ?? []).filter((r) => {
    const m = String(r.ref).match(/\((p_\d+)\)/);
    const pid = m?.[1];
    return !!pid && activatedIds.has(pid) && !alreadyApplied.has(pid) && !valid.some((v) => v.persona.id === pid);
  });
  const mergedRejected = [...rejected, ...stickyRejects];
  const missing = activated.filter((p) => !appliedPersonas.has(p.id) && !mergedRejected.some((r) => r.ref.includes(p.id)));
  const held = !opts.finalize && mergedRejected.length > 0;
  if (!held) {
    for (const p of missing) lurkers.push(p.id);
    // organic engagement + platform mechanics on this round's generated posts
    const organic = organicEngagement(storage, world, targetRound, newPosts, personas, entities, mintId);
    const newViral = checkVirality(storage, world, targetRound, newPosts, personas.length);
    // memory compaction for everyone who acted this round
    for (const pid of appliedPersonas) {
      const persona = byId.get(pid);
      if (persona) compactIfNeeded(storage, world, persona, config);
    }
    const movers = computeMovers(storage, world, persona => byId.get(persona), newPosts);
    const stats = buildRoundStats(storage, world, targetRound, [...appliedPersonas], lurkers, movers, newViral);
    storage.addEvent(world.id, targetRound, "round_stats", { stats: stats as unknown as Record<string, unknown> }, "world");
    storage.updateWorld(world.id, { round: targetRound });
    const completed = targetRound >= config.rounds;
    storage.setStage(world.id, completed ? "completed" : "running");
    const verdict: TaskVerdict = { taskId, applied: [...appliedPersonas], rejected: mergedRejected };
    storage.completeTask(taskId, raw, verdict, "submitted");
    void organic;
    return {
      taskId,
      round: targetRound,
      advanced: true,
      completed,
      appliedPersonas: [...appliedPersonas],
      lurkers,
      rejected: mergedRejected,
      postsCreated: newPosts.length,
      stats,
      next: completed
        ? "all rounds complete — call report_plan to draft the prediction report"
        : `call sim_next_batch for round ${targetRound + 1}`,
    };
  }

  const verdict: TaskVerdict = { taskId, applied: [...appliedPersonas], rejected: mergedRejected };
  storage.completeTask(taskId, raw, verdict, "held");
  return {
    taskId,
    round: null,
    advanced: false,
    completed: false,
    appliedPersonas: [...appliedPersonas],
    lurkers,
    rejected: mergedRejected,
    postsCreated: newPosts.length,
    stats: null,
    next: "round held: fix the rejected items and resubmit only those personas, or resubmit with finalize:true to lurk them and advance",
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateActions(storage: Storage, world: World, persona: Persona, actions: SimAction[], entities: Entity[]): ItemError[] {
  const errors: ItemError[] = [];
  const tw = world.config.platforms.twitter;
  const rd = world.config.platforms.reddit;
  actions.forEach((a, i) => {
    const ref = `actions[${i}]`;
    const type = a?.type;
    if (!type || typeof type !== "string") {
      errors.push({ ref, field: "type", message: "missing action type" });
      return;
    }
    const plat = persona.platform;
    switch (type) {
      case "post": {
        const target = "platform" in a && a.platform ? a.platform : plat === "both" ? "twitter" : (plat as "twitter" | "reddit");
        if (plat !== "both" && target !== plat) {
          errors.push({ ref, field: "platform", message: `persona is ${plat}-only` });
          return;
        }
        if (target === "twitter") {
          if (!str(a.body)) errors.push({ ref, field: "body", message: "post body required" });
          else if (a.body.length > tw.postCharLimit) errors.push({ ref, field: "body", message: `${a.body.length} chars (max ${tw.postCharLimit})` });
        } else {
          if (!str(a.title)) errors.push({ ref, field: "title", message: "reddit post requires a title" });
          else if (a.title.length > rd.titleCharLimit) errors.push({ ref, field: "title", message: `${a.title.length} chars (max ${rd.titleCharLimit})` });
          if (!str(a.body)) errors.push({ ref, field: "body", message: "reddit post requires a body" });
          else if (a.body.length > rd.bodyCharLimit) errors.push({ ref, field: "body", message: `${a.body.length} chars (max ${rd.bodyCharLimit})` });
        }
        break;
      }
      case "reply":
      case "quote":
      case "like": {
        if (plat === "reddit") {
          errors.push({ ref, field: "type", message: `${type} is a twitter action; persona is reddit-only` });
          return;
        }
        const parent = mustPost(storage, world, a.parent, ref, errors);
        if (parent && parent.platform !== "twitter") errors.push({ ref, field: "parent", message: `parent ${parent.id} is not a twitter post` });
        if ((type === "reply" || type === "quote") && (!str(a.body) || a.body.length > tw.replyCharLimit)) {
          errors.push({ ref, field: "body", message: `body required, max ${tw.replyCharLimit} chars` });
        }
        break;
      }
      case "repost": {
        if (plat === "reddit") {
          errors.push({ ref, field: "type", message: "repost is a twitter action; persona is reddit-only" });
          return;
        }
        mustPost(storage, world, a.parent, ref, errors);
        break;
      }
      case "comment":
      case "upvote":
      case "downvote": {
        if (plat === "twitter") {
          errors.push({ ref, field: "type", message: `${type} is a reddit action; persona is twitter-only` });
          return;
        }
        const parent = mustPost(storage, world, a.parent, ref, errors);
        if (parent && parent.platform !== "reddit") errors.push({ ref, field: "parent", message: `parent ${parent.id} is not a reddit post/comment` });
        if (parent && type === "comment") {
          if (!str(a.body) || a.body.length > rd.commentCharLimit) {
            errors.push({ ref, field: "body", message: `comment body required, max ${rd.commentCharLimit} chars` });
          }
          if (threadDepthOf(storage, world, parent) >= rd.threadDepth) {
            errors.push({ ref, field: "parent", message: `thread depth cap ${rd.threadDepth} reached — reply shallower` });
          }
        }
        break;
      }
      default:
        errors.push({ ref, field: "type", message: `unknown action type "${type}"` });
    }
  });
  void entities;
  return errors;
}

function mustPost(storage: Storage, world: import("../types.js").World, id: unknown, ref: string, errors: ItemError[]): Post | null {
  if (typeof id !== "string" || !id) {
    errors.push({ ref, field: "parent", message: "parent post id required" });
    return null;
  }
  const post = storage.getPost(world.id, id);
  if (!post) {
    errors.push({ ref, field: "parent", message: `parent post not found: ${id}` });
    return null;
  }
  return post;
}

function str(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function threadDepthOf(storage: Storage, world: import("../types.js").World, post: Post): number {
  let depth = 0;
  let cur: Post | null = post;
  while (cur?.parentId && depth < 50) {
    cur = storage.getPost(world.id, cur.parentId);
    depth++;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function applyAction(
  storage: Storage,
  world: World,
  persona: Persona,
  action: SimAction,
  round: number,
  entities: Entity[],
  mintId: () => string,
  newPosts: Post[]
): void {
  const plat = persona.platform;
  const authorFollowers = (id: string) => storage.listPersonas(world.id).filter((p) => p.follows.includes(id)).length;

  const makePost = (over: Partial<Post> & { platform: "twitter" | "reddit"; kind: Post["kind"]; body: string }): Post => {
    const text = over.title ? `${over.title} ${over.body}` : over.body;
    const mentions = entityMentions(text, entities);
    const post: Post = {
      id: mintId(),
      worldId: world.id,
      round,
      personaId: persona.id,
      platform: over.platform,
      kind: over.kind,
      parentId: over.parentId ?? null,
      threadId: over.parentId ? (storage.getPost(world.id, over.parentId)?.threadId ?? "") : "",
      communityId: over.communityId ?? null,
      title: over.title ?? null,
      body: over.body,
      metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: authorFollowers(persona.id) + 2 },
      mentions,
      origin: "generated",
    };
    if (!post.threadId) post.threadId = post.id;
    const inserted = storage.insertPost(post);
    newPosts.push(inserted);
    const about = mentions.length > 0 ? ` about ${mentions.map((m) => entityName(entities, m.entityId)).join(", ")}` : "";
    const s = Math.abs(mentions[0]?.score ?? scoreSentiment(text).score);
    appendEpisodic(
      storage,
      world,
      persona.id,
      round,
      `${verbFor(inserted.kind)} on ${inserted.platform} r${round}${about}: "${truncate(inserted.body, 140)}"`,
      clamp(0.35 + 0.25 * s, 0, 1)
    );
    return inserted;
  };

  const bump = (postId: string, field: "likes" | "reposts" | "upvotes" | "downvotes") => {
    const p = storage.getPost(world.id, postId);
    if (!p) return;
    p.metrics[field]++;
    storage.updatePostMetrics(world.id, p.id, p.metrics);
  };

  switch (action.type) {
    case "post": {
      const target = "platform" in action && action.platform ? action.platform : plat === "both" ? "twitter" : (plat as "twitter" | "reddit");
      if (target === "reddit") {
        makePost({ platform: "reddit", kind: "post", title: action.title!, body: action.body, communityId: persona.communityIds[0] ?? null });
      } else {
        makePost({ platform: "twitter", kind: "post", body: action.body });
      }
      break;
    }
    case "reply":
    case "quote": {
      const parent = storage.getPost(world.id, action.parent)!;
      makePost({ platform: "twitter", kind: action.type, parentId: parent.id, body: action.body });
      break;
    }
    case "repost": {
      const parent = storage.getPost(world.id, action.parent)!;
      bump(parent.id, "reposts");
      const note = "note" in action && typeof action.note === "string" ? action.note.trim() : "";
      if (note) {
        makePost({ platform: "twitter", kind: "quote", parentId: parent.id, body: note });
      } else {
        makePost({ platform: "twitter", kind: "repost", parentId: parent.id, body: `↻ ${truncate(parent.body, 200)}` });
      }
      appendEpisodic(storage, world, persona.id, round, `Reposted ${parent.id}`, 0.25);
      break;
    }
    case "like": {
      bump(action.parent, "likes");
      const parent = storage.getPost(world.id, action.parent)!;
      appendEpisodic(storage, world, persona.id, round, `Liked ${parent.id}: "${truncate(parent.body, 100)}"`, 0.2);
      break;
    }
    case "comment": {
      const parent = storage.getPost(world.id, action.parent)!;
      makePost({ platform: "reddit", kind: "comment", parentId: parent.id, communityId: parent.communityId, body: action.body });
      break;
    }
    case "upvote":
    case "downvote": {
      bump(action.parent, action.type === "upvote" ? "upvotes" : "downvotes");
      const parent = storage.getPost(world.id, action.parent)!;
      appendEpisodic(storage, world, persona.id, round, `${action.type === "upvote" ? "Upvoted" : "Downvoted"} ${parent.id}: "${truncate(parent.body, 100)}"`, 0.2);
      break;
    }
  }
}

function verbFor(kind: Post["kind"]): string {
  return kind === "reply" ? "Replied" : kind === "comment" ? "Commented" : kind === "repost" ? "Reposted" : kind === "quote" ? "Quoted" : "Posted";
}

function entityName(entities: Entity[], id: string): string {
  return entities.find((e) => e.id === id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// Organic engagement (deterministic)
// ---------------------------------------------------------------------------

function organicEngagement(
  storage: Storage,
  world: World,
  round: number,
  newPosts: Post[],
  personas: Persona[],
  entities: Entity[],
  mintId: () => string
): { likes: number; reposts: number; upvotes: number; downvotes: number } {
  const rng = streamRng(world.seed, `organic:${round}`);
  const cfg = world.config.engagement;
  const tally = { likes: 0, reposts: 0, upvotes: 0, downvotes: 0 };
  const audit: Record<string, unknown>[] = [];
  const byId = new Map(personas.map((p) => [p.id, p]));
  let cascaded = 0; // viewers engaged by the multi-hop cascade (below)

  for (const post of newPosts) {
    if (post.kind === "repost") continue; // re-shares don't compound
    const eligible =
      post.platform === "twitter"
        ? personas.filter((p) => p.id !== post.personaId && (p.platform === "twitter" || p.platform === "both") && (p.follows.includes(post.personaId) || rng.float() < 0.3))
        : personas.filter((p) => p.id !== post.personaId && p.communityIds.includes(post.communityId ?? "") && (p.platform === "reddit" || p.platform === "both"));
    if (eligible.length === 0) continue;
    const cap = Math.max(2, Math.floor(eligible.length * cfg.organicCapPerPost));
    let engaged = 0;
    for (const viewer of [...eligible].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
      const align = alignment(viewer, post);
      const affinity = viewer.follows.includes(post.personaId) ? 1 : 0.25;
      const pEngage = cfg.organicLikeBase + 0.22 * affinity + 0.18 * Math.abs(align);
      if (rng.float() >= pEngage) continue;
      engaged++;
      if (post.platform === "twitter") {
        if (align >= 0) {
          const strong = align > 0.4 && rng.float() < 0.18;
          if (strong) {
            bumpAndAudit(storage, world, post.id, "reposts");
            tally.reposts++;
            const rp: Post = {
              id: mintId(),
              worldId: world.id,
              round,
              personaId: viewer.id,
              platform: "twitter",
              kind: "repost",
              parentId: post.id,
              threadId: post.threadId,
              communityId: null,
              title: null,
              body: `↻ ${truncate(post.body, 200)}`,
              metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 2 },
              mentions: post.mentions,
              origin: "organic",
            };
            storage.insertPost(rp);
            audit.push({ post: post.id, viewer: viewer.id, action: "repost" });
          } else {
            bumpAndAudit(storage, world, post.id, "likes");
            tally.likes++;
            audit.push({ post: post.id, viewer: viewer.id, action: "like" });
          }
        } // negative-aligned twitter users mostly lurk (no downvote mechanic)
      } else {
        if (align >= 0) {
          bumpAndAudit(storage, world, post.id, "upvotes");
          tally.upvotes++;
          audit.push({ post: post.id, viewer: viewer.id, action: "upvote" });
        } else {
          bumpAndAudit(storage, world, post.id, "downvotes");
          tally.downvotes++;
          audit.push({ post: post.id, viewer: viewer.id, action: "downvote" });
        }
      }
      if (engaged >= cap) break;
    }

    // ---- Multi-hop cascade (seeded) ------------------------------------------
    // Beyond the one-hop pass above, engagement propagates along the follow
    // graph: each reached node engages and passes the post on with
    // prob = min(cascade.maxProb, base + factor·engagementScore/threshold),
    // attenuated ×cascade.attenuation per hop, up to cascade.maxHops hops.
    // The cascade shares the one-hop engaged counter, so organicCapPerPost
    // still caps engagement per post. Every (round, post, hop) draws from its
    // own streamRng stream — never unseeded randomness.
    if (post.platform === "twitter") {
      // worlds persisted before the cascade block existed read back without it
      const cas = { ...DEFAULT_CONFIG.cascade, ...(world.config.cascade ?? {}) };
      const seen = new Set<string>(eligible.map((p) => p.id));
      seen.add(post.personaId);
      const followersOfId = (id: string): Persona[] => personas.filter((p) => p.follows.includes(id));
      // seed the frontier at followers-of-followers (distance ≥ 2; distance 1
      // was the direct pass above)
      let frontier = new Map<string, Persona>();
      for (const f of followersOfId(post.personaId)) {
        for (const g of followersOfId(f.id)) {
          if (!seen.has(g.id)) frontier.set(g.id, g);
        }
      }
      const threshold = Math.max(1, cas.threshold);
      for (let hop = 1; hop <= cas.maxHops && engaged < cap && frontier.size > 0; hop++) {
        const pPropagate =
          Math.min(cas.maxProb, cas.base + (cas.factor * engagementScore(post.metrics)) / threshold) *
          Math.pow(cas.attenuation, hop - 1);
        const hopRng = streamRng(world.seed, `cascade:${round}:${post.id}:${hop}`);
        const ordered = [...frontier.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        frontier = new Map();
        for (const viewer of ordered) {
          if (seen.has(viewer.id)) continue;
          seen.add(viewer.id);
          if (hopRng.float() >= pPropagate) continue; // this branch dies here
          const align = alignment(viewer, post);
          engaged++;
          cascaded++;
          if (align >= 0) {
            const strong = align > 0.4 && hopRng.float() < 0.18;
            if (strong) {
              bumpAndAudit(storage, world, post.id, "reposts");
              tally.reposts++;
              const rp: Post = {
                id: mintId(),
                worldId: world.id,
                round,
                personaId: viewer.id,
                platform: "twitter",
                kind: "repost",
                parentId: post.id,
                threadId: post.threadId,
                communityId: null,
                title: null,
                body: `↻ ${truncate(post.body, 200)}`,
                metrics: { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 2 },
                mentions: post.mentions,
                origin: "organic",
              };
              storage.insertPost(rp);
              audit.push({ post: post.id, viewer: viewer.id, action: "repost", hop });
            } else {
              bumpAndAudit(storage, world, post.id, "likes");
              tally.likes++;
              audit.push({ post: post.id, viewer: viewer.id, action: "like", hop });
            }
          } // negative-aligned viewers lurk, as in the one-hop pass
          if (engaged >= cap) break;
          // engaged nodes propagate to their own followers next hop
          if (hop < cas.maxHops) {
            for (const n of followersOfId(viewer.id)) {
              if (!seen.has(n.id)) frontier.set(n.id, n);
            }
          }
        }
      }
    }
  }
  storage.addEvent(world.id, round, "organic", { tally, cascaded, audit: audit.slice(0, 400) }, "world");
  void byId;
  void entities;
  return tally;
}

function bumpAndAudit(storage: Storage, world: World, postId: string, field: "likes" | "reposts" | "upvotes" | "downvotes"): void {
  const p = storage.getPost(world.id, postId);
  if (!p) return;
  p.metrics[field]++;
  storage.updatePostMetrics(world.id, p.id, p.metrics);
}

function alignment(viewer: Persona, post: Post): number {
  if (post.mentions.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const m of post.mentions) {
    const stance = viewer.stances[m.entityId];
    if (stance === undefined) continue;
    sum += stance * Math.sign(m.score || 1) * Math.min(1, Math.abs(m.score) + 0.2);
    n++;
  }
  return n === 0 ? 0 : clamp(sum / n, -1, 1);
}

function checkVirality(storage: Storage, world: World, round: number, newPosts: Post[], population: number): string[] {
  const threshold = world.config.engagement.viralityThreshold * Math.max(1, population / 24);
  const viral: string[] = [];
  for (const p of newPosts) {
    // Canonical engagement keeps virality consistent with reports/analytics.
    // Only twitter posts take the branch below, and the twitter path never
    // bumps vote fields, so the viralityThreshold keeps its likes + 2×reposts
    // semantics exactly.
    const engagement = engagementScore(p.metrics);
    if (p.platform === "twitter" && p.kind !== "repost" && engagement >= threshold) {
      viral.push(p.id);
      storage.addEvent(world.id, round, "viral", { postId: p.id, engagement }, "world");
    }
    if (p.platform === "reddit" && p.kind === "post") {
      const age = round - p.round + 1;
      const score = (p.metrics.upvotes - p.metrics.downvotes + 1) / Math.pow(age + 1, world.config.platforms.reddit.gravity);
      if (score >= world.config.engagement.hotThreshold) {
        storage.addEvent(world.id, round, "hot", { postId: p.id, score: round2Safe(score) }, "world");
      }
    }
  }
  return viral;
}
