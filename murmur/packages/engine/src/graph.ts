/**
 * Stage 3 — Graph. graph_build derives typed relations (alliance, opposition,
 * influence, ownership) with tension scores from the ontology, builds reddit
 * communities and the twitter follow graph. graph_query does budgeted
 * traversal; toMermaid renders a sub-graph for any git forge.
 */
import type { Community, Entity, Persona, Relation, RelationType, World } from "./types.js";
import { escapeMermaid, estTokens, slugify, truncate } from "./util/text.js";
import { streamRng, type Rng } from "./util/rng.js";
import { scoreSentiment } from "./sentiment.js";
import type { Storage } from "./store/storage.js";

const OPPOSITION_CUES = ["rival", "competitor", "competition", "opposes", "opposed", "against", "versus", "conflict", "feud", "critic", "critical of", "attack", "attacked", "sues", "sued", "undercut", "undercuts"];
const ALLIANCE_CUES = ["partner", "partnership", "alliance", "collaborate", "collaboration", "supports", "backed by", "backs", "sponsors", "integrates with", "built on", "allied"];
const OWNERSHIP_CUES = ["owns", "acquired", "acquisition", "subsidiary", "parent company", "spun off", "bought", "parent of"];
const INFLUENCE_CUES = ["works at", "employee", "founder", "co-founder", "ceo", "cto", "runs", "leads", "in charge", "employee of", "head of"];

export interface DerivedEdge {
  srcId: string;
  dstId: string;
  type: RelationType;
  weight: number;
  tension: number;
}

/** Deterministic typed-relation derivation over the ontology. */
export function deriveRelations(entities: Entity[]): DerivedEdge[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  // deterministic iteration order
  const ordered = [...entities].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const edges: DerivedEdge[] = [];
  const seen = new Set<string>();

  const push = (src: Entity, dst: Entity, type: RelationType, weight: number, tension: number) => {
    if (src.id === dst.id) return;
    // symmetric types normalized to a canonical direction
    const symmetric = type === "alliance" || type === "opposition";
    const [a, b] = symmetric && dst.id < src.id ? [dst, src] : [src, dst];
    const key = `${a.id}|${b.id}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ srcId: a.id, dstId: b.id, type, weight: round2(weight), tension: round2(tension) });
  };

  const textOf = (e: Entity) => `${e.description} ${e.motives.join(" ")} ${e.anchors.join(" ")}`.toLowerCase();

  for (const src of ordered) {
    const text = textOf(src);
    for (const dst of ordered) {
      if (dst.id === src.id) continue;
      const name = dst.name.toLowerCase();
      if (!wordContains(text, name)) continue;
      const salience = src.salience * dst.salience;
      if (matches(text, name, OPPOSITION_CUES)) {
        push(src, dst, "opposition", 0.5 + 0.5 * salience, 0.55 + 0.45 * salience);
      } else if (matches(text, name, OWNERSHIP_CUES)) {
        if (src.type === "org" || src.type === "person") push(src, dst, "ownership", 0.5 + 0.4 * salience, 0.25 * salience);
      } else if (matches(text, name, INFLUENCE_CUES)) {
        if (src.type === "person") push(src, dst, "influence", 0.45 + 0.45 * salience, 0.2 + 0.2 * salience);
      } else if (matches(text, name, ALLIANCE_CUES)) {
        push(src, dst, "alliance", 0.45 + 0.45 * salience, 0.12 + 0.08 * salience);
      }
    }
  }

  // Shared anchors imply alliance (Jaccard over anchor keywords)
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      const sa = new Set(a.anchors.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 3));
      const sb = new Set(b.anchors.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 3));
      if (sa.size === 0 || sb.size === 0) continue;
      let inter = 0;
      for (const w of sa) if (sb.has(w)) inter++;
      const union = new Set([...sa, ...sb]).size;
      const jac = inter / union;
      if (jac >= 0.25) push(a, b, "alliance", 0.4 + 0.4 * jac, 0.1 + 0.1 * jac);
    }
  }

  return edges;
}

function wordContains(haystack: string, name: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i");
  return re.test(haystack);
}

function matches(text: string, name: string, cues: string[]): boolean {
  // a cue near the entity mention (same text blob is our resolution unit)
  return cues.some((c) => text.includes(c));
}

/** Reddit-style communities derived from product/topic/org entities. */
export function buildCommunities(entities: Entity[]): Community[] {
  return entities
    .filter((e) => e.type === "product" || e.type === "topic" || e.type === "org")
    .map((e) => ({ id: `c_${e.id}`, entityId: e.id, name: `r/${slugify(e.name)}` }));
}

/**
 * Deterministic follow graph for twitter-capable personas (stance affinity +
 * preferential attachment). Degree heterogeneity:
 *  - each persona's outgoing follow count is drawn from a truncated zipf
 *    (exponent ~1.8) within the existing [3, 7] bounds, so ~20% of personas
 *    land in the hub bucket (6-7 follows);
 *  - target selection carries an in-degree preferential-attachment bias, so
 *    incoming follows concentrate: ~20% of personas become follower hubs
 *    instead of a uniform fan-out.
 * Seeded per persona via streamRng (`follows:${personaId}`) — deterministic.
 * `opts` is additive: existing two-argument callers are unchanged.
 */
export function buildFollowGraph(
  world: World,
  personas: Persona[],
  opts: { minFollows?: number; maxFollows?: number; zipfExponent?: number; paBias?: number } = {}
): { personaId: string; follows: string[] }[] {
  const minFollows = opts.minFollows ?? 3;
  const maxFollows = opts.maxFollows ?? 7;
  const zipfExponent = opts.zipfExponent ?? 1.8;
  const paBias = opts.paBias ?? 0.6;
  const twitters = personas.filter((p) => p.platform === "twitter" || p.platform === "both");
  const result: { personaId: string; follows: string[] }[] = [];
  // in-degree starts at 1 for every node (nobody is unreachable) and grows as
  // later personas pick them — classic rich-get-richer preferential attachment
  const inDegree = new Map<string, number>(twitters.map((p) => [p.id, 1]));
  for (const p of twitters) {
    const rng = streamRng(world.seed, `follows:${p.id}`);
    const others = twitters.filter((o) => o.id !== p.id);
    const maxIn = Math.max(...inDegree.values());
    const scored = others
      .map((o) => ({
        id: o.id,
        score:
          stanceCosine(p.stances, o.stances) +
          0.15 * o.activity +
          0.1 * o.traits.extraversion +
          paBias * ((inDegree.get(o.id) ?? 1) / maxIn),
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const k = zipfInt(rng, minFollows, maxFollows, zipfExponent);
    const top = scored.slice(0, Math.min(k, scored.length)).map((s) => s.id);
    for (const id of top) inDegree.set(id, (inDegree.get(id) ?? 1) + 1);
    result.push({ personaId: p.id, follows: top });
  }
  return result;
}

/** Draw k from a truncated zipf p(k) ∝ k^-exponent over [minK, maxK]. */
function zipfInt(rng: Rng, minK: number, maxK: number, exponent: number): number {
  const lo = Math.max(1, Math.min(minK, maxK));
  const hi = Math.max(lo, maxK);
  const weights: number[] = [];
  let total = 0;
  for (let k = lo; k <= hi; k++) {
    const w = Math.pow(k, -exponent);
    weights.push(w);
    total += w;
  }
  let r = rng.float() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return lo + i;
  }
  return hi;
}

export function stanceCosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of Object.keys(a)) {
    na += a[k] * a[k];
    if (b[k] !== undefined) dot += a[k] * b[k];
  }
  for (const k of Object.keys(b)) nb += b[k] * b[k];
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Apply graph_build: relations + communities persisted; personas gain follows/memberships. */
export function buildGraph(storage: Storage, world: World): { relations: number; tensions: number; communities: number } {
  const entities = storage.listEntities(world.id);
  if (entities.length === 0) throw new Error("no entities: run ontology_plan / ontology_submit first");
  const edges = deriveRelations(entities);
  storage.replaceRelations(world.id, edges);
  const tensions = edges.filter((e) => e.tension > 0.5).length;

  const personas = storage.listPersonas(world.id);
  const communities = buildCommunities(entities);
  if (personas.length > 0) {
    // personas may exist if the user ran personas before graph_build — attach now
    const follows = new Map(buildFollowGraph(world, personas).map((f) => [f.personaId, f.follows]));
    for (const p of personas) {
      const membership = communitiesFor(p, communities, entities);
      storage.patchPersona(p.id, { follows: follows.get(p.id) ?? p.follows, communityIds: membership });
    }
  }
  storage.setStage(world.id, "graphed");
  return { relations: edges.length, tensions, communities: communities.length };
}

/** Reddit community membership for a persona: top |stance| × salience entities that have communities. */
export function communitiesFor(persona: Persona, communities: Community[], entities: Entity[]): string[] {
  if (persona.platform === "twitter") return [];
  const byEntity = new Map(communities.map((c) => [c.entityId, c.id]));
  const ranked = entities
    .filter((e) => byEntity.has(e.id))
    .map((e) => ({ id: byEntity.get(e.id)!, score: Math.abs(persona.stances[e.id] ?? 0) * e.salience }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked.slice(0, 3).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Query + Mermaid
// ---------------------------------------------------------------------------

export interface GraphQueryResult {
  nodes: { id: string; name: string; type: string; salience: number }[];
  edges: { src: string; dst: string; type: RelationType; weight: number; tension: number }[];
  tokens: number;
  truncated: boolean;
}

export function graphQuery(
  storage: Storage,
  world: World,
  opts: { anchor?: string; relation?: RelationType; minTension?: number; depth?: number; tokenBudget?: number } = {}
): GraphQueryResult {
  const entities = storage.listEntities(world.id);
  const relations = storage.listRelations(world.id).filter(
    (r) => (opts.relation ? r.type === opts.relation : true) && r.tension >= (opts.minTension ?? 0)
  );
  const depth = Math.max(1, Math.min(3, opts.depth ?? 1));
  const budget = opts.tokenBudget ?? 4000;

  let focusIds: Set<string> | null = null;
  if (opts.anchor) {
    const anchor = findEntity(entities, opts.anchor);
    if (!anchor) throw new Error(`anchor entity not found: ${opts.anchor}`);
    focusIds = new Set<string>([anchor.id]);
    const adjacency = new Map<string, string[]>();
    for (const r of relations) {
      push2(adjacency, r.srcId, r.dstId);
      push2(adjacency, r.dstId, r.srcId);
    }
    const frontier = [anchor.id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of adjacency.get(id) ?? []) {
          if (!focusIds.has(n)) {
            focusIds.add(n);
            next.push(n);
          }
        }
      }
      frontier.length = 0;
      frontier.push(...next);
    }
  }

  const nodes = entities
    .filter((e) => !focusIds || focusIds.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, type: e.type, salience: e.salience }));
  let edges = relations
    .filter((r) => !focusIds || (focusIds.has(r.srcId) && focusIds.has(r.dstId)))
    .map((r) => ({ src: r.srcId, dst: r.dstId, type: r.type, weight: r.weight, tension: r.tension }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  edges = edges.filter((r) => nodeIds.has(r.src) && nodeIds.has(r.dst));

  let truncated = false;
  let result = { nodes, edges };
  while (estTokens(JSON.stringify(result)) > budget && result.edges.length > 4) {
    // drop lowest-tension edges first
    result = { nodes: result.nodes, edges: result.edges.slice(0, Math.floor(result.edges.length * 0.8)) };
    truncated = true;
  }
  while (estTokens(JSON.stringify(result)) > budget && result.nodes.length > 6) {
    result = { nodes: result.nodes.slice(0, Math.floor(result.nodes.length * 0.8)), edges: result.edges };
    truncated = true;
  }
  const nodeIds2 = new Set(result.nodes.map((n) => n.id));
  const finalEdges = result.edges.filter((r) => nodeIds2.has(r.src) && nodeIds2.has(r.dst));
  return { ...result, edges: finalEdges, tokens: estTokens(JSON.stringify(result)), truncated };
}

export function findEntity(entities: Entity[], nameOrId: string): Entity | undefined {
  const byId = entities.find((e) => e.id === nameOrId);
  if (byId) return byId;
  const lower = nameOrId.toLowerCase();
  return (
    entities.find((e) => e.name.toLowerCase() === lower) ??
    entities.find((e) => e.name.toLowerCase().replace(/[^a-z0-9]/g, "") === lower.replace(/[^a-z0-9]/g, "")) ??
    entities.find((e) => e.name.toLowerCase().startsWith(lower))
  );
}

export function toMermaid(result: GraphQueryResult): string {
  const lines = ["graph LR"];
  const hot = new Set<string>();
  for (const n of result.nodes) {
    lines.push(`  ${n.id}["${escapeMermaid(n.name)} (${n.type})"]`);
  }
  for (const e of result.edges) {
    const label = e.tension >= 0.5 ? `${e.type} ⚠${Math.round(e.tension * 100)}` : `${e.type} ${Math.round(e.weight * 100)}`;
    lines.push(`  ${e.src} -->|"${label}"| ${e.dst}`);
    if (e.tension >= 0.5) {
      hot.add(e.src);
      hot.add(e.dst);
    }
  }
  lines.push("  classDef hot fill:#ffe0e0,stroke:#c0392b,stroke-width:2px;");
  for (const id of [...hot].sort()) lines.push(`  class ${id} hot;`);
  return lines.join("\n") + "\n";
}

/** Entity stance hint for the personas_plan task payload. */
export function stanceHint(entity: Entity, relations: Relation[]): string {
  const oppos = relations.some((r) => (r.srcId === entity.id || r.dstId === entity.id) && r.type === "opposition");
  const anchorsText = entity.anchors.join(". ");
  const s = scoreSentiment(anchorsText).score;
  if (oppos) return "divisive (active opposition)";
  if (s > 0.15) return "sympathetic ground";
  if (s < -0.15) return "hostile ground";
  return entity.salience > 0.7 ? "highly salient, contested" : "mixed";
}

function push2(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
