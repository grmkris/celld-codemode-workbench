export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  preferences TEXT NOT NULL DEFAULT '{}',
  granted_capabilities TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL,
  user_text TEXT,
  model_used INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS run_queue (
  id TEXT PRIMARY KEY,
  user_text TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  principal TEXT NOT NULL,
  command_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  outcome_json TEXT,
  message_id TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(principal, command_id)
);

CREATE TABLE IF NOT EXISTS message_parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  step INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS snippet_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  required_capabilities TEXT NOT NULL,
  dependency_versions TEXT NOT NULL,
  test_results TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS snippet_activation (
  name TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  snippet_name TEXT NOT NULL,
  snippet_version_id TEXT NOT NULL,
  input TEXT NOT NULL,
  timezone TEXT NOT NULL,
  recur_seconds INTEGER,
  next_due_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  pinned_capabilities TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_occurrences (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  result TEXT,
  UNIQUE(schedule_id, due_at)
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  run_id TEXT,
  execution_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  args_json TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  snippet_version_id TEXT,
  status TEXT NOT NULL,
  expiry INTEGER NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  run_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  published_offset TEXT,
  acked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publisher (
  key TEXT PRIMARY KEY,
  producer_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  last_acked_offset TEXT
);

CREATE TABLE IF NOT EXISTS inbox (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at INTEGER,
  created_at INTEGER NOT NULL
);
`;

export const SCHEMA_VERSION = 4;
