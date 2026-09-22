/**
 * F7 — Deep interaction. interview_agent assembles a grounded pack for one
 * persona (its posts, episodic memory, traits, stances) so the host LLM can
 * answer in character and cite its own posts — and decline what it never
 * saw. report_agent_ask runs the same pattern over the whole corpus.
 */
import type { Entity, Persona, World } from "./types.js";
import type { Storage } from "./store/storage.js";
import { personaCard } from "./personas.js";
import { memoryTimeline } from "./memory.js";
import { postSentiment, timeline, topPostsByEngagement } from "./aggregate.js";
import { nowIso, round2Safe, truncate, tokens } from "./util/text.js";

export const INTERVIEW_INSTRUCTIONS = `Answer the user's question AS this persona, in first person, in their voice.
Grounding rules:
- Cite your own prior posts by id (e.g. "like I said in po_12 …") whenever they explain your stance.
- If the question touches something NOT in your card, memory or posts, say you don't recall or didn't follow it — never invent facts.
- Stay consistent with your traits and stances. One paragraph, max ~120 words.`;

export const ASK_INSTRUCTIONS = `You are the ReportAgent for a finished social simulation. Answer the user's question using ONLY the evidence pack (posts + statistics).
Rules:
- Cite post ids inline, e.g. (po_12), for every claim a post supports.
- Distinguish strong evidence (multiple agreeing posts) from weak (single post / contested sentiment).
- If the evidence pack does not cover the question, say so plainly. Max ~200 words.`;

export interface InterviewPack {
  question: string;
  persona: Record<string, unknown>;
  posts: { id: string; round: number; platform: string; body: string; sentiment: number }[];
  memory: { round: number; kind: string; content: string }[];
  instructions: string;
}

export function buildInterviewPack(storage: Storage, world: World, personaId: string, question: string): { persona: Persona; pack: InterviewPack } {
  const persona = storage.getPersona(world.id, personaId);
  if (!persona) throw new Error(`persona not found: ${personaId}`);
  const entities = storage.listEntities(world.id);
  const card = personaCard(persona, entities, world.config).card;
  const posts = storage
    .listPosts(world.id, { personaId: persona.id, limit: 200 })
    .sort((a, b) => {
      const ea = a.metrics.likes + 2 * a.metrics.reposts + a.metrics.upvotes - a.metrics.downvotes;
      const eb = b.metrics.likes + 2 * b.metrics.reposts + b.metrics.upvotes - b.metrics.downvotes;
      return eb - ea || a.id.localeCompare(b.id);
    })
    .slice(0, 10)
    .map((p) => ({ id: p.id, round: p.round, platform: p.platform, body: truncate(p.body, 200), sentiment: round2Safe(postSentiment(p)) }));
  const memory = memoryTimeline(storage, world, persona.id, 12).map((m) => ({ round: m.round, kind: m.kind, content: truncate(m.content, 200) }));
  const fullStances = Object.entries(persona.stances).map(([id, v]) => {
    const e = entities.find((x) => x.id === id);
    return `${e?.name ?? id}: ${round2Safe(v)}`;
  });
  return {
    persona,
    pack: {
      question,
      persona: { ...card, stancesFull: fullStances, traitsFull: persona.traits },
      posts,
      memory,
      instructions: INTERVIEW_INSTRUCTIONS,
    },
  };
}

export interface AskPack {
  question: string;
  matchedEntities: string[];
  matchedPersonas: string[];
  evidence: { id: string; by: string; plat: string; round: number; body: string; sentiment: number }[];
  stats: { rounds: number; population: number; sentimentByEntity: Record<string, number> };
  instructions: string;
}

export function buildAskPack(storage: Storage, world: World, question: string): AskPack {
  const entities = storage.listEntities(world.id);
  const personas = storage.listPersonas(world.id);
  const q = question.toLowerCase();

  const matchedEntities = entities
    .filter((e) => q.includes(e.name.toLowerCase()))
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 5)
    .map((e) => e.name);
  const matchedPersonas = personas
    .filter((p) => q.includes(p.name.toLowerCase()) || q.includes(p.handle.toLowerCase()))
    .slice(0, 5)
    .map((p) => `${p.name} (${p.handle})`);

  const qTokens = new Set(tokens(question));
  const entityIds = new Set(entities.filter((e) => q.includes(e.name.toLowerCase())).map((e) => e.id));
  const posts = storage.listPosts(world.id, { limit: 100000 });
  const handles = new Map(personas.map((p) => [p.id, p.handle]));
  const scoredEvidence = posts
    .map((p) => {
      let score = 0;
      if (entityIds.size > 0 && p.mentions.some((m) => entityIds.has(m.entityId))) score += 3;
      const words = new Set(tokens(`${p.title ?? ""} ${p.body}`));
      for (const t of qTokens) if (words.has(t)) score++;
      const engagement = p.metrics.likes + 2 * p.metrics.reposts + p.metrics.upvotes;
      return { p, score: score + engagement / 20 };
    })
    .filter((x) => x.score > 0.3)
    .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id))
    .slice(0, 12)
    .map(({ p }) => ({
      id: p.id,
      by: handles.get(p.personaId) ?? p.personaId,
      plat: p.platform === "twitter" ? "tw" : "rd",
      round: p.round,
      body: truncate(p.title ? `${p.title} — ${p.body}` : p.body, 220),
      sentiment: round2Safe(postSentiment(p)),
    }));
  // fallback: a question the corpus doesn't keyword-match still gets the run's
  // strongest posts — the ReportAgent always grounds in real evidence
  const evidence = scoredEvidence.length > 0 ? scoredEvidence : topPostsByEngagement(storage, world, 6).map(({ post, sentiment }) => ({
    id: post.id,
    by: handles.get(post.personaId) ?? post.personaId,
    plat: post.platform === "twitter" ? "tw" : "rd",
    round: post.round,
    body: truncate(post.title ? `${post.title} — ${post.body}` : post.body, 220),
    sentiment,
  }));

  const rows = timeline(storage, world);
  const latest = rows[rows.length - 1];
  return {
    question,
    matchedEntities,
    matchedPersonas,
    evidence,
    stats: { rounds: world.round, population: personas.length, sentimentByEntity: latest?.sentimentByEntity ?? {} },
    instructions: ASK_INSTRUCTIONS,
  };
}

export interface QaEntry {
  ts: string;
  question: string;
  answer: string;
  matched?: unknown;
}

export function qaEntry(question: string, answer: string, matched?: unknown): QaEntry {
  return { ts: nowIso(), question, answer, matched };
}

export type { Entity, World };
