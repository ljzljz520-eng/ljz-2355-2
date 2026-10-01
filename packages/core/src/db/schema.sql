PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS components (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS component_versions (
  id            INTEGER PRIMARY KEY,
  package_name  TEXT NOT NULL,
  version       TEXT NOT NULL,
  "commit"      TEXT NOT NULL,
  tree_hash     TEXT NOT NULL,
  branch        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('complete','partial','blocked')),
  contract_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (package_name, version)
);

-- Immutability: a version always maps to exactly one git commit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_commit
  ON component_versions(package_name, version, "commit");

CREATE TABLE IF NOT EXISTS test_runs (
  id           INTEGER PRIMARY KEY,
  version_id   INTEGER NOT NULL REFERENCES component_versions(id),
  build_id     TEXT NOT NULL,
  slug         TEXT NOT NULL,
  component    TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','passed','failed')),
  failure_kind TEXT,
  failure_msg  TEXT,
  a11y_json    TEXT,
  duration_ms  INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id           INTEGER PRIMARY KEY,
  version_id   INTEGER NOT NULL REFERENCES component_versions(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  path         TEXT NOT NULL,
  required     INTEGER NOT NULL DEFAULT 1,
  uploaded     INTEGER NOT NULL DEFAULT 0,
  upload_error TEXT,
  bytes        INTEGER,
  content_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (version_id, name)
);

-- Publication lineage: which release(s) document which component version.
CREATE TABLE IF NOT EXISTS release_links (
  id                INTEGER PRIMARY KEY,
  source_version_id INTEGER NOT NULL REFERENCES component_versions(id),
  target_version_id INTEGER NOT NULL REFERENCES component_versions(id),
  relation          TEXT NOT NULL CHECK (relation IN ('predecessor-of','successor-of','migrates-to')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_version_id, target_version_id, relation)
);

CREATE TABLE IF NOT EXISTS breaking_changes (
  id              INTEGER PRIMARY KEY,
  version_id      INTEGER NOT NULL REFERENCES component_versions(id),
  change_key      TEXT NOT NULL,
  kind            TEXT NOT NULL,
  component       TEXT NOT NULL,
  path            TEXT NOT NULL,
  migration_json  TEXT,
  reverify_passed INTEGER,
  reverify_error  TEXT,
  UNIQUE (version_id, change_key)
);
