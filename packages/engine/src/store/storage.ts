/**
 * SQLite storage adapter for the engine. One class, grouped methods,
 * JSON columns for nested structures, WAL mode, foreign keys enforced.
 */
import Database from "better-sqlite3";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";
import { clamp, nowIso, stableStringify } from "../util/text.js";
import { hashHex } from "../util/rng.js";
import {
  DEFAULT_CONFIG,
  type Entity,
  type EntityType,
  type GenerationTask,
  type MemoryKind,
  type MemoryRecord,
  type MemoryTier,
  type MurmurConfig,
  type Persona,
  type Platform,
  type Post,
  type PostKind,
  type PostMetrics,
  type Relation,
  type RelationType,
  type ReportDraft,
  type ReportRecord,
  type Seed,
  type SeedKind,
  type Stage,
  type TaskVerdict,
  type World,
  type WorldEvent,
} from "../types.js";

// ---------------------------------------------------------------------------
// Open + migrate
// ---------------------------------------------------------------------------

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, nowIso());
    });
    tx();
  }
  const v = (
    db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null }
  ).v;
  if (v !== SCHEMA_VERSION) throw new Error(`schema version mismatch: expected ${SCHEMA_VERSION}, found ${v}`);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const S = (v: unknown): string => String(v ?? "");
const N = (v: unknown): number => Number(v ?? 0);
const J = <T>(v: unknown, fallback: T): T => {
  try {
    return v == null ? fallback : (JSON.parse(String(v)) as T);
  } catch {
    return fallback;
  }
};

function worldFromRow(r: Row): World {
  return {
    id: S(r.id),
    name: S(r.name),
    slug: S(r.slug),
    description: S(r.description),
    stage: S(r.stage) as Stage,
    round: N(r.round),
    seed: S(r.seed),
    config: J(r.config, DEFAULT_CONFIG),
    createdAt: S(r.created_at),
    updatedAt: S(r.updated_at),
  };
}

function seedFromRow(r: Row): Seed {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    kind: S(r.kind) as SeedKind,
    title: S(r.title),
    ref: S(r.ref),
    hash: S(r.hash),
    bytes: N(r.bytes),
    digest: S(r.digest),
    addedAt: S(r.added_at),
  };
}

function entityFromRow(r: Row): Entity {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    name: S(r.name),
    type: S(r.type) as EntityType,
    description: S(r.description),
    salience: N(r.salience),
    anchors: J<string[]>(r.anchors, []),
    motives: J<string[]>(r.motives, []),
  };
}

function relationFromRow(r: Row): Relation {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    srcId: S(r.src_id),
    dstId: S(r.dst_id),
    type: S(r.type) as RelationType,
    weight: N(r.weight),
    tension: N(r.tension),
  };
}

function personaFromRow(r: Row): Persona {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    name: S(r.name),
    handle: S(r.handle),
    archetype: S(r.archetype),
    bio: S(r.bio),
    traits: J<Persona["traits"]>(r.traits, {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      emotionalStability: 0.5,
    }),
    stances: J<Record<string, number>>(r.stances, {}),
    platform: S(r.platform) as Platform,
    activity: N(r.activity),
    communityIds: J<string[]>(r.community_ids, []),
    follows: J<string[]>(r.follows, []),
    createdAt: S(r.created_at),
  };
}

function memoryFromRow(r: Row): MemoryRecord {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    personaId: r.persona_id == null ? null : S(r.persona_id),
    tier: S(r.tier) as MemoryTier,
    kind: S(r.kind) as MemoryKind,
    content: S(r.content),
    salience: N(r.salience),
    round: N(r.round),
    createdAt: S(r.created_at),
  };
}

function postFromRow(r: Row): Post {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    round: N(r.round),
    personaId: S(r.persona_id),
    platform: S(r.platform) as "twitter" | "reddit",
    kind: S(r.kind) as PostKind,
    parentId: r.parent_id == null ? null : S(r.parent_id),
    threadId: S(r.thread_id),
    communityId: r.community_id == null ? null : S(r.community_id),
    title: r.title == null ? null : S(r.title),
    body: S(r.body),
    metrics: J<PostMetrics>(r.metrics, { likes: 0, reposts: 0, upvotes: 0, downvotes: 0, impressions: 0 }),
    mentions: J<Post["mentions"]>(r.mentions, []),
    origin: S(r.origin) as Post["origin"],
  };
}

function eventFromRow(r: Row): WorldEvent {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    round: N(r.round),
    type: S(r.type) as WorldEvent["type"],
    payload: J<Record<string, unknown>>(r.payload, {}),
    scope: S(r.scope),
    createdAt: S(r.created_at),
  };
}

function reportFromRow(r: Row): ReportRecord {
  return {
    id: S(r.id),
    worldId: S(r.world_id),
    version: N(r.version),
    focus: S(r.focus),
    narrative: J<ReportDraft>(r.narrative, { executiveSummary: "", trajectory: "", risks: [], confidence: { strongSignals: [], contested: [] } }),
    path: S(r.path),
    createdAt: S(r.created_at),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class Storage {
  constructor(readonly db: Database.Database) {}

  close(): void {
    this.db.close();
  }

  /** Deterministic, restart-safe id: count-based per table. */
  private mintId(prefix: string, table: string): string {
    const n = (this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    return `${prefix}_${n + 1}`;
  }

  /** Public id mint for generation tasks (t_1, t_2, …). */
  nextTaskId(): string {
    return this.mintId("t", "generations");
  }

  // ----- worlds -----------------------------------------------------------

  createWorld(input: { name: string; description?: string; seed?: string; slugHint?: string }): World {
    const now = nowIso();
    const seed = input.seed?.trim() || null;
    // Deterministic world id when a seed is supplied (golden-run replay),
    // random otherwise (crypto quality not required — uniqueness is).
    const id = seed ? `w_${hashHex(seed).slice(0, 10)}` : `w_${hashHex(`${now}:${Math.random()}`).slice(0, 10)}`;
    let slug = (input.slugHint ?? input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "world";
    const taken = new Set((this.db.prepare("SELECT slug FROM worlds").all() as Row[]).map((r) => S(r.slug)));
    let candidate = slug;
    for (let i = 2; taken.has(candidate); i++) candidate = `${slug}-${i}`;
    slug = candidate;
    this.db
      .prepare(
        "INSERT INTO worlds (id, name, slug, description, stage, round, seed, config, created_at, updated_at) VALUES (?,?,?,?, 'created', 0, ?,?,?,?)"
      )
      .run(id, input.name, slug, input.description ?? "", seed ?? `auto-${id}`, JSON.stringify(DEFAULT_CONFIG), now, now);
    return this.getWorld(id)!;
  }

  getWorld(idOrSlug: string): World | null {
    const r = this.db.prepare("SELECT * FROM worlds WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug) as Row | undefined;
    return r ? worldFromRow(r) : null;
  }

  listWorlds(): World[] {
    return (this.db.prepare("SELECT * FROM worlds ORDER BY created_at DESC").all() as Row[]).map(worldFromRow);
  }

  latestWorld(): World | null {
    const r = this.db.prepare("SELECT * FROM worlds ORDER BY created_at DESC LIMIT 1").get() as Row | undefined;
    return r ? worldFromRow(r) : null;
  }

  private touch(id: string): void {
    this.db.prepare("UPDATE worlds SET updated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  updateWorld(id: string, patch: Partial<Pick<World, "name" | "description" | "round" | "config">>): void {
    const w = this.getWorld(id);
    if (!w) return;
    this.db
      .prepare("UPDATE worlds SET name=?, description=?, round=?, config=?, updated_at=? WHERE id=?")
      .run(patch.name ?? w.name, patch.description ?? w.description, patch.round ?? w.round, JSON.stringify(patch.config ?? w.config), nowIso(), id);
  }

  /** Forward-only stage transition. */
  setStage(id: string, stage: Stage): void {
    const w = this.getWorld(id);
    if (!w) return;
    const order = ["created", "seeded", "ontologized", "graphed", "populated", "configured", "running", "completed", "reported"];
    if (order.indexOf(stage) > order.indexOf(w.stage)) {
      this.db.prepare("UPDATE worlds SET stage=?, updated_at=? WHERE id=?").run(stage, nowIso(), id);
      this.addEvent(id, w.round, "stage", { stage }, "world");
    }
  }

  // ----- seeds ------------------------------------------------------------

  addSeed(worldId: string, input: { kind: SeedKind; title: string; ref: string; text: string; digest: string }): { seed: Seed; duplicate: boolean } {
    const hash = hashHex(input.text);
    const existing = this.db.prepare("SELECT * FROM seeds WHERE world_id=? AND hash=?").get(worldId, hash) as Row | undefined;
    if (existing) return { seed: seedFromRow(existing), duplicate: true };
    const id = this.mintId("sd", "seeds");
    this.db
      .prepare("INSERT INTO seeds (id, world_id, kind, title, ref, hash, bytes, digest, added_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, worldId, input.kind, input.title, input.ref, hash, Buffer.byteLength(input.text, "utf8"), input.digest, nowIso());
    this.touch(worldId);
    const row = this.db.prepare("SELECT * FROM seeds WHERE id=?").get(id) as Row;
    return { seed: seedFromRow(row), duplicate: false };
  }

  listSeeds(worldId: string): Seed[] {
    return (this.db.prepare("SELECT * FROM seeds WHERE world_id=? ORDER BY added_at, id").all(worldId) as Row[]).map(seedFromRow);
  }

  // ----- entities ---------------------------------------------------------

  /** Insert entities, skipping names already present (idempotent surgical retry). */
  insertEntities(worldId: string, entities: Entity[]): { inserted: Entity[]; skipped: string[] } {
    const existing = new Set(this.listEntities(worldId).map((e) => e.name.toLowerCase()));
    const inserted: Entity[] = [];
    const skipped: string[] = [];
    const tx = this.db.transaction(() => {
      for (const e of entities) {
        if (existing.has(e.name.toLowerCase())) {
          skipped.push(e.name);
          continue;
        }
        const id = this.mintId("e", "entities");
        this.db
          .prepare("INSERT INTO entities (id, world_id, name, type, description, salience, anchors, motives) VALUES (?,?,?,?,?,?,?,?)")
          .run(id, worldId, e.name, e.type, e.description, clamp(e.salience, 0, 1), JSON.stringify(e.anchors), JSON.stringify(e.motives));
        inserted.push({ ...e, id, worldId });
        existing.add(e.name.toLowerCase());
      }
    });
    tx();
    if (inserted.length) this.touch(worldId);
    return { inserted, skipped };
  }

  listEntities(worldId: string): Entity[] {
    return (this.db.prepare("SELECT * FROM entities WHERE world_id=? ORDER BY salience DESC, name").all(worldId) as Row[]).map(entityFromRow);
  }

  // ----- relations --------------------------------------------------------

  replaceRelations(worldId: string, relations: Omit<Relation, "id" | "worldId">[]): number {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM relations WHERE world_id=?").run(worldId);
      for (const r of relations) {
        const id = this.mintId("rel", "relations");
        this.db
          .prepare("INSERT INTO relations (id, world_id, src_id, dst_id, type, weight, tension) VALUES (?,?,?,?,?,?,?)")
          .run(id, worldId, r.srcId, r.dstId, r.type, r.weight, r.tension);
      }
    });
    tx();
    this.touch(worldId);
    return relations.length;
  }

  listRelations(worldId: string): Relation[] {
    return (this.db.prepare("SELECT * FROM relations WHERE world_id=? ORDER BY tension DESC, weight DESC").all(worldId) as Row[]).map(relationFromRow);
  }

  // ----- personas ---------------------------------------------------------

  insertPersonas(worldId: string, personas: Omit<Persona, "id" | "worldId" | "createdAt">[]): Persona[] {
    const out: Persona[] = [];
    const tx = this.db.transaction(() => {
      for (const p of personas) {
        const id = this.mintId("p", "personas");
        this.db
          .prepare(
            "INSERT INTO personas (id, world_id, name, handle, archetype, bio, traits, stances, platform, activity, community_ids, follows, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
          )
          .run(id, worldId, p.name, p.handle, p.archetype, p.bio, JSON.stringify(p.traits), JSON.stringify(p.stances), p.platform, p.activity, JSON.stringify(p.communityIds), JSON.stringify(p.follows), nowIso());
        out.push({ ...p, id, worldId, createdAt: nowIso() });
      }
    });
    tx();
    this.touch(worldId);
    return out;
  }

  listPersonas(worldId: string): Persona[] {
    return (this.db.prepare("SELECT * FROM personas WHERE world_id=? ORDER BY id").all(worldId) as Row[]).map(personaFromRow);
  }

  countPersonas(worldId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM personas WHERE world_id=?").get(worldId) as { c: number }).c;
  }

  getPersona(worldId: string, idOrHandle: string): Persona | null {
    const r = this.db.prepare("SELECT * FROM personas WHERE world_id=? AND (id=? OR lower(handle)=lower(?))").get(worldId, idOrHandle, idOrHandle) as Row | undefined;
    return r ? personaFromRow(r) : null;
  }

  patchPersona(id: string, patch: Partial<Pick<Persona, "name" | "handle" | "archetype" | "bio" | "traits" | "stances" | "platform" | "activity" | "communityIds" | "follows">>): void {
    const r = this.db.prepare("SELECT * FROM personas WHERE id=?").get(id) as Row | undefined;
    if (!r) return;
    const cur = personaFromRow(r);
    this.db
      .prepare("UPDATE personas SET name=?, handle=?, archetype=?, bio=?, traits=?, stances=?, platform=?, activity=?, community_ids=?, follows=? WHERE id=?")
      .run(
        patch.name ?? cur.name,
        patch.handle ?? cur.handle,
        patch.archetype ?? cur.archetype,
        patch.bio ?? cur.bio,
        JSON.stringify(patch.traits ?? cur.traits),
        JSON.stringify(patch.stances ?? cur.stances),
        patch.platform ?? cur.platform,
        clamp(patch.activity ?? cur.activity, 0.01, 1),
        JSON.stringify(patch.communityIds ?? cur.communityIds),
        JSON.stringify(patch.follows ?? cur.follows),
        id
      );
  }

  // ----- memories ---------------------------------------------------------

  appendMemory(worldId: string, personaId: string | null, tier: MemoryTier, kind: MemoryKind, content: string, salience: number, round: number): MemoryRecord {
    const id = this.mintId("mem", "memories");
    this.db
      .prepare("INSERT INTO memories (id, world_id, persona_id, tier, kind, content, salience, round, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, worldId, personaId, tier, kind, content, clamp(salience, 0, 1), round, nowIso());
    return { id, worldId, personaId, tier, kind, content, salience: clamp(salience, 0, 1), round, createdAt: nowIso() };
  }

  listMemories(worldId: string, opts: { personaId?: string | null; tier?: MemoryTier; kinds?: MemoryKind[]; limit?: number; upToRound?: number }): MemoryRecord[] {
    const conds: string[] = ["world_id=?"];
    const args: unknown[] = [worldId];
    if (opts.personaId !== undefined) {
      conds.push("persona_id IS ?");
      args.push(opts.personaId);
    }
    if (opts.tier) {
      conds.push("tier=?");
      args.push(opts.tier);
    }
    if (opts.kinds?.length) {
      conds.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
      args.push(...opts.kinds);
    }
    if (opts.upToRound !== undefined) {
      conds.push("round<=?");
      args.push(opts.upToRound);
    }
    const limit = opts.limit ?? 200;
    return (this.db.prepare(`SELECT * FROM memories WHERE ${conds.join(" AND ")} ORDER BY round DESC, id DESC LIMIT ?`).all(...args, limit) as Row[]).map(memoryFromRow);
  }

  countMemories(worldId: string, personaId: string, tier: MemoryTier): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE world_id=? AND persona_id=? AND tier=?").get(worldId, personaId, tier) as { c: number }).c;
  }

  deleteMemories(ids: string[]): void {
    if (!ids.length) return;
    const tx = this.db.transaction(() => {
      for (const id of ids) this.db.prepare("DELETE FROM memories WHERE id=?").run(id);
    });
    tx();
  }

  // ----- posts ------------------------------------------------------------

  insertPost(post: Omit<Post, "id"> & { id?: string }): Post {
    const id = post.id ?? this.mintId("po", "posts");
    const threadId = post.threadId || id; // root posts are their own thread
    this.db
      .prepare(
        "INSERT INTO posts (id, world_id, round, persona_id, platform, kind, parent_id, thread_id, community_id, title, body, metrics, mentions, origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(id, post.worldId, post.round, post.personaId, post.platform, post.kind, post.parentId, threadId, post.communityId, post.title, post.body, JSON.stringify(post.metrics), JSON.stringify(post.mentions), post.origin);
    return { ...post, id, threadId };
  }

  getPost(worldId: string, id: string): Post | null {
    const r = this.db.prepare("SELECT * FROM posts WHERE world_id=? AND id=?").get(worldId, id) as Row | undefined;
    return r ? postFromRow(r) : null;
  }

  listPosts(worldId: string, opts: { platform?: "twitter" | "reddit"; kinds?: PostKind[]; personaId?: string; minRound?: number; maxRound?: number; limit?: number } = {}): Post[] {
    const conds: string[] = ["world_id=?"];
    const args: unknown[] = [worldId];
    if (opts.platform) { conds.push("platform=?"); args.push(opts.platform); }
    if (opts.kinds?.length) { conds.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`); args.push(...opts.kinds); }
    if (opts.personaId) { conds.push("persona_id=?"); args.push(opts.personaId); }
    if (opts.minRound !== undefined) { conds.push("round>=?"); args.push(opts.minRound); }
    if (opts.maxRound !== undefined) { conds.push("round<=?"); args.push(opts.maxRound); }
    return (this.db.prepare(`SELECT * FROM posts WHERE ${conds.join(" AND ")} ORDER BY round DESC, id DESC ${opts.limit ? "LIMIT " + opts.limit : ""}`).all(...args) as Row[]).map(postFromRow);
  }

  countPosts(worldId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM posts WHERE world_id=?").get(worldId) as { c: number }).c;
  }

  countAllPosts(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM posts").get() as { c: number }).c;
  }

  childrenOf(worldId: string, parentId: string): Post[] {
    return (this.db.prepare("SELECT * FROM posts WHERE world_id=? AND parent_id=? ORDER BY id").all(worldId, parentId) as Row[]).map(postFromRow);
  }

  threadPosts(worldId: string, threadId: string): Post[] {
    return (this.db.prepare("SELECT * FROM posts WHERE world_id=? AND thread_id=? ORDER BY id").all(worldId, threadId) as Row[]).map(postFromRow);
  }

  updatePostMetrics(id: string, metrics: PostMetrics): void {
    this.db.prepare("UPDATE posts SET metrics=? WHERE id=?").run(JSON.stringify(metrics), id);
  }

  addImpressions(ids: string[], by = 1): void {
    if (!ids.length) return;
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare("UPDATE posts SET metrics = json_set(metrics, '$.impressions', json_extract(metrics,'$.impressions') + ?) WHERE id=?");
      for (const id of ids) stmt.run(by, id);
    });
    tx();
  }

  // ----- events -----------------------------------------------------------

  addEvent(worldId: string, round: number, type: WorldEvent["type"], payload: Record<string, unknown>, scope = "all"): WorldEvent {
    const id = this.mintId("ev", "events");
    this.db
      .prepare("INSERT INTO events (id, world_id, round, type, payload, scope, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, worldId, round, type, JSON.stringify(payload), scope, nowIso());
    return { id, worldId, round, type, payload, scope, createdAt: nowIso() };
  }

  listEvents(worldId: string, opts: { type?: WorldEvent["type"]; sinceRound?: number; upToRound?: number; limit?: number } = {}): WorldEvent[] {
    const conds: string[] = ["world_id=?"];
    const args: unknown[] = [worldId];
    if (opts.type) { conds.push("type=?"); args.push(opts.type); }
    if (opts.sinceRound !== undefined) { conds.push("round>=?"); args.push(opts.sinceRound); }
    if (opts.upToRound !== undefined) { conds.push("round<=?"); args.push(opts.upToRound); }
    return (this.db.prepare(`SELECT * FROM events WHERE ${conds.join(" AND ")} ORDER BY round DESC, id DESC ${opts.limit ? "LIMIT " + opts.limit : ""}`).all(...args) as Row[]).map(eventFromRow);
  }

  // ----- reports ----------------------------------------------------------

  insertReport(worldId: string, input: { version: number; focus: string; narrative: ReportDraft; path: string }): ReportRecord {
    const id = this.mintId("rp", "reports");
    this.db
      .prepare("INSERT INTO reports (id, world_id, version, focus, narrative, path, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, worldId, input.version, input.focus, JSON.stringify(input.narrative), input.path, nowIso());
    this.touch(worldId);
    return { id, worldId, ...input, createdAt: nowIso() };
  }

  latestReport(worldId: string): ReportRecord | null {
    const r = this.db.prepare("SELECT * FROM reports WHERE world_id=? ORDER BY version DESC LIMIT 1").get(worldId) as Row | undefined;
    return r ? reportFromRow(r) : null;
  }

  reportByVersion(worldId: string, version: number): ReportRecord | null {
    const r = this.db.prepare("SELECT * FROM reports WHERE world_id=? AND version=?").get(worldId, version) as Row | undefined;
    return r ? reportFromRow(r) : null;
  }

  // ----- generation tasks (audit trail) -----------------------------------

  saveTask(task: GenerationTask): void {
    this.db
      .prepare("INSERT OR REPLACE INTO generations (id, world_id, kind, round, task, status, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(task.id, task.worldId, task.kind, task.round, JSON.stringify(task), "pending", nowIso());
    this.touch(task.worldId);
  }

  getTask(id: string): GenerationTask | null {
    const r = this.db.prepare("SELECT task FROM generations WHERE id=?").get(id) as Row | undefined;
    return r ? (J<GenerationTask>(r.task, null as never) ?? null) : null;
  }

  completeTask(id: string, submitted: unknown, verdicts: TaskVerdict, status: "submitted" | "partial" | "held"): void {
    this.db
      .prepare("UPDATE generations SET status=?, submitted=?, verdicts=?, submitted_at=? WHERE id=?")
      .run(status, JSON.stringify(submitted), JSON.stringify(verdicts), nowIso(), id);
  }

  getTaskVerdicts(id: string): TaskVerdict | null {
    const r = this.db.prepare("SELECT verdicts FROM generations WHERE id=?").get(id) as Row | undefined;
    return r && r.verdicts ? J<TaskVerdict>(r.verdicts, null as never) : null;
  }

  listTasks(worldId: string, kind?: GenerationTask["kind"]): GenerationTask[] {
    const rows = kind
      ? (this.db.prepare("SELECT task FROM generations WHERE world_id=? AND kind=? ORDER BY created_at").all(worldId, kind) as Row[])
      : (this.db.prepare("SELECT task FROM generations WHERE world_id=? ORDER BY created_at").all(worldId) as Row[]);
    return rows.map((r) => J<GenerationTask>(r.task, null as never)).filter(Boolean);
  }

  // ----- golden-run dump --------------------------------------------------

  /** Stable, timestamp-normalized dump of all world content (determinism testing). */
  dumpWorld(worldId: string): string {
    const norm = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(norm);
      if (v && typeof v === "object") {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) {
          if (k === "created_at" || k === "updated_at" || k === "addedAt" || k === "createdAt" || k === "updatedAt") continue;
          o[k] = norm((v as Record<string, unknown>)[k]);
        }
        return o;
      }
      return v;
    };
    const dump = {
      world: this.getWorld(worldId),
      seeds: this.listSeeds(worldId),
      entities: this.listEntities(worldId),
      relations: this.listRelations(worldId),
      personas: this.listPersonas(worldId),
      memories: this.listMemories(worldId, { limit: 100000 }),
      posts: this.listPosts(worldId, { limit: 100000 }),
      events: this.listEvents(worldId, { limit: 100000 }),
      reports: (this.db.prepare("SELECT * FROM reports WHERE world_id=? ORDER BY version").all(worldId) as Row[]).map(reportFromRow),
    };
    return stableStringify(norm(dump));
  }
}

// Re-export convenience type for config merging on the server side.
export type { MurmurConfig };
