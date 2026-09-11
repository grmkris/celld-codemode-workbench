export const TASK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'assigned', 'running', 'succeeded', 'failed', 'cancelled')),
  cancellation_state TEXT NOT NULL DEFAULT 'none'
    CHECK(cancellation_state IN ('none', 'requested', 'signalled', 'escalated', 'confirmed')),
  workspace_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_key);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  lease_token_hash TEXT,
  lease_expires_at INTEGER,
  machine_id TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, generation)
);

CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id);

CREATE TABLE IF NOT EXISTS attempt_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(attempt_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_attempt_events_attempt ON attempt_events(attempt_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('uploading', 'pending_approval', 'approved', 'rejected')),
  content_hash TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  approved_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_attempt ON artifacts(attempt_id);

CREATE TABLE IF NOT EXISTS artifact_chunks (
  artifact_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(artifact_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leases_attempt ON leases(attempt_id);
`;

export const TASK_SCHEMA_VERSION = 1;
