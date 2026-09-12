import type { UIMessage } from "@tanstack/ai-client";
import type { SnapshotMessage } from "@/lib/types";

export function snapshotToUIMessages(messages: SnapshotMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    parts: [{ type: "text", content: message.content }],
  }));
}

/** Prefer live stream transcript; fall back to snapshot when stream is empty or behind. */
export function mergeTranscript(
  streamMessages: UIMessage[],
  snapshotMessages: SnapshotMessage[],
): UIMessage[] {
  const snapshot = snapshotToUIMessages(snapshotMessages);
  if (streamMessages.length === 0) return snapshot;
  if (snapshot.length > streamMessages.length) return snapshot;
  return streamMessages;
}
