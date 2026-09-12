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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      },
      { once: true },
    );
  });
}

export type DurableAgentConnectionOptions = {
  agentId: string;
  token: string;
  /** Last acked publisher offset from `/snapshot.streamOffset`. */
  initialOffset?: string | null;
  /** Max consecutive subscribe failures before giving up (default 5). */
  maxAttempts?: number;
};

/**
 * Durable Streams read + Celld /commands send (kind `send` with client ids).
 * History is seeded from SQLite via `initialMessages`; subscribe resumes at
 * `initialOffset` without replaying the whole stream.
 */
export function createDurableAgentConnection(
  options: DurableAgentConnectionOptions,
): DurableStreamConnection {
  const { agentId, token, initialOffset } = options;
  const maxAttempts = options.maxAttempts ?? 5;
  const base = `/api/agents/${encodeURIComponent(agentId)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const offset =
    typeof initialOffset === "string" && initialOffset.length > 0 ? initialOffset : undefined;

  const core = durableStreamConnection({
    readUrl: `${base}/stream`,
    sendUrl: `${base}/commands`,
    initialOffset: offset,
    emitSnapshotOnSubscribe: false,
    headers,
  });

  return {
    async *subscribe(abortSignal?) {
      let attempt = 0;
      for (;;) {
        if (abortSignal?.aborted) return;
        try {
          yield* core.subscribe(abortSignal);
          return;
        } catch (error) {
          if (abortSignal?.aborted) return;
          attempt += 1;
          if (attempt >= maxAttempts) throw error;
          await sleep(Math.min(250 * 2 ** (attempt - 1), 4_000), abortSignal);
        }
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
