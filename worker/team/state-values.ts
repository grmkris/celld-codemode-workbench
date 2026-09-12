import type {
  ConversationSummary,
  DelegatedTaskRecord,
  MachineRecord,
  TeamRecord,
} from "../../shared/state-schema";

export function stateTeamValue(
  row: {
    id: string;
    name: string;
    personal_user_id: string | null;
    created_at: number;
    updated_at: number;
  },
  role?: string,
): TeamRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    role,
    personal: Boolean(row.personal_user_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function stateConversationValue(row: {
  id: string;
  team_id: string;
  title: string;
  cell_address: string;
  activity_revision: number;
  last_message: string;
  run_status: string;
  archived: number;
  created_at: number;
  updated_at: number;
}): ConversationSummary {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    title: String(row.title),
    cellAddress: String(row.cell_address),
    activityRevision: Number(row.activity_revision),
    lastMessage: String(row.last_message ?? ""),
    runStatus: String(row.run_status ?? "idle"),
    archived: Boolean(Number(row.archived)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function stateMachineValue(row: {
  id: string;
  team_id: string;
  name: string;
  status: string;
  labels_json: string | null;
  last_seen_at: number | null;
  created_at: number;
}): MachineRecord {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    name: String(row.name),
    status: row.status as MachineRecord["status"],
    labelsJson: row.labels_json ? String(row.labels_json) : undefined,
    lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
    createdAt: Number(row.created_at),
  };
}

export function stateDelegatedTaskValue(row: {
  id: string;
  team_id: string;
  conversation_id: string;
  status: string;
  payload_json: string | null;
  updated_at: number;
}): DelegatedTaskRecord {
  let title = String(row.id);
  try {
    const payload = JSON.parse(String(row.payload_json ?? "{}")) as { title?: string };
    if (payload.title) title = String(payload.title);
  } catch {
    // ignore
  }
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    conversationId: String(row.conversation_id),
    status: String(row.status),
    title,
    updatedAt: Number(row.updated_at),
  };
}
