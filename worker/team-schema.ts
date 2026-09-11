export const TEAM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  personal_user_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teams_personal_user ON teams(personal_user_id);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
  created_at INTEGER NOT NULL,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  email_hint TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  accepted_by TEXT,
  accepted_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_team ON invitations(team_id);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  principal_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('machine', 'credential', 'action')),
  resource_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_grants_team ON grants(team_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cell_address TEXT NOT NULL,
  activity_revision INTEGER NOT NULL DEFAULT 0,
  last_message TEXT NOT NULL DEFAULT '',
  run_status TEXT NOT NULL DEFAULT 'idle',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_team ON conversations(team_id);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  model TEXT,
  tools_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_team ON agent_profiles(team_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT,
  default_branch TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'draining', 'revoked')),
  labels_json TEXT NOT NULL DEFAULT '{}',
  capacities_json TEXT NOT NULL DEFAULT '{}',
  credential_hash TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_machines_team ON machines(team_id);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('retained', 'disposable', 'host')),
  status TEXT NOT NULL,
  retention_until INTEGER,
  labels_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_environments_team ON environments(team_id);

CREATE TABLE IF NOT EXISTS tasks_index (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_index_team ON tasks_index(team_id);
`;

export const TEAM_SCHEMA_VERSION = 1;
