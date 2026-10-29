/** SQLite schema — exactly the ten tables from the PRD data model, plus a migrations meta table. */

export const SCHEMA_VERSION = 4;

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'created',
  round INTEGER NOT NULL DEFAULT 0,
  seed TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE seeds (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  ref TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  digest TEXT NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE (world_id, hash)
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  salience REAL NOT NULL DEFAULT 0.5,
  anchors TEXT NOT NULL DEFAULT '[]',
  motives TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX idx_entities_world_name ON entities(world_id, lower(name));

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  src_id TEXT NOT NULL REFERENCES entities(id),
  dst_id TEXT NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,
  weight REAL NOT NULL,
  tension REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_relations_world ON relations(world_id, type);

CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  archetype TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL,
  stances TEXT NOT NULL,
  platform TEXT NOT NULL,
  activity REAL NOT NULL DEFAULT 0.5,
  community_ids TEXT NOT NULL DEFAULT '[]',
  follows TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_personas_world ON personas(world_id);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  persona_id TEXT REFERENCES personas(id),
  tier TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0.5,
  round INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_memories_persona ON memories(world_id, persona_id, tier, round);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  round INTEGER NOT NULL,
  persona_id TEXT NOT NULL REFERENCES personas(id),
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT,
  thread_id TEXT NOT NULL,
  community_id TEXT,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  metrics TEXT NOT NULL,
  mentions TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'generated'
);
CREATE INDEX idx_posts_feed ON posts(world_id, platform, round);
CREATE INDEX idx_posts_persona ON posts(world_id, persona_id);
CREATE INDEX idx_posts_thread ON posts(thread_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  round INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_round ON events(world_id, round, type);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  version INTEGER NOT NULL,
  focus TEXT NOT NULL DEFAULT '',
  narrative TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (world_id, version)
);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  kind TEXT NOT NULL,
  round INTEGER,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted TEXT,
  verdicts TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT
);
CREATE INDEX idx_generations_world ON generations(world_id, kind, status);
`,
  },
  {
    // Post ids become world-scoped (deterministic per world): the PK changes
    // from id to (world_id, id) so two worlds can each hold po_1, po_2, …
    // without colliding. Data is carried over unchanged; the three post
    // indexes are rebuilt with their original names.
    version: 2,
    sql: `
DROP INDEX IF EXISTS idx_posts_feed;
DROP INDEX IF EXISTS idx_posts_persona;
DROP INDEX IF EXISTS idx_posts_thread;
ALTER TABLE posts RENAME TO posts_v1;
CREATE TABLE posts (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  round INTEGER NOT NULL,
  persona_id TEXT NOT NULL REFERENCES personas(id),
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT,
  thread_id TEXT NOT NULL,
  community_id TEXT,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  metrics TEXT NOT NULL,
  mentions TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'generated',
  PRIMARY KEY (world_id, id)
);
INSERT INTO posts (id, world_id, round, persona_id, platform, kind, parent_id, thread_id, community_id, title, body, metrics, mentions, origin)
  SELECT id, world_id, round, persona_id, platform, kind, parent_id, thread_id, community_id, title, body, metrics, mentions, origin FROM posts_v1;
DROP TABLE posts_v1;
CREATE INDEX idx_posts_feed ON posts(world_id, platform, round);
CREATE INDEX idx_posts_persona ON posts(world_id, persona_id);
CREATE INDEX idx_posts_thread ON posts(thread_id);
`,
  },
  {
    // Every row id becomes world-scoped (deterministic per world): the PK changes
    // from id to (world_id, id) for the remaining eight tables so two worlds can
    // each hold e_1, p_1, t_1, … without colliding, and id-derived RNG stream
    // keys stay stable per world. In a fresh single-world database the minted
    // ids are identical to the old global ones, so the golden replay contract
    // is unchanged. Data carries over unchanged; every index is rebuilt under
    // its original name. Cross-table FKs become composite (world_id, id) so
    // they keep enforcing across the new PK. Run with foreign_keys OFF — the
    // table rebuilds re-create parent tables that child tables reference.
    version: 3,
    sql: `
ALTER TABLE seeds RENAME TO seeds_v2;
DROP INDEX IF EXISTS idx_seeds_world_hash;
CREATE TABLE seeds (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  ref TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  digest TEXT NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE (world_id, hash),
  PRIMARY KEY (world_id, id)
);
INSERT INTO seeds (id, world_id, kind, title, ref, hash, bytes, digest, added_at)
  SELECT id, world_id, kind, title, ref, hash, bytes, digest, added_at FROM seeds_v2;
DROP TABLE seeds_v2;

ALTER TABLE entities RENAME TO entities_v2;
DROP INDEX IF EXISTS idx_entities_world_name;
CREATE TABLE entities (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  salience REAL NOT NULL DEFAULT 0.5,
  anchors TEXT NOT NULL DEFAULT '[]',
  motives TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (world_id, id)
);
CREATE UNIQUE INDEX idx_entities_world_name ON entities(world_id, lower(name));
INSERT INTO entities (id, world_id, name, type, description, salience, anchors, motives)
  SELECT id, world_id, name, type, description, salience, anchors, motives FROM entities_v2;
DROP TABLE entities_v2;

ALTER TABLE relations RENAME TO relations_v2;
DROP INDEX IF EXISTS idx_relations_world;
CREATE TABLE relations (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  type TEXT NOT NULL,
  weight REAL NOT NULL,
  tension REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, id),
  FOREIGN KEY (world_id, src_id) REFERENCES entities(world_id, id),
  FOREIGN KEY (world_id, dst_id) REFERENCES entities(world_id, id)
);
CREATE INDEX idx_relations_world ON relations(world_id, type);
INSERT INTO relations (id, world_id, src_id, dst_id, type, weight, tension)
  SELECT id, world_id, src_id, dst_id, type, weight, tension FROM relations_v2;
DROP TABLE relations_v2;

ALTER TABLE personas RENAME TO personas_v2;
DROP INDEX IF EXISTS idx_personas_world;
CREATE TABLE personas (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  archetype TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL,
  stances TEXT NOT NULL,
  platform TEXT NOT NULL,
  activity REAL NOT NULL DEFAULT 0.5,
  community_ids TEXT NOT NULL DEFAULT '[]',
  follows TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY (world_id, id)
);
CREATE INDEX idx_personas_world ON personas(world_id);
INSERT INTO personas (id, world_id, name, handle, archetype, bio, traits, stances, platform, activity, community_ids, follows, created_at)
  SELECT id, world_id, name, handle, archetype, bio, traits, stances, platform, activity, community_ids, follows, created_at FROM personas_v2;
DROP TABLE personas_v2;

ALTER TABLE memories RENAME TO memories_v2;
DROP INDEX IF EXISTS idx_memories_persona;
CREATE TABLE memories (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  persona_id TEXT,
  tier TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0.5,
  round INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (world_id, id),
  FOREIGN KEY (world_id, persona_id) REFERENCES personas(world_id, id)
);
CREATE INDEX idx_memories_persona ON memories(world_id, persona_id, tier, round);
INSERT INTO memories (id, world_id, persona_id, tier, kind, content, salience, round, created_at)
  SELECT id, world_id, persona_id, tier, kind, content, salience, round, created_at FROM memories_v2;
DROP TABLE memories_v2;

ALTER TABLE posts RENAME TO posts_v2;
DROP INDEX IF EXISTS idx_posts_feed;
DROP INDEX IF EXISTS idx_posts_persona;
DROP INDEX IF EXISTS idx_posts_thread;
CREATE TABLE posts (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  round INTEGER NOT NULL,
  persona_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT,
  thread_id TEXT NOT NULL,
  community_id TEXT,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  metrics TEXT NOT NULL,
  mentions TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'generated',
  PRIMARY KEY (world_id, id),
  FOREIGN KEY (world_id, persona_id) REFERENCES personas(world_id, id)
);
CREATE INDEX idx_posts_feed ON posts(world_id, platform, round);
CREATE INDEX idx_posts_persona ON posts(world_id, persona_id);
CREATE INDEX idx_posts_thread ON posts(thread_id);
INSERT INTO posts (id, world_id, round, persona_id, platform, kind, parent_id, thread_id, community_id, title, body, metrics, mentions, origin)
  SELECT id, world_id, round, persona_id, platform, kind, parent_id, thread_id, community_id, title, body, metrics, mentions, origin FROM posts_v2;
DROP TABLE posts_v2;

ALTER TABLE events RENAME TO events_v2;
DROP INDEX IF EXISTS idx_events_round;
CREATE TABLE events (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  round INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL,
  PRIMARY KEY (world_id, id)
);
CREATE INDEX idx_events_round ON events(world_id, round, type);
INSERT INTO events (id, world_id, round, type, payload, scope, created_at)
  SELECT id, world_id, round, type, payload, scope, created_at FROM events_v2;
DROP TABLE events_v2;

ALTER TABLE reports RENAME TO reports_v2;
CREATE TABLE reports (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  version INTEGER NOT NULL,
  focus TEXT NOT NULL DEFAULT '',
  narrative TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (world_id, version),
  PRIMARY KEY (world_id, id)
);
INSERT INTO reports (id, world_id, version, focus, narrative, path, created_at)
  SELECT id, world_id, version, focus, narrative, path, created_at FROM reports_v2;
DROP TABLE reports_v2;

ALTER TABLE generations RENAME TO generations_v2;
DROP INDEX IF EXISTS idx_generations_world;
CREATE TABLE generations (
  id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  kind TEXT NOT NULL,
  round INTEGER,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted TEXT,
  verdicts TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  PRIMARY KEY (world_id, id)
);
CREATE INDEX idx_generations_world ON generations(world_id, kind, status);
INSERT INTO generations (id, world_id, kind, round, task, status, submitted, verdicts, created_at, submitted_at)
  SELECT id, world_id, kind, round, task, status, submitted, verdicts, created_at, submitted_at FROM generations_v2;
DROP TABLE generations_v2;
`,
  },
  {
    // Migration 4: Macro graph population dynamics tables
    version: 4,
    sql: `
CREATE TABLE macro_nodes (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  node_index INTEGER NOT NULL,
  cohort_id TEXT NOT NULL DEFAULT 'default',
  arr REAL NOT NULL DEFAULT 0,
  price_sensitivity REAL NOT NULL DEFAULT 0.5,
  switching_friction REAL NOT NULL DEFAULT 0.5,
  kol_weight REAL NOT NULL DEFAULT 1.0,
  stance REAL NOT NULL DEFAULT 0.0,
  outrage REAL NOT NULL DEFAULT 0.0,
  susceptibility REAL NOT NULL DEFAULT 0.5,
  state INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, node_index)
);
CREATE INDEX idx_macro_nodes_cohort ON macro_nodes(world_id, cohort_id);

CREATE TABLE macro_edges (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  src_index INTEGER NOT NULL,
  dst_index INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (world_id, src_index, dst_index)
) WITHOUT ROWID;

CREATE TABLE macro_snapshots (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  round INTEGER NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  mean_stance REAL NOT NULL,
  outrage_index REAL NOT NULL,
  churn_count INTEGER NOT NULL,
  state_distribution TEXT NOT NULL,
  graph_blob BLOB,
  created_at TEXT NOT NULL,
  PRIMARY KEY (world_id, round)
);
`,
  },
];
