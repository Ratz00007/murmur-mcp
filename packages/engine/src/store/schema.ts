/** SQLite schema — exactly the ten tables from the PRD data model, plus a migrations meta table. */

export const SCHEMA_VERSION = 2;

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
];
