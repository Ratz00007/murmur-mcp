/**
 * Round phase 5 — Aggregation + trajectory analysis. Pure functions over
 * stored state: sentiment per entity, stance migration, escalation chains,
 * engagement peaks, leaderboards, timelines.
 */
import type { Entity, EscalationChain, Post, RoundStats, World } from "./types.js";
import type { Storage } from "./store/storage.js";
import { scoreSentiment } from "./sentiment.js";
import { engagementScore } from "./util/engagement.js";
import { round2Safe } from "./util/text.js";
import { applyOpinionDynamics } from "./dynamics/opinion.js";

export interface Mover {
  personaId: string;
  entity: string;
  from: number;
  to: number;
}

/** Stance migration: personas drift toward what they expressed this round. */
export function computeMovers(storage: Storage, world: World, resolve: (id: string) => import("./types.js").Persona | undefined, newPosts: Post[]): Mover[] {
  const movers: Mover[] = [];
  const entities = storage.listEntities(world.id);
  const byPersona = new Map<string, Post[]>();
  for (const p of newPosts) {
    if (p.origin !== "generated") continue;
    const arr = byPersona.get(p.personaId);
    if (arr) arr.push(p);
    else byPersona.set(p.personaId, [p]);
  }
  for (const [personaId, posts] of [...byPersona.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    const persona = resolve(personaId);
    if (!persona) continue;
    const entities2 = entities;
    const entityNames = new Map(entities2.map((e) => [e.id, e.name]));
    for (const entity of entities2) {
      const relevant = posts.filter((p) => p.mentions.some((m) => m.entityId === entity.id));
      if (relevant.length === 0) continue;
      const expressed = mean(relevant.flatMap((p) => p.mentions.filter((m) => m.entityId === entity.id).map((m) => m.score)).filter((v) => Math.abs(v) >= 0.15));
      if (expressed === null) continue;
      const current = persona.stances[entity.id] ?? 0;
      const next = round2Safe(Math.max(-1, Math.min(1, current + 0.1 * (expressed - current))));
      if (Math.abs(next - current) >= 0.02) {
        persona.stances[entity.id] = next;
        movers.push({ personaId, entity: entityNames.get(entity.id) ?? entity.id, from: round2Safe(current), to: next });
      }
    }
    storage.patchPersona(persona.id, { stances: persona.stances });
  }

  // Pairwise influence step — Deffuant bounded-confidence dynamics over the
  // follow graph, layered AFTER (never instead of) the self-expression
  // update above. All randomness derives from streamRng(world.seed,
  // `dynamics:${round}:${i}`) inside applyOpinionDynamics, so replays of the
  // same world seed stay byte-identical. Round comes from this round's posts
  // (the world round has not advanced yet at this point in ingest).
  const dynRound = newPosts.length > 0 ? Math.max(...newPosts.map((p) => p.round)) : world.round + 1;
  const dynPopulation = storage.listPersonas(world.id);
  const dyn = applyOpinionDynamics(world, dynRound, { ...(world.config.dynamics ?? {}), personas: dynPopulation });
  if (dyn.changed.length > 0) {
    const entityNames = new Map(entities.map((e) => [e.id, e.name]));
    const byDynId = new Map(dynPopulation.map((p) => [p.id, p]));
    for (const m of dyn.changed) {
      // Same migration threshold as the self-expression movers above.
      if (Math.abs(m.to - m.from) >= 0.02) {
        movers.push({ personaId: m.personaId, entity: entityNames.get(m.entityId) ?? m.entityId, from: round2Safe(m.from), to: m.to });
      }
    }
    for (const id of new Set(dyn.changed.map((m) => m.personaId))) {
      const p = byDynId.get(id);
      if (p) storage.patchPersona(p.id, { stances: p.stances });
    }
  }
  return movers;
}

export function mean(v: number[]): number | null {
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function buildRoundStats(
  storage: Storage,
  world: World,
  round: number,
  activated: string[],
  lurkers: string[],
  movers: Mover[],
  newViral: string[]
): RoundStats {
  const posts = storage.listPosts(world.id, { minRound: round, maxRound: round, limit: 100000 });
  const entities = storage.listEntities(world.id);
  const entityNames = new Map(entities.map((e) => [e.id, e.name]));
  const postsByPlatform = { twitter: 0, reddit: 0 };
  const actions = { posts: 0, replies: 0, comments: 0, reposts: 0, quotes: 0, votes: 0 };
  const engagement = { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 };
  const sentimentAcc = new Map<string, number[]>();
  for (const p of posts) {
    postsByPlatform[p.platform]++;
    if (p.kind === "post") actions.posts++;
    else if (p.kind === "reply") actions.replies++;
    else if (p.kind === "comment") actions.comments++;
    else if (p.kind === "repost") actions.reposts++;
    else if (p.kind === "quote") actions.quotes++;
    engagement.likes += p.metrics.likes;
    engagement.reposts += p.metrics.reposts;
    engagement.upvotes += p.metrics.upvotes;
    engagement.downvotes += p.metrics.downvotes;
    engagement.impressions += p.metrics.impressions;
    for (const m of p.mentions) {
      const arr = sentimentAcc.get(m.entityId);
      if (arr) arr.push(m.score);
      else sentimentAcc.set(m.entityId, [m.score]);
    }
  }
  // votes counted from interactions this round (organic + generated bumps are
  // already reflected in metrics; approximate from engagement deltas)
  actions.votes = engagement.likes + engagement.upvotes + engagement.downvotes;
  const sentimentByEntity: Record<string, number> = {};
  for (const [id, arr] of [...sentimentAcc.entries()].sort()) {
    const m = mean(arr);
    if (m !== null && entityNames.has(id)) sentimentByEntity[entityNames.get(id)!] = round2Safe(m);
  }
  const escalations = escalationChains(storage, world, round, 5);
  const injections = storage.listEvents(world.id, { type: "injection", sinceRound: round, upToRound: round }).map((e) => e.id);
  return {
    round,
    postsByPlatform,
    actions,
    engagement,
    sentimentByEntity,
    topMovers: movers.slice(0, 8),
    escalations,
    newViral,
    injections,
    activated,
    lurkers,
  };
}

/** Reply/comment chains where sentiment intensifies as the thread deepens. */
export function escalationChains(storage: Storage, world: World, round: number, top = 5): EscalationChain[] {
  const posts = storage.listPosts(world.id, { minRound: round - 2, maxRound: round, limit: 100000 });
  const byId = new Map(posts.map((p) => [p.id, p]));
  const children = new Map<string, Post[]>();
  const roots: Post[] = [];
  for (const p of posts) {
    if (p.kind === "reply" || p.kind === "comment") {
      if (!byId.has(p.parentId ?? "")) {
        roots.push(p);
        continue;
      }
      const arr = children.get(p.parentId!);
      if (arr) arr.push(p);
      else children.set(p.parentId!, [p]);
    }
  }
  const chains: EscalationChain[] = [];
  const walk = (path: Post[]) => {
    const leaf = path[path.length - 1];
    const kids = (children.get(leaf.id) ?? []).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    if (kids.length === 0) {
      if (path.length >= 3) {
        const sentiments = path.map((p) => postSentiment(p));
        const intensify = sentiments.slice(1).filter((s, i) => Math.abs(s) >= Math.abs(sentiments[i]) - 0.05).length;
        const grew = Math.abs(sentiments[sentiments.length - 1]) > Math.abs(sentiments[0]) + 0.1;
        if (intensify >= path.length / 2 && grew) {
          chains.push({
            rootId: path[0].id,
            path: path.map((p) => p.id),
            depth: path.length,
            participants: [...new Set(path.map((p) => p.personaId))],
            finalSentiment: round2Safe(sentiments[sentiments.length - 1]),
            severity: round2Safe(path.length * (Math.abs(sentiments[sentiments.length - 1]) + 0.3)),
          });
        }
      }
      return;
    }
    for (const k of kids) walk([...path, k]);
  };
  for (const r of roots.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) walk([r]);
  return chains.sort((a, b) => b.severity - a.severity || a.rootId.localeCompare(b.rootId)).slice(0, top);
}

export function postSentiment(p: Post): number {
  if (p.mentions.length > 0) return mean(p.mentions.map((m) => m.score)) ?? 0;
  return scoreSentiment(p.body).score;
}

export interface LeaderRow {
  personaId: string;
  handle: string;
  name: string;
  archetype: string;
  posts: number;
  engagementReceived: number;
  engagementGiven: number;
}

export function leaderboards(storage: Storage, world: World, limit = 10): LeaderRow[] {
  const personas = storage.listPersonas(world.id);
  const posts = storage.listPosts(world.id, { limit: 100000 });
  const rows = personas.map((p) => {
    const own = posts.filter((x) => x.personaId === p.id);
    const received = own.reduce(
      (a, x) => a + engagementScore(x.metrics),
      0
    );
    const given = own.reduce((a, x) => a + 0, 0); // generated votes are metric bumps on others' posts
    return { personaId: p.id, handle: p.handle, name: p.name, archetype: p.archetype, posts: own.length, engagementReceived: received, engagementGiven: given };
  });
  return rows.sort((a, b) => b.engagementReceived - a.engagementReceived || a.personaId.localeCompare(b.personaId)).slice(0, limit);
}

export interface TimelineRow {
  round: number;
  twitter: number;
  reddit: number;
  engagement: number;
  sentimentByEntity: Record<string, number>;
  escalations: number;
  injections: number;
  lurkers: number;
}

export function timeline(storage: Storage, world: World): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (let r = 1; r <= world.round; r++) {
    const ev = storage
      .listEvents(world.id, { type: "round_stats" })
      .find((e) => e.round === r);
    const stats = (ev?.payload?.stats ?? null) as RoundStats | null;
    if (stats) {
      rows.push({
        round: r,
        twitter: stats.postsByPlatform.twitter,
        reddit: stats.postsByPlatform.reddit,
        engagement: engagementScore(stats.engagement),
        sentimentByEntity: stats.sentimentByEntity,
        escalations: stats.escalations.length,
        injections: stats.injections.length,
        lurkers: stats.lurkers.length,
      });
    }
  }
  return rows;
}

export function engagementPeaks(rows: TimelineRow[]): number[] {
  const series = rows.map((r) => r.engagement);
  if (series.length < 3) return [];
  const m = mean(series) ?? 0;
  const sd = Math.sqrt(mean(series.map((v) => (v - m) * (v - m))) ?? 0);
  if (sd === 0) return [];
  return rows.filter((r) => r.engagement > m + 2 * sd).map((r) => r.round);
}

/** Per-round sentiment curve for one entity, over the whole run. */
export function sentimentCurve(storage: Storage, world: World, entity: Entity): { round: number; value: number }[] {
  const out: { round: number; value: number }[] = [];
  for (let r = 1; r <= world.round; r++) {
    const posts = storage.listPosts(world.id, { minRound: r, maxRound: r, limit: 100000 });
    const scores = posts.flatMap((p) => p.mentions.filter((m) => m.entityId === entity.id).map((m) => m.score));
    const m = mean(scores);
    if (m !== null) out.push({ round: r, value: round2Safe(m) });
  }
  return out;
}

export function topPostsByEngagement(storage: Storage, world: World, limit = 10, minAbsSentiment = 0): { post: Post; sentiment: number }[] {
  const posts = storage
    .listPosts(world.id, { limit: 100000 })
    .filter((p) => p.kind !== "repost");
  const scored = posts.map((p) => {
    const engagement = engagementScore(p.metrics);
    return { post: p, engagement, sentiment: postSentiment(p) };
  });
  return scored
    .filter((s) => Math.abs(s.sentiment) >= minAbsSentiment)
    .sort((a, b) => b.engagement - a.engagement || a.post.id.localeCompare(b.post.id))
    .slice(0, limit)
    .map((s) => ({ post: s.post, sentiment: round2Safe(s.sentiment) }));
}
