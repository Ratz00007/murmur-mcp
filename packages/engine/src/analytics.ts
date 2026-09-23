/**
 * Deep analytics for the prediction report: faction structure, platform
 * divergence, controversy scoring, persona arcs, quote banks, narrative
 * timeline, momentum, linear extrapolation and amplification. Every function
 * is a pure, deterministic read over stored world state — no LLM, no clock,
 * no randomness. The report narrative is written around these numbers.
 */
import type { Entity, EscalationChain, Persona, Post, World } from "./types.js";
import type { Storage } from "./store/storage.js";
import { engagementPeaks, postSentiment, timeline, type TimelineRow } from "./aggregate.js";
import { scoreSentiment } from "./sentiment.js";
import { engagementScore } from "./util/engagement.js";
import { clamp, round2Safe, truncate } from "./util/text.js";

export interface ReportQuote {
  id: string;
  by: string;
  name: string;
  plat: "tw" | "rd";
  round: number;
  body: string;
  sentiment: number;
  /** Sentence-level sentiment toward the report's focus entity (set when the
 * post actually names the focus; whole-post sentiment otherwise). */
  attrSentiment?: number;
  engagement: number;
  kind: string;
}

export interface FactionLeader {
  handle: string;
  archetype: string;
  stance: number;
  posts: number;
  engagement: number;
}

export interface FactionInfo {
  key: "supporters" | "opponents" | "undecided";
  label: string;
  size: number;
  share: number;
  avgStance: number;
  posts: number;
  engagement: number;
  leaders: FactionLeader[];
  quotes: ReportQuote[];
  sentimentByRound: { round: number; value: number }[];
}

export interface FactionAnalysis {
  focusEntity: string;
  factions: FactionInfo[];
  polarization: number;
  verdict: string;
}

function engagementOf(p: Post): number {
  return engagementScore(p.metrics);
}

/** Escape a literal string for embedding inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sentence-local sentiment attributed to a specific entity. The unit is the
 * sentence that names the entity plus up to two following sentences (where
 * pronouns and punchlines live), scored as one text blob — but sentences that
 * name a DIFFERENT entity are excluded, so praise for a competitor never
 * leaks into the focus entity's score. Falls back to the post-level score
 * when no sentence names the entity.
 */
export function attributedSentiment(post: Post, entity: Entity, otherNames: string[] = []): number {
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(entity.name)}($|[^A-Za-z0-9])`, "i");
  const others = otherNames
    .filter((n) => n !== entity.name)
    .map((n) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(n)}($|[^A-Za-z0-9])`, "i"));
  const sentences = post.body.split(/(?<=[.!?)\u2026])\s+/);
  const anchors = new Set<number>();
  sentences.forEach((s, i) => {
    if (re.test(s)) anchors.add(i);
  });
  if (anchors.size === 0) return postSentiment(post);
  const include = new Set<number>(anchors);
  for (const i of anchors) {
    for (const d of [1, 2]) {
      const j = i + d;
      if (j < sentences.length && !anchors.has(j) && !others.some((ore) => ore.test(sentences[j]))) include.add(j);
    }
  }
  const text = [...include]
    .sort((a, b) => a - b)
    .map((i) => sentences[i])
    .join(" ");
  return round2Safe(scoreSentiment(text).score);
}

function quoteOf(p: Post, handles: Map<string, string>, names: Map<string, string>, attr?: number): ReportQuote {
  return {
    id: p.id,
    by: handles.get(p.personaId) ?? p.personaId,
    name: names.get(p.personaId) ?? "",
    plat: p.platform === "twitter" ? "tw" : "rd",
    round: p.round,
    body: truncate(p.body, 220),
    sentiment: round2Safe(postSentiment(p)),
    ...(attr !== undefined ? { attrSentiment: attr } : {}),
    engagement: engagementOf(p),
    kind: p.kind,
  };
}

/** Names of every entity except the focus — used to keep text about OTHER
 * entities out of the focus entity's attribution window. */
function otherEntityNames(storage: Storage, world: World, focus: Entity | null): string[] {
  if (!focus) return [];
  return storage
    .listEntities(world.id)
    .filter((e) => e.id !== focus.id)
    .map((e) => e.name);
}

/** Cluster personas by stance toward the focus entity: supporters / opponents / undecided. */
export function factionAnalysis(storage: Storage, world: World, focus: Entity | null, exclude?: Set<string>): FactionAnalysis {
  const personas = storage.listPersonas(world.id);
  const posts = storage.listPosts(world.id, { limit: 100000 }).filter((p) => p.kind !== "repost");
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const names = new Map(personas.map((p) => [p.id, p.name]));
  const focusName = focus?.name ?? "the scenario";
  const bucket = (p: Persona): FactionInfo["key"] => {
    const s = focus ? (p.stances[focus.id] ?? 0) : 0;
    return s > 0.2 ? "supporters" : s < -0.2 ? "opponents" : "undecided";
  };
  const groups: Record<FactionInfo["key"], Persona[]> = { supporters: [], opponents: [], undecided: [] };
  for (const p of personas) groups[bucket(p)].push(p);

  const factions: FactionInfo[] = (["supporters", "opponents", "undecided"] as const).map((key) => {
    const members = groups[key];
    const label = key === "supporters" ? `Supporters of ${focusName}` : key === "opponents" ? `Opponents of ${focusName}` : "Undecided / watching";
    const memberIds = new Set(members.map((m) => m.id));
    const own = posts.filter((p) => memberIds.has(p.personaId));
    const stances = members.map((m) => (focus ? (m.stances[focus.id] ?? 0) : 0));
    const leaders = members
      .map((m) => {
        const mp = own.filter((p) => p.personaId === m.id);
        return {
          handle: m.handle,
          archetype: m.archetype,
          stance: round2Safe(focus ? (m.stances[focus.id] ?? 0) : 0),
          posts: mp.length,
          engagement: mp.reduce((a, p) => a + engagementOf(p), 0),
        };
      })
      .sort((a, b) => b.engagement - a.engagement || a.handle.localeCompare(b.handle))
      .slice(0, 3);
    // Faction showcase quotes: prefer posts that actually NAME the focus
    // entity and whose attributed sentiment matches the camp (supporters quote
    // praise, opponents quote grievance). Repetition with other sections is
    // tolerated before admitting posts that never mention the focus at all.
    const sign = key === "supporters" ? 1 : key === "opponents" ? -1 : 0;
    const others = otherEntityNames(storage, world, focus);
    const attr = (p: Post) => (focus ? attributedSentiment(p, focus, others) : postSentiment(p));
    const mentionsFocus = (p: Post) => !focus || p.mentions.some((m) => m.entityId === focus.id);
    const signMatch = (p: Post) => (sign === 0 ? Math.abs(attr(p)) <= 0.25 : sign * attr(p) > 0.15);
    const byEngagement = own
      .slice()
      .sort((a, b) => engagementOf(b) - engagementOf(a) || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const usedAuthors = new Set<string>();
    const chosen: Post[] = [];
    const claim = (pool: Post[], needMention: boolean, needSign: boolean) => {
      for (const p of pool) {
        if (chosen.length >= 2) break;
        if (needMention && !mentionsFocus(p)) continue;
        if (needSign && !signMatch(p)) continue;
        if (usedAuthors.has(p.personaId) || chosen.includes(p)) continue;
        usedAuthors.add(p.personaId);
        chosen.push(p);
      }
    };
    const fresh = byEngagement.filter((p) => !exclude?.has(p.id));
    claim(fresh, true, true);
    claim(fresh, true, false);
    claim(byEngagement, true, true);
    claim(byEngagement, true, false);
    claim(fresh, false, true);
    claim(byEngagement, false, false); // last resort: better an off-topic quote than none
    const quotes = chosen.map((p) => quoteOf(p, handles, names, mentionsFocus(p) ? attr(p) : undefined));
    const sentimentByRound: { round: number; value: number }[] = [];
    if (focus) {
      for (let r = 1; r <= world.round; r++) {
        const scores = own.filter((p) => p.round === r && mentionsFocus(p)).map((p) => attr(p));
        if (scores.length > 0) sentimentByRound.push({ round: r, value: round2Safe(scores.reduce((a, b) => a + b, 0) / scores.length) });
      }
    }
    return {
      key,
      label,
      size: members.length,
      share: personas.length === 0 ? 0 : round2Safe(members.length / personas.length),
      avgStance: stances.length === 0 ? 0 : round2Safe(stances.reduce((a, b) => a + b, 0) / stances.length),
      posts: own.length,
      engagement: own.reduce((a, p) => a + engagementOf(p), 0),
      leaders,
      quotes,
      sentimentByRound,
    };
  });

  const sup = groups.supporters.length;
  const opp = groups.opponents.length;
  const und = groups.undecided.length;
  const total = Math.max(1, personas.length);
  const committed = sup + opp;
  const balance = committed > 0 ? 1 - Math.abs(sup - opp) / committed : 0;
  const polarization = round2Safe((committed / total) * (0.5 + 0.5 * balance));
  const mood = polarization >= 0.6 ? "deeply polarized" : polarization >= 0.35 ? "splitting into camps" : committed > 0 ? "leaning one way" : "still coalescing";
  const verdict =
    focus
      ? `${sup} supporter${sup === 1 ? "" : "s"} vs ${opp} opponent${opp === 1 ? "" : "s"} around ${focusName} (${und} still undecided) — the population is ${mood}.`
      : `${sup} supporter${sup === 1 ? "" : "s"} vs ${opp} opponent${opp === 1 ? "" : "s"} (${und} undecided) — the population is ${mood}.`;
  return { focusEntity: focusName, factions, polarization, verdict };
}

// ---------------------------------------------------------------------------
// Platform divergence
// ---------------------------------------------------------------------------

export interface CrossPlatformRow {
  entity: string;
  twitter: number | null;
  reddit: number | null;
  divergence: number;
  twPosts: number;
  rdPosts: number;
}

export interface CrossPlatformAnalysis {
  totals: { twitterPosts: number; redditPosts: number; twitterEngagement: number; redditEngagement: number; twitterEscalations: number; redditEscalations: number };
  rows: CrossPlatformRow[];
  maxDivergence: { entity: string; value: number } | null;
}

export function crossPlatform(storage: Storage, world: World, entities: Entity[]): CrossPlatformAnalysis {
  const posts = storage.listPosts(world.id, { limit: 100000 });
  const byPlat = { twitter: posts.filter((p) => p.platform === "twitter"), reddit: posts.filter((p) => p.platform === "reddit") };
  const chains = allEscalations(storage, world);
  const rootPlatform = (chain: EscalationChain): "twitter" | "reddit" => {
    const root = posts.find((p) => p.id === chain.path[0]);
    return root?.platform ?? "twitter";
  };
  const totals = {
    twitterPosts: byPlat.twitter.length,
    redditPosts: byPlat.reddit.length,
    twitterEngagement: byPlat.twitter.reduce((a, p) => a + engagementOf(p), 0),
    redditEngagement: byPlat.reddit.reduce((a, p) => a + engagementOf(p), 0),
    twitterEscalations: chains.filter((c) => rootPlatform(c) === "twitter").length,
    redditEscalations: chains.filter((c) => rootPlatform(c) === "reddit").length,
  };
  const rows: CrossPlatformRow[] = entities
    .map((e) => {
      const tw = byPlat.twitter.filter((p) => p.mentions.some((m) => m.entityId === e.id)).map((p) => postSentiment(p));
      const rd = byPlat.reddit.filter((p) => p.mentions.some((m) => m.entityId === e.id)).map((p) => postSentiment(p));
      const twm = tw.length ? round2Safe(tw.reduce((a, b) => a + b, 0) / tw.length) : null;
      const rdm = rd.length ? round2Safe(rd.reduce((a, b) => a + b, 0) / rd.length) : null;
      return {
        entity: e.name,
        twitter: twm,
        reddit: rdm,
        divergence: twm !== null && rdm !== null ? round2Safe(Math.abs(twm - rdm)) : 0,
        twPosts: tw.length,
        rdPosts: rd.length,
      };
    })
    // only entities the crowd actually discussed, biggest platform split first
    .filter((r) => r.twPosts + r.rdPosts > 0)
    .sort((a, b) => b.divergence - a.divergence || a.entity.localeCompare(b.entity))
    .slice(0, 5);
  const withBoth = rows.filter((r) => r.twitter !== null && r.reddit !== null);
  const maxDivergence = withBoth.length
    ? withBoth.reduce((a, b) => (b.divergence > a.value ? { entity: b.entity, value: b.divergence } : a), { entity: withBoth[0].entity, value: withBoth[0].divergence })
    : null;
  return { totals, rows, maxDivergence };
}

// ---------------------------------------------------------------------------
// Controversy index
// ---------------------------------------------------------------------------

export interface ControversyAnalysis {
  score: number;
  label: string;
  drivers: { label: string; value: number; weight: number }[];
}

export function controversyIndex(storage: Storage, world: World, factions: FactionAnalysis): ControversyAnalysis {
  const posts = storage.listPosts(world.id, { limit: 100000 }).filter((p) => p.kind !== "repost");
  const totalEng = posts.reduce((a, p) => a + engagementOf(p), 0);
  const negEng = posts.filter((p) => postSentiment(p) <= -0.2).reduce((a, p) => a + engagementOf(p), 0);
  const negShare = totalEng > 0 ? negEng / totalEng : 0;
  const escalations = allEscalations(storage, world).length;
  const escPerRound = world.round > 0 ? escalations / world.round : 0;
  const drivers = [
    { label: `polarization ${(factions.polarization * 100).toFixed(0)}/100`, value: factions.polarization, weight: 40 },
    { label: `share of engagement on negative posts ${(negShare * 100).toFixed(0)}%`, value: negShare, weight: 30 },
    { label: `escalation density ${escalations} chains over ${world.round} rounds`, value: clamp(escPerRound / 2, 0, 1), weight: 30 },
  ];
  const score = Math.round(drivers.reduce((a, d) => a + d.value * d.weight, 0));
  const label = score >= 70 ? "combustible" : score >= 55 ? "polarized" : score >= 35 ? "contested" : score >= 20 ? "simmering" : "low-stakes";
  return { score, label, drivers };
}

// ---------------------------------------------------------------------------
// Persona arcs
// ---------------------------------------------------------------------------

export interface PersonaArc {
  personaId: string;
  handle: string;
  name: string;
  archetype: string;
  bio: string;
  platform: string;
  posts: number;
  engagement: number;
  focusStart: number;
  focusEnd: number;
  delta: number;
  arcLabel: string;
  signatureQuote: ReportQuote | null;
}

/** Reconstruct each persona's starting stance toward the focus entity from mover history. */
export function startStances(storage: Storage, world: World, entityName: string): Map<string, number> {
  const starts = new Map<string, number>();
  const events = storage
    .listEvents(world.id, { type: "round_stats" })
    .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  for (const ev of events) {
    const movers = ((ev.payload.stats as { topMovers?: { personaId: string; entity: string; from: number; to: number }[] })?.topMovers ?? []);
    for (const m of movers) {
      if (m.entity === entityName && !starts.has(m.personaId)) starts.set(m.personaId, m.from);
    }
  }
  return starts;
}

export function personaArcs(storage: Storage, world: World, focus: Entity | null, limit = 3, exclude?: Set<string>): PersonaArc[] {
  const personas = storage.listPersonas(world.id);
  const posts = storage.listPosts(world.id, { limit: 100000 }).filter((p) => p.kind !== "repost");
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const names = new Map(personas.map((p) => [p.id, p.name]));
  const focusName = focus?.name ?? "";
  const others = otherEntityNames(storage, world, focus);
  const starts = focus ? startStances(storage, world, focusName) : new Map<string, number>();
  const arcs: PersonaArc[] = personas.map((p) => {
    const own = posts.filter((x) => x.personaId === p.id);
    const end = focus ? (p.stances[focus.id] ?? 0) : 0;
    const start = starts.get(p.id) ?? end;
    const delta = round2Safe(end - start);
    const aboutFocus = focus ? own.filter((x) => x.mentions.some((m) => m.entityId === focus.id)) : [];
    const pool = aboutFocus.length > 0 ? aboutFocus : own;
    // signature quote: the persona's best post about the focus that is not
    // already quoted elsewhere; fall back to their best post overall
    const best =
      pool
        .slice()
        .filter((x) => !exclude?.has(x.id))
        .sort((a, b) => engagementOf(b) - engagementOf(a) || a.id.localeCompare(b.id, undefined, { numeric: true }))[0] ??
      pool
        .slice()
        .sort((a, b) => engagementOf(b) - engagementOf(a) || a.id.localeCompare(b.id, undefined, { numeric: true }))[0];
    const arcLabel = focus
      ? delta <= -0.12
        ? `soured on ${focusName}`
        : delta >= 0.12
          ? `warmed to ${focusName}`
          : end > 0.4
            ? `steadfast champion of ${focusName}`
            : end < -0.4
              ? `steadfast critic of ${focusName}`
              : `still weighing ${focusName}`
      : "observer";
    return {
      personaId: p.id,
      handle: p.handle,
      name: p.name,
      archetype: p.archetype,
      bio: truncate(p.bio, 160),
      platform: p.platform,
      posts: own.length,
      engagement: own.reduce((a, x) => a + engagementOf(x), 0),
      focusStart: round2Safe(start),
      focusEnd: round2Safe(end),
      delta,
      arcLabel,
      signatureQuote: best ? quoteOf(best, handles, names, focus && best.mentions.some((m) => m.entityId === focus.id) ? attributedSentiment(best, focus, others) : undefined) : null,
    };
  });
  return arcs
    .slice()
    .sort((a, b) => b.engagement - a.engagement || a.personaId.localeCompare(b.personaId))
    .slice(0, Math.max(limit * 2, 6))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.engagement - a.engagement)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Quote bank
// ---------------------------------------------------------------------------

export interface QuoteBank {
  positive: ReportQuote[];
  negative: ReportQuote[];
  mixed: ReportQuote[];
}

/**
 * Quote bank for the report's "what the crowd said" section. Quotes are
 * classified and selected by their sentence-level sentiment TOWARD the focus
 * entity, and every selected post must actually name the focus — a post
 * praising a competitor never shows up as a champion of the focus. Better a
 * short list than a misattributed one. Posts already quoted elsewhere are
 * reused only when the bucket would otherwise be too thin to show.
 */
export function quoteBank(storage: Storage, world: World, focus: Entity | null, perBucket = 3, exclude?: Set<string>): QuoteBank {
  const personas = storage.listPersonas(world.id);
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const names = new Map(personas.map((p) => [p.id, p.name]));
  const others = otherEntityNames(storage, world, focus);
  const posts = storage
    .listPosts(world.id, { limit: 100000 })
    .filter((p) => p.kind !== "repost" && p.body.length > 0)
    .filter((p) => !focus || p.mentions.some((x) => x.entityId === focus.id))
    .map((p) => ({
      p,
      a: focus ? attributedSentiment(p, focus, others) : postSentiment(p),
      e: engagementOf(p),
    }));
  const take = (filter: (a: number) => boolean) => {
    const inBucket = posts
      .filter((x) => filter(x.a))
      .sort((a, b) => b.e - a.e || a.p.id.localeCompare(b.p.id, undefined, { numeric: true }));
    const used = new Set<string>();
    const chosen: typeof posts = [];
    for (const x of inBucket) {
      if (chosen.length >= perBucket) break;
      if (exclude?.has(x.p.id)) continue;
      if (used.has(x.p.personaId)) continue;
      used.add(x.p.personaId);
      chosen.push(x);
    }
    for (const x of inBucket) {
      // top-up: tolerate repetition with other sections, never misattribution
      if (chosen.length >= perBucket) break;
      if (chosen.includes(x) || used.has(x.p.personaId)) continue;
      used.add(x.p.personaId);
      chosen.push(x);
    }
    return chosen.map((x) => quoteOf(x.p, handles, names, x.a));
  };
  return {
    positive: take((a) => a >= 0.3),
    negative: take((a) => a <= -0.3),
    mixed: take((a) => Math.abs(a) < 0.3),
  };
}

// ---------------------------------------------------------------------------
// Narrative timeline — the moments a launch team would replay
// ---------------------------------------------------------------------------

export interface TimelineMoment {
  round: number;
  kind: string;
  text: string;
  postIds: string[];
}

export function narrativeTimeline(storage: Storage, world: World, limit = 8): TimelineMoment[] {
  const personas = storage.listPersonas(world.id);
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const posts = storage
    .listPosts(world.id, { limit: 100000 })
    .filter((p) => p.kind !== "repost")
    .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const moments: TimelineMoment[] = [];

  for (const ev of storage.listEvents(world.id, { type: "injection" }).sort((a, b) => a.round - b.round)) {
    moments.push({ round: ev.round, kind: "news", text: `News injected into the world: ${truncate(String(ev.payload.text ?? ""), 160)}`, postIds: [] });
  }
  for (const ev of storage.listEvents(world.id, { type: "viral" }).sort((a, b) => a.round - b.round || a.id.localeCompare(b.id))) {
    const pid = String(ev.payload.postId ?? "");
    const post = posts.find((p) => p.id === pid);
    if (post) moments.push({ round: ev.round, kind: "viral", text: `${handles.get(post.personaId) ?? post.personaId}'s post went viral (engagement ${ev.payload.engagement})`, postIds: [pid] });
  }
  const firstNeg = posts.find((p) => postSentiment(p) <= -0.5);
  if (firstNeg) moments.push({ round: firstNeg.round, kind: "flashpoint", text: `First strong criticism: ${handles.get(firstNeg.personaId) ?? firstNeg.personaId} — "${truncate(firstNeg.body, 120)}"`, postIds: [firstNeg.id] });
  const firstPos = posts.find((p) => postSentiment(p) >= 0.5);
  if (firstPos) moments.push({ round: firstPos.round, kind: "rally", text: `First strong endorsement: ${handles.get(firstPos.personaId) ?? firstPos.personaId} — "${truncate(firstPos.body, 120)}"`, postIds: [firstPos.id] });
  for (const r of engagementPeaks(timeline(storage, world))) {
    moments.push({ round: r, kind: "peak", text: `Engagement peak — round ${r} exceeded the mean by more than 2σ`, postIds: [] });
  }
  const seenMoves = new Set<string>();
  for (const ev of storage.listEvents(world.id, { type: "round_stats" }).sort((a, b) => a.round - b.round)) {
    const movers = ((ev.payload.stats as { topMovers?: { personaId: string; entity: string; from: number; to: number }[] })?.topMovers ?? []);
    for (const m of movers) {
      const key = `${m.personaId}|${m.entity}`;
      if (Math.abs(m.to - m.from) >= 0.15 && !seenMoves.has(key)) {
        seenMoves.add(key);
        moments.push({ round: ev.round, kind: "shift", text: `${handles.get(m.personaId) ?? m.personaId} shifted on ${m.entity}: ${m.from.toFixed(2)} → ${m.to.toFixed(2)}`, postIds: [] });
      }
    }
  }
  const order: Record<string, number> = { news: 0, flashpoint: 1, rally: 2, viral: 3, peak: 4, shift: 5 };
  return moments
    .sort((a, b) => a.round - b.round || (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.text.localeCompare(b.text))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Momentum + extrapolation
// ---------------------------------------------------------------------------

export interface MomentumAnalysis {
  firstHalf: number;
  secondHalf: number;
  pct: number;
  trend: "accelerating" | "steady" | "cooling" | "quiet";
}

export function momentum(rows: TimelineRow[]): MomentumAnalysis {
  const series = rows.map((r) => r.engagement);
  const total = series.reduce((a, b) => a + b, 0);
  if (total === 0 || series.length === 0) return { firstHalf: 0, secondHalf: 0, pct: 0, trend: "quiet" };
  const mid = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const secondHalf = series.slice(mid).reduce((a, b) => a + b, 0);
  const pct = firstHalf === 0 ? (secondHalf > 0 ? 1 : 0) : round2Safe((secondHalf - firstHalf) / Math.max(1, firstHalf));
  const trend = pct > 0.25 ? "accelerating" : pct < -0.25 ? "cooling" : "steady";
  return { firstHalf, secondHalf, pct, trend };
}

export interface Projection {
  slope: number;
  points: { round: number; value: number; projected: boolean }[];
  direction: "up" | "down" | "flat";
}

/** Least-squares extrapolation of a sentiment curve, clamped to [-1, 1]. */
export function projectCurve(curve: { round: number; value: number }[], ahead = 2): Projection {
  const points = curve.map((c) => ({ round: c.round, value: c.value, projected: false }));
  if (curve.length < 2) return { slope: 0, points, direction: "flat" };
  const n = curve.length;
  const sx = curve.reduce((a, c) => a + c.round, 0);
  const sy = curve.reduce((a, c) => a + c.value, 0);
  const sxx = curve.reduce((a, c) => a + c.round * c.round, 0);
  const sxy = curve.reduce((a, c) => a + c.round * c.value, 0);
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const lastRound = curve[curve.length - 1].round;
  for (let i = 1; i <= ahead; i++) {
    const round = lastRound + i;
    points.push({ round, value: round2Safe(clamp(slope * round + intercept, -1, 1)), projected: true });
  }
  return { slope: round2Safe(slope), points, direction: slope > 0.02 ? "up" : slope < -0.02 ? "down" : "flat" };
}

// ---------------------------------------------------------------------------
// Amplification
// ---------------------------------------------------------------------------

export interface AmplificationInfo {
  viralPosts: { id: string; by: string; round: number; engagement: number; body: string; amplifiers: string[] }[];
  organicEngagementShare: number;
}

export function amplification(storage: Storage, world: World): AmplificationInfo {
  const personas = storage.listPersonas(world.id);
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const posts = storage.listPosts(world.id, { limit: 100000 });
  const threshold = world.config.engagement.viralityThreshold * Math.max(1, personas.length / 24);
  const childrenOf = new Map<string, string[]>();
  for (const p of posts) {
    if (!p.parentId) continue;
    const arr = childrenOf.get(p.parentId);
    if (arr) arr.push(handles.get(p.personaId) ?? p.personaId);
    else childrenOf.set(p.parentId, [handles.get(p.personaId) ?? p.personaId]);
  }
  const viralPosts = posts
    .filter((p) => p.platform === "twitter" && p.kind !== "repost" && engagementOf(p) >= threshold)
    .sort((a, b) => engagementOf(b) - engagementOf(a) || a.id.localeCompare(b.id, undefined, { numeric: true }))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      by: handles.get(p.personaId) ?? p.personaId,
      round: p.round,
      engagement: engagementOf(p),
      body: truncate(p.body, 160),
      amplifiers: [...new Set(childrenOf.get(p.id) ?? [])].slice(0, 5),
    }));
  const totalEng = posts.reduce((a, p) => a + engagementOf(p), 0);
  const organicEng = posts.filter((p) => p.origin === "organic").reduce((a, p) => a + engagementOf(p), 0);
  return { viralPosts, organicEngagementShare: totalEng > 0 ? round2Safe(organicEng / totalEng) : 0 };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function allEscalations(storage: Storage, world: World): EscalationChain[] {
  const seen = new Set<string>();
  const out: EscalationChain[] = [];
  for (const ev of storage.listEvents(world.id, { type: "round_stats" }).sort((a, b) => a.round - b.round)) {
    const chains = ((ev.payload.stats as { escalations?: EscalationChain[] })?.escalations ?? []);
    for (const c of chains) {
      if (seen.has(c.rootId)) continue;
      seen.add(c.rootId);
      out.push(c);
    }
  }
  return out;
}

export interface EntityTrend {
  entity: string;
  type: string;
  first: number | null;
  last: number | null;
  delta: number | null;
  volume: number;
  peakRound: number | null;
  direction: "up" | "down" | "flat" | "untracked";
}

export function entityTrends(
  storage: Storage,
  world: World,
  entities: Entity[],
  curve: (e: Entity) => { round: number; value: number }[],
  limit = 6
): EntityTrend[] {
  const posts = storage.listPosts(world.id, { limit: 100000 });
  return entities
    .map((e): EntityTrend => {
      const c = curve(e);
      const mentioning = posts.filter((p) => p.mentions.some((m) => m.entityId === e.id));
      const perRound = new Map<number, number>();
      for (const p of mentioning) perRound.set(p.round, (perRound.get(p.round) ?? 0) + 1);
      const peakRound = perRound.size > 0 ? [...perRound.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : null;
      const first = c.length > 0 ? c[0].value : null;
      const last = c.length > 0 ? c[c.length - 1].value : null;
      const delta = first !== null && last !== null ? round2Safe(last - first) : null;
      const direction = delta === null ? "untracked" : delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
      return { entity: e.name, type: e.type, first, last, delta, volume: mentioning.length, peakRound, direction };
    })
    // entities the crowd never mentioned carry no trend — keep them out of the table
    .filter((t) => t.volume > 0)
    .slice(0, limit);
}
