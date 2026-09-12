import type { UIMessage } from "@tanstack/ai-client";
import { safeText } from "@/lib/events";
import type { SnapshotMessage } from "@/lib/types";

export function snapshotToUIMessages(messages: SnapshotMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    parts: [{ type: "text", content: safeText(String(message.content ?? "")) }],
  }));
}
