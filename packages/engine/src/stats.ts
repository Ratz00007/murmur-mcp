/** World status, round summaries and list rows — the readout helpers. */
import { NEXT_TOOL, type RoundStats, type Stage, type World } from "./types.js";
import type { Storage } from "./store/storage.js";
import { trendingEntities } from "./sim/feed.js";

export interface WorldStatus {
  world: { id: string; name: string; slug: string; stage: Stage; round: number; rounds: number; seed: string };
  counts: { seeds: number; entities: number; personas: number; posts: number; memories: number; events: number; reports: number };
  pendingTask: { id: string; kind: string } | null;
  trending: string[];
  next: string;
}

export function worldStatus(storage: Storage, world: World): WorldStatus {
  const personas = storage.listPersonas(world.id);
  const entities = storage.listEntities(world.id);
  const pending = storage
    .listTasks(world.id)
    .reverse()
    .find((t) => {
      const verdicts = storage.getTaskVerdicts(t.id);
      return !verdicts;
    });
  return {
    world: {
      id: world.id,
      name: world.name,
      slug: world.slug,
      stage: world.stage,
      round: world.round,
      rounds: world.config.rounds,
      seed: world.seed,
    },
    counts: {
      seeds: storage.listSeeds(world.id).length,
      entities: entities.length,
      personas: personas.length,
      posts: storage.countPosts(world.id),
      memories: storage.listMemories(world.id, { limit: 100000 }).length,
      events: storage.listEvents(world.id, { limit: 100000 }).length,
      reports: (storage.latestReport(world.id)?.version ?? 0),
    },
    pendingTask: pending ? { id: pending.id, kind: pending.kind } : null,
    trending: trendingEntities(storage, world, world.round + 1, entities, 4),
    next: NEXT_TOOL[world.stage],
  };
}

export function roundSummary(storage: Storage, world: World, round: number): RoundStats | null {
  const ev = storage.listEvents(world.id, { type: "round_stats" }).find((e) => e.round === round);
  return ((ev?.payload?.stats as RoundStats | undefined) ?? null);
}

export function worldListRow(storage: Storage, world: World) {
  return {
    id: world.id,
    name: world.name,
    slug: world.slug,
    stage: world.stage,
    round: `${world.round}/${world.config.rounds}`,
    personas: storage.countPersonas(world.id),
    posts: storage.countPosts(world.id),
    createdAt: world.createdAt,
  };
}
