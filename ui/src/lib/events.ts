import type { EventRow } from "./types";

export function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

export function eventLabel(row: EventRow): string {
  const payload = parsePayload(row.payload);
  switch (row.type) {
    case "run.started":
      return `Run started (${String(payload.adapter ?? "model")})`;
    case "run.completed":
      return "Run finished";
    case "run.queued":
      return "Message queued";
    case "run.cancel_requested":
      return "Stop requested";
    case "run.terminated":
      return "Run stopped";
    case "TOOL_CALL_START":
      return `Code Mode: ${String(payload.toolCallName ?? payload.toolName ?? "tool")}`;
    case "TOOL_CALL_END":
      return "Code Mode finished a call";
    case "TEXT_MESSAGE_CONTENT":
      return "Model text";
    case "approval.proposed":
      return "Approval required before notify";
    case "approval.denied":
      return "Approval denied";
    case "approval.executed":
      return "Notification delivered";
    case "memory.set":
      return `Memory updated: ${String(payload.key ?? "")}`;
    case "tasks.delete":
      return `Deleted task ${String(payload.id ?? "")}`;
    case "workspace.reset":
      return "Application state cleared";
    case "snippets.save":
      return `Saved ${String(payload.name ?? "snippet")} v${String(payload.version ?? "")}`;
    case "snippets.test":
      return `Tested ${String(payload.name ?? "snippet")} (${payload.passed ? "pass" : "fail"})`;
    case "snippets.activate":
      return `Activated ${String(payload.name ?? "snippet")}`;
    case "schedule.fired":
      return "Scheduled snippet ran";
    default:
      return row.type;
  }
}

export function interesting(row: EventRow): boolean {
  return ![
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_END",
    "TOOL_CALL_ARGS",
    "RUN_STARTED",
    "RUN_FINISHED",
  ].includes(row.type);
}

export function safeText(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}
