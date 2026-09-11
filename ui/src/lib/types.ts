export interface SnapshotMessage {
  id: string;
  role: string;
  content: string;
  seq: number;
}

export interface Snapshot {
  agent: Record<string, unknown> | null;
  archived?: boolean;
  run: Record<string, unknown> | null;
  messages: SnapshotMessage[];
  memory: Array<{ key: string; value: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  snippets: Array<{
    id: string;
    name: string;
    version: number;
    source: string;
    description?: string;
    test_results: string | null;
  }>;
  activations: Array<{ name: string; version_id: string }>;
  schedules: Array<{ id: string; name: string; status: string; next_due_at: number }>;
  occurrences: Array<{ id: string; status: string; due_at: number }>;
  approvals: Array<{ id: string; capability: string; args_json: string; status: string }>;
  notifications: Array<{ id: string; message: string }>;
  latestEventId: number;
}

export interface EventRow {
  id: number;
  type: string;
  payload: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  lastMessage: string;
  lastSeq: number;
  runStatus: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionInfo {
  ownerId: string;
  provider?: string;
  model?: string;
  live?: boolean;
}

export interface HealthInfo {
  ok: boolean;
  provider?: string;
  model?: string;
  live?: boolean;
}

export type Panel = "memory" | "snippets" | "schedules" | "trace";
