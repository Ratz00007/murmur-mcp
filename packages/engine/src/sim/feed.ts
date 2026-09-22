/**
 * Round phase 2 — Digest composition. Platform mechanics, reimplemented
 * deterministically: Twitter-style ranking with retweet amplification and a
 * Reddit-style thread tree with vote gravity.
 */
import type { Entity, FeedDigestItem, MurmurConfig, Persona, Post, World } from "../types.js";
import type { Storage } from "../store/storage.js";
import { truncate } from "../util/text.js";

export function engagementNorm(p: Post): number {
  const e = p.metrics.likes + 2 * p.metrics.reposts + p.metrics.upvotes + p.metrics.downvotes;
  return e / (1 + e);
}

export function twitterScore(post: Post, viewer: Persona, targetRound: number, viral: Set<string>, entities: Entity[]): number {
  const age = targetRound - post.round;
  const recency = Math.exp(-age / 3);
  const follows = viewer.follows.includes(post.personaId) ? 0.25 : viral.has(post.id) ? 0.15 : 0.02;
  const salience = stanceSalience(post, viewer, entities);
  return recency + 0.55 * engagementNorm(post) + follows + 0.2 * salience;
}

export function redditScore(post: Post, targetRound: number, gravity: number): number {
  const age = targetRound - post.round;
  const score = post.metrics.upvotes - post.metrics.downvotes + 1;
  return score / Math.pow(age + 2, gravity);
}

function stanceSalience(post: Post, viewer: Persona, entities: Entity[]): number {
  const byId = new Map(entities.map((e) => [e.id, e]));
  let s = 0;
  for (const m of post.mentions) {
    const e = byId.get(m.entityId);
    if (!e) continue;
    const stance = viewer.stances[m.entityId];
    if (stance !== undefined) s += Math.abs(stance) * e.salience;
  }
  return Math.min(1, s);
}

/** Build the personalized, budget-truncated feed slice for one persona. */
export function buildFeed(
  storage: Storage,
  world: World,
  persona: Persona,
  targetRound: number,
  config: MurmurConfig,
  entities: Entity[],
  handles: Map<string, string>
): FeedDigestItem[] {
  const posts = storage.listPosts(world.id, { minRound: targetRound - 4, maxRound: targetRound - 1, limit: 800 });
  const viral = new Set(
    storage
      .listEvents(world.id, { type: "viral", sinceRound: targetRound - 3 })
      .map((e) => String(e.payload.postId ?? ""))
      .filter(Boolean)
  );

  const wantsTwitter = persona.platform === "twitter" || persona.platform === "both";
  const wantsReddit = persona.platform === "reddit" || persona.platform === "both";
  const perPlatform = persona.platform === "both" ? Math.ceil(config.batch.maxFeedItems / 2) : config.batch.maxFeedItems;

  const items: FeedDigestItem[] = [];

  if (wantsTwitter) {
    const candidates = posts.filter(
      (p) =>
        p.platform === "twitter" &&
        p.personaId !== persona.id &&
        (persona.follows.includes(p.personaId) || viral.has(p.id))
    );
    const ranked = candidates
      .map((p) => ({ p, s: twitterScore(p, persona, targetRound, viral, entities) }))
      .sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id, undefined, { numeric: true }));
    for (const { p } of ranked.slice(0, perPlatform)) {
      items.push(toDigestItem(p, handles, targetRound));
    }
  }

  if (wantsReddit) {
    const candidates = posts.filter(
      (p) => p.platform === "reddit" && p.kind === "post" && persona.communityIds.includes(p.communityId ?? "") && p.personaId !== persona.id
    );
    const ranked = candidates
      .map((p) => ({ p, s: redditScore(p, targetRound, config.platforms.reddit.gravity) }))
      .sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id, undefined, { numeric: true }));
    for (const { p } of ranked.slice(0, perPlatform)) {
      items.push(toDigestItem(p, handles, targetRound));
      // thread preview: top comments of the hottest threads
      const kids = storage
        .childrenOf(world.id, p.id)
        .sort((a, b) => b.metrics.upvotes - b.metrics.downvotes - (a.metrics.upvotes - a.metrics.downvotes) || a.id.localeCompare(b.id));
      for (const k of kids.slice(0, 2)) items.push(toDigestItem(k, handles, targetRound));
    }
  }

  return items.slice(0, config.batch.maxFeedItems + 4);
}

function toDigestItem(p: Post, handles: Map<string, string>, targetRound: number): FeedDigestItem {
  const engagement =
    p.platform === "twitter"
      ? `♥${p.metrics.likes} ⇄${p.metrics.reposts}`
      : `▲${p.metrics.upvotes} ▼${p.metrics.downvotes}`;
  return {
    id: p.id,
    by: handles.get(p.personaId) ?? p.personaId,
    plat: p.platform === "twitter" ? "tw" : "rd",
    kind: p.kind,
    age: targetRound - p.round,
    title: p.title ?? undefined,
    body: truncate(p.title ? `${p.title} — ${p.body}` : p.body, 220),
    engagement,
  };
}

/** Trending entities over the last two completed rounds (for digests + reports). */
export function trendingEntities(storage: Storage, world: World, targetRound: number, entities: Entity[], k = 4): string[] {
  const posts = storage.listPosts(world.id, { minRound: targetRound - 2, maxRound: targetRound - 1, limit: 800 });
  const counts = new Map<string, number>();
  for (const p of posts) {
    const w = 1 + engagementNorm(p);
    for (const m of p.mentions) counts.set(m.entityId, (counts.get(m.entityId) ?? 0) + w);
  }
  const byId = new Map(entities.map((e) => [e.id, e]));
  return [...counts.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([id]) => byId.get(id)!.name);
}
