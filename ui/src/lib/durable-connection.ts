import { durableStreamConnection } from "@durable-streams/tanstack-ai-transport";
import type { DurableStreamConnection } from "@durable-streams/tanstack-ai-transport";
import type { UIMessage } from "@tanstack/ai-client";
import { api } from "@/lib/api";

function wireId(): string {
  return crypto.randomUUID();
}

function textFromMessages(messages: UIMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return "";
  if (!("parts" in last) || !Array.isArray(last.parts)) return "";
  let text = "";
  for (const part of last.parts) {
    if (part.type === "text" && "content" in part) {
      text += String(part.content ?? "");
    }
  }
  return text;
}

export type DurableAgentConnectionOptions = {
  agentId: string;
  token: string;
  initialOffset?: string;
};

/**
 * Durable Streams read + Celld /commands send (kind `send` with client ids).
 */
export function createDurableAgentConnection(
  options: DurableAgentConnectionOptions,
): DurableStreamConnection {
  const { agentId, token, initialOffset } = options;
  const base = `/api/agents/${encodeURIComponent(agentId)}`;
  const headers = { Authorization: `Bearer ${token}` };

  const core = durableStreamConnection({
    readUrl: `${base}/stream`,
    sendUrl: `${base}/commands`,
    initialOffset,
    headers,
  });

  return {
    async *subscribe(...args) {
      try {
        yield* core.subscribe(...args);
      } catch {
        // Streams sidecar may be offline; snapshot/long-poll remains authoritative.
        yield* [];
      }
    },
    async send(messages, _data?, signal?) {
      const text = textFromMessages(messages as UIMessage[]).trim();
      if (!text) return;
      const commandId = wireId();
      const messageId = wireId();
      await api(`${base}/commands`, {
        method: "POST",
        token,
        signal,
        body: JSON.stringify({
          commandId,
          kind: "send",
          payload: { text, messageId },
        }),
      });
    },
  };
}
