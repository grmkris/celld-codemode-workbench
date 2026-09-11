export const COMMAND_KINDS = [
  "send",
  "stop",
  "approve",
  "deny",
  "resume_queue",
  "remove_queued",
  "rename",
  "archive",
] as const;

export type CommandKind = (typeof COMMAND_KINDS)[number];

export interface CommandEnvelope {
  commandId: string;
  kind: CommandKind;
  payload?: Record<string, unknown>;
  expectedRunId?: string;
  expectedGeneration?: number;
}

export interface CommandRow {
  principal: string;
  command_id: string;
  kind: string;
  payload_hash: string;
  payload: string;
  outcome_json: string | null;
  message_id: string | null;
  run_id: string | null;
  created_at: number;
}

export interface CommandDedupResult {
  replay: boolean;
  outcome: unknown;
}

export interface StopFenceInput {
  activeRunId: string | null;
  activeGeneration: number | null;
  expectedRunId?: string;
  expectedGeneration?: number;
}

export interface StopFenceResult {
  allowed: boolean;
  stale: boolean;
  reason?: string;
}
