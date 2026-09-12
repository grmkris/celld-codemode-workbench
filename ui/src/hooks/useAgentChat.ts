import { useChat } from "@tanstack/ai-react";
import type { ConnectionStatus } from "@tanstack/ai-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acquireConnection, releaseConnection } from "@/lib/connection-registry";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { createDurableAgentConnection } from "@/lib/durable-connection";

const idleConnection = {
  async *subscribe() {
    yield* [];
  },
  async send() {
    return;
  },
};

export function useAgentChat(
  agentId: string,
  token: string,
  conversationKey: string,
  options?: { live?: boolean },
) {
  const live = options?.live ?? true;
  const connection = useMemo(() => {
    if (!agentId || !token) return idleConnection;
    return acquireConnection(conversationKey, () =>
      createDurableAgentConnection({ agentId, token }),
    );
  }, [agentId, token, conversationKey]);

  useEffect(() => {
    if (!agentId || !token) return undefined;
    return () => {
      releaseConnection(conversationKey);
    };
  }, [agentId, token, conversationKey]);

  const { messages, sendMessage, status, connectionStatus, isLoading, error, stop } = useChat({
    threadId: conversationKey,
    connection,
    // Snapshot/long-poll remains authoritative when streams are down.
    live: live && Boolean(agentId && token),
  } as unknown as Parameters<typeof useChat>[0]);

  const draftRef = useRef(readDraft(conversationKey));
  const [draft, setDraftState] = useState(() => readDraft(conversationKey));

  useEffect(() => {
    const saved = readDraft(conversationKey);
    draftRef.current = saved;
    setDraftState(saved);
  }, [conversationKey]);

  const setDraft = useCallback(
    (next: string) => {
      draftRef.current = next;
      setDraftState(next);
      writeDraft(conversationKey, next);
    },
    [conversationKey],
  );

  const sendDraft = useCallback(async () => {
    const text = draftRef.current.trim();
    if (!text || isLoading || !agentId) return false;
    setDraft("");
    clearDraft(conversationKey);
    try {
      await sendMessage(text);
      return true;
    } catch {
      setDraft(text);
      return false;
    }
  }, [agentId, conversationKey, isLoading, sendMessage, setDraft]);

  return {
    messages,
    sendMessage,
    sendDraft,
    draft,
    setDraft,
    status,
    connectionStatus: connectionStatus as ConnectionStatus,
    isLoading,
    error,
    stop,
  };
}
