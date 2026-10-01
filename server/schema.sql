PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Versions are pinned to an IMMUTABLE commit sha. A branch update can never
-- alter what an existing published version documents.
CREATE TABLE IF NOT EXISTS component_versions (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  version TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  branch TEXT,
  released_at TEXT,
  UNIQUE(component_id, version)
);

CREATE TABLE IF NOT EXISTS builds (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  version_id INTEGER NOT NULL REFERENCES component_versions(id),
  commit_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','passed','rejected')),
  contract_sha256 TEXT,
  gates TEXT,                       -- JSON gate results
  warnings TEXT,                   -- JSON unresolved manual-evidence items
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_props (
  id INTEGER PRIMARY KEY,
  build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  component_version_id INTEGER NOT NULL REFERENCES component_versions(id),
  name TEXT NOT NULL,
  data TEXT NOT NULL                -- JSON: type,required,default,description,inferred,deprecated,since,renamedFrom
);
CREATE TABLE IF NOT EXISTS contract_events (
  id INTEGER PRIMARY KEY, build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  component_version_id INTEGER NOT NULL REFERENCES component_versions(id),
  name TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contract_slots (
  id INTEGER PRIMARY KEY, build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  component_version_id INTEGER NOT NULL REFERENCES component_versions(id),
  name TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contract_types (
  id INTEGER PRIMARY KEY, build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  component_version_id INTEGER NOT NULL REFERENCES component_versions(id),
  name TEXT NOT NULL, data TEXT NOT NULL
);

-- Example test artifacts, one row per example run, tied to the build whose
-- contract generated the doc page (same-build consistency).
CREATE TABLE IF NOT EXISTS test_runs (
  id INTEGER PRIMARY KEY,
  build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  example TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pass','fail','timeout','a11y-fail','skipped')),
  html TEXT,
  events TEXT,                      -- JSON
  violations TEXT,                  -- JSON
  error TEXT,
  duration_ms INTEGER,
  uploaded INTEGER NOT NULL DEFAULT 0   -- set only when the preview bundle actually lands
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY,
  build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,               -- contract|preview|report|install
  name TEXT NOT NULL,
  sha256 TEXT,
  bytes INTEGER,
  uploaded INTEGER NOT NULL DEFAULT 0,
  upload_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Release graph: a released version supersedes another (发布关系).
CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  version_id INTEGER NOT NULL REFERENCES component_versions(id),
  channel TEXT NOT NULL DEFAULT 'latest',
  supersedes_version_id INTEGER REFERENCES component_versions(id),
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(component_id, version_id)
);

CREATE TABLE IF NOT EXISTS breaking_changes (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  change_id TEXT NOT NULL UNIQUE,  -- e.g. button.type->variant
  kind TEXT NOT NULL,              -- rename|removal|type-change
  introduced_version TEXT NOT NULL,
  migration_doc TEXT,              -- path/sha of the migration note
  UNIQUE(change_id, introduced_version)
);

CREATE TABLE IF NOT EXISTS migration_notes (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  version TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(component_id, version)
);

CREATE TABLE IF NOT EXISTS retest_cases (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  version TEXT NOT NULL,
  case_id TEXT NOT NULL,
  data TEXT NOT NULL,              -- JSON must[] assertions
  passed INTEGER NOT NULL DEFAULT 0
);

-- Deprecation is declared against REAL versions only; range is [since,removedIn).
CREATE TABLE IF NOT EXISTS deprecations (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id),
  subject_type TEXT NOT NULL,      -- prop|event|slot
  subject_name TEXT NOT NULL,
  since_version TEXT NOT NULL,
  removed_in_version TEXT,         -- null while still supported; backfilled when the removing release is registered
  note TEXT,
  UNIQUE(component_id, subject_type, subject_name, since_version)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
