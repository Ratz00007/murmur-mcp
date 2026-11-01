/**
 * Round phase 2 — Digest composition. Platform mechanics, reimplemented
 * deterministically: Twitter-style ranking with retweet amplification and a
 * Reddit-style thread tree with vote gravity.
 */
import type {
  Entity,
  FeedDigestItem,
  MurmurConfig,
  Persona,
  Post,
  World,
} from "../types.js";
import type { Storage } from "../store/storage.js";
import { engagementScore } from "../util/engagement.js";
import { truncate } from "../util/text.js";
import { scoreSentiment } from "../sentiment.js";

export function engagementNorm(p: Post): number {
  // Canonical score can go negative when downvotes dominate; clamp so the
  // normalized heat stays within [0, 1).
  const e = Math.max(0, engagementScore(p.metrics));
  return e / (1 + e);
}

export function twitterScore(
  post: Post,
  viewer: Persona,
  targetRound: number,
  viral: Set<string>,
  entities: Entity[],
): number {
  const age = targetRound - post.round;
  const recency = Math.exp(-age / 3);
  const follows = viewer.follows.includes(post.personaId)
    ? 0.25
    : viral.has(post.id)
      ? 0.15
      : 0.02;
  const salience = stanceSalience(post, viewer, entities);
  return recency + 0.55 * engagementNorm(post) + follows + 0.2 * salience;
}

export function redditScore(
  post: Post,
  targetRound: number,
  gravity: number,
): number {
  const age = targetRound - post.round;
  const score = post.metrics.upvotes - post.metrics.downvotes + 1;
  return score / (age + 2) ** gravity;
}

function stanceSalience(
  post: Post,
  viewer: Persona,
  entities: Entity[],
): number {
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

// ==========================================
// Algorithmic Feed Dynamics & Controversy Amplification (M4, Features 9 & 10)
// ==========================================

export interface TheRatioResult {
  ratioScore: number;
  isRatioed: boolean;
  controversyMultiplier: number;
}

export interface FeedPostKOLCandidate {
  id: string;
  text?: string;
  outrage: number;
  replies: number;
  quotes: number;
  likes: number;
  authorFollowers: number;
  authorPageRank: number;
  recencyRound: number;
}

export interface RankedFeedPostKOLResult {
  id: string;
  finalScore: number;
  isViral: boolean;
}

/**
 * Computes quadratic outrage amplification M_outrage(o) = 1.0 + 3.0 * o^2.
 * Clamps outrage in [0.0, 1.0].
 * (0.0 -> 1.0, 0.5 -> 1.75, 1.0 -> 4.0)
 */
export function computeOutrageMultiplier(outrageScore: number): number {
  if (Number.isNaN(outrageScore)) return 1.0;
  const o = Math.max(0.0, Math.min(1.0, outrageScore));
  return 1.0 + 3.0 * (o * o);
}

/**
 * Computes "The Ratio" metric: (replies + quotes * 1.5) / safeLikes.
 * When ratioScore >= 2.0 and there is engagement, isRatioed = true.
 * Controversy multiplier scales logarithmically and is capped at 5.0.
 * Handles 0 likes without division-by-zero, clamps negative inputs to 0.
 */
export function computeTheRatio(
  replies: number,
  quotes: number,
  likes: number,
): TheRatioResult {
  const safeReplies = Math.max(0, Number.isFinite(replies) ? replies : 0);
  const safeQuotes = Math.max(0, Number.isFinite(quotes) ? quotes : 0);
  const safeLikes = Math.max(1, Number.isFinite(likes) ? likes : 0);

  const rawRatio = (safeReplies + safeQuotes * 1.5) / safeLikes;
  const ratioScore = Math.round(rawRatio * 100) / 100;
  const isRatioed = ratioScore >= 2.0 && (safeReplies + safeQuotes) > 0;
  const rawControversy = Math.min(5.0, 1.0 + Math.log10(Math.max(1.0, ratioScore)));
  const controversyMultiplier = Math.round(rawControversy * 100) / 100;

  return {
    ratioScore,
    isRatioed,
    controversyMultiplier,
  };
}

/**
 * Calculates power-law KOL influencer weight bounded in [1.0, 100.0].
 * followerWeight = log10(max(1, inDegreeFollowers)) * 10;
 * authorityWeight = clamp(pageRankAuthority, 0, 1) * 50;
 */
export function calculateKOLWeight(
  inDegreeFollowers: number,
  pageRankAuthority: number,
): number {
  const safeFollowers = Math.max(0, Number.isFinite(inDegreeFollowers) ? inDegreeFollowers : 0);
  const safeAuthority = Math.max(0, Math.min(1, Number.isFinite(pageRankAuthority) ? pageRankAuthority : 0));

  const followerWeight = Math.log10(Math.max(1, safeFollowers)) * 10;
  const authorityWeight = safeAuthority * 50;
  const raw = followerWeight + authorityWeight;
  return Math.min(100.0, Math.max(1.0, raw));
}

// Two collators, deliberately: `numeric` for the id lists that already sorted
// numerically (feed ranking, per-platform ranking), and plain `en` for the ones
// that did not (thread previews, mention tallies). Adding numeric where it was
// absent reorders `p_10` before `p_2` and changes the golden replay hash, so the
// distinction is load-bearing rather than cosmetic. Both pin `en` explicitly:
// the default locale varies by OS, and the replay contract must not.
const defaultCollator = new Intl.Collator("en", { numeric: true });
const plainCollator = new Intl.Collator("en");

/**
 * Ranks feed posts combining recency, base engagement, controversy multiplier,
 * KOL reach, and quadratic outrage amplification.
 * Guarantees deterministic tie-breaking. Marks isViral when finalScore > 50.0 || ratio.isRatioed.
 */
export function rankFeedPostsWithKOL(
  posts: FeedPostKOLCandidate[],
  currentRound: number,
): RankedFeedPostKOLResult[] {
  return posts
    .map((p) => {
      const kolWeight = calculateKOLWeight(p.authorFollowers, p.authorPageRank);
      const outrageMult = computeOutrageMultiplier(p.outrage);
      const ratio = computeTheRatio(p.replies, p.quotes, p.likes);
      const safeRoundDelta = Math.max(
        0,
        Number.isFinite(currentRound) && Number.isFinite(p.recencyRound)
          ? currentRound - p.recencyRound
          : 0,
      );
      const recency = Math.exp(-safeRoundDelta / 3);

      const safeLikes = Number.isFinite(p.likes) && p.likes > 0 ? p.likes : 0;
      const safeReplies = Number.isFinite(p.replies) && p.replies > 0 ? p.replies : 0;
      const safeQuotes = Number.isFinite(p.quotes) && p.quotes > 0 ? p.quotes : 0;
      const baseEngagement = safeLikes + safeReplies * 2 + safeQuotes * 3;
      const rawFinalScore =
        (recency + (baseEngagement / 100) * ratio.controversyMultiplier) *
        (kolWeight / 10) *
        outrageMult;
      const finalScore = Number.isFinite(rawFinalScore) ? rawFinalScore : 0;

      const roundedScore = Math.round(finalScore * 100) / 100;
      return {
        id: p.id,
        finalScore: roundedScore,
        isViral: roundedScore > 50.0 || ratio.isRatioed,
      };
    })
    .sort(
      (a, b) =>
        b.finalScore - a.finalScore ||
        defaultCollator.compare(a.id, b.id),
    );
}

/** Build the personalized, budget-truncated feed slice for one persona. */
export function buildFeed(
  storage: Storage,
  world: World,
  persona: Persona,
  targetRound: number,
  config: MurmurConfig,
  entities: Entity[],
  handles: Map<string, string>,
): FeedDigestItem[] {
  const posts = storage.listPosts(world.id, {
    minRound: targetRound - 4,
    maxRound: targetRound - 1,
    limit: 800,
  });
  const viral = new Set(
    storage
      .listEvents(world.id, { type: "viral", sinceRound: targetRound - 3 })
      .map((e) => String(e.payload.postId ?? ""))
      .filter(Boolean),
  );

  const wantsTwitter =
    persona.platform === "twitter" || persona.platform === "both";
  const wantsReddit =
    persona.platform === "reddit" || persona.platform === "both";
  const perPlatform =
    persona.platform === "both"
      ? Math.ceil(config.batch.maxFeedItems / 2)
      : config.batch.maxFeedItems;

  const items: FeedDigestItem[] = [];

  if (wantsTwitter) {
    const candidates = posts.filter(
      (p) =>
        p.platform === "twitter" &&
        p.personaId !== persona.id &&
        (persona.follows.includes(p.personaId) || viral.has(p.id)),
    );
    // Batch-load children ONCE for all twitter candidates (one query instead
    // of one per candidate) and group by parent id; per-candidate lookup is
    // then a Map get. Order within each group matches childrenOf (id-ordered),
    // so ranking output is byte-identical.
    const childrenByParent = storage.childrenOfMany(
      world.id,
      candidates.map((p) => p.id),
    );
    const ranked = candidates
      .map((p) => {
        const base = twitterScore(p, persona, targetRound, viral, entities);
        const children = childrenByParent.get(p.id) ?? [];
        const replies = children.filter(
          (c) => c.kind === "reply" || c.kind === "comment",
        ).length;
        const quotes = children.filter(
          (c) => c.kind === "quote" || c.kind === "repost",
        ).length;
        const ratio = computeTheRatio(replies, quotes, p.metrics.likes);
        const sent = scoreSentiment(p.body);
        const outrage = Math.max(0, -sent.score);
        const outrageMult = computeOutrageMultiplier(outrage);
        const s = base * outrageMult * ratio.controversyMultiplier;
        return { p, s };
      })
      .sort(
        (a, b) =>
          b.s - a.s || defaultCollator.compare(a.p.id, b.p.id),
      );
    for (const { p } of ranked.slice(0, perPlatform)) {
      items.push(toDigestItem(p, handles, targetRound));
    }
  }

  if (wantsReddit) {
    const candidates = posts.filter(
      (p) =>
        p.platform === "reddit" &&
        p.kind === "post" &&
        persona.communityIds.includes(p.communityId ?? "") &&
        p.personaId !== persona.id,
    );
    const childrenByParent = storage.childrenOfMany(
      world.id,
      candidates.map((p) => p.id),
    );
    const ranked = candidates
      .map((p) => {
        const base = redditScore(
          p,
          targetRound,
          config.platforms.reddit.gravity,
        );
        const children = childrenByParent.get(p.id) ?? [];
        const replies = children.length;
        const ratio = computeTheRatio(
          replies,
          p.metrics.downvotes,
          p.metrics.upvotes,
        );
        const fullText = p.title ? `${p.title} — ${p.body}` : p.body;
        const sent = scoreSentiment(fullText);
        const outrage = Math.max(0, -sent.score);
        const outrageMult = computeOutrageMultiplier(outrage);
        const s = base * outrageMult * ratio.controversyMultiplier;
        return { p, s };
      })
      .sort(
        (a, b) =>
          b.s - a.s || defaultCollator.compare(a.p.id, b.p.id),
      );
    for (const { p } of ranked.slice(0, perPlatform)) {
      items.push(toDigestItem(p, handles, targetRound));
      // thread preview: top comments of the hottest threads
      const kids = (childrenByParent.get(p.id) ?? [])
        .sort(
          (a, b) =>
            b.metrics.upvotes -
              b.metrics.downvotes -
              (a.metrics.upvotes - a.metrics.downvotes) ||
            plainCollator.compare(a.id, b.id),
        );
      for (const k of kids.slice(0, 2))
        items.push(toDigestItem(k, handles, targetRound));
    }
  }

  return items.slice(0, config.batch.maxFeedItems + 4);
}

function toDigestItem(
  p: Post,
  handles: Map<string, string>,
  targetRound: number,
): FeedDigestItem {
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
export function trendingEntities(
  storage: Storage,
  world: World,
  targetRound: number,
  entities: Entity[],
  k = 4,
): string[] {
  const posts = storage.listPosts(world.id, {
    minRound: targetRound - 2,
    maxRound: targetRound - 1,
    limit: 800,
  });
  const counts = new Map<string, number>();
  for (const p of posts) {
    const w = 1 + engagementNorm(p);
    for (const m of p.mentions)
      counts.set(m.entityId, (counts.get(m.entityId) ?? 0) + w);
  }
  const byId = new Map(entities.map((e) => [e.id, e]));
  return [...counts.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1] || plainCollator.compare(a[0], b[0]))
    .slice(0, k)
    .map(([id]) => byId.get(id)?.name ?? id);
}
