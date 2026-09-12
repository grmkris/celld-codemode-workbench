import { useChat } from "@tanstack/ai-react";
import type { ConnectionStatus, UIMessage } from "@tanstack/ai-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acquireConnection, connectionKey, releaseConnection } from "@/lib/connection-registry";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { createDurableAgentConnection } from "@/lib/durable-connection";
import { snapshotToUIMessages } from "@/lib/transcript";
import type { SnapshotMessage } from "@/lib/types";

const idleConnection = {
  async *subscribe() {
    yield* [];
  },
  async send() {
    return;
  },
};

export type AgentChatSnapshotSeed = {
  messages?: SnapshotMessage[];
  streamOffset?: string | null;
};

export function useAgentChat(
  agentId: string,
  token: string,
  conversationKey: string,
  options?: { snapshot?: AgentChatSnapshotSeed | null },
) {
  const streamOffset = options?.snapshot?.streamOffset ?? null;
  const initialMessages = useMemo(
    () => snapshotToUIMessages(options?.snapshot?.messages ?? []),
    // Remount when the agent or seed offset changes; message content updates
    // arrive via the live stream after attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentId, streamOffset],
  );

  const poolKey = connectionKey(agentId, token, streamOffset);
  const connection = useMemo(() => {
    if (!agentId || !token) return idleConnection;
    return acquireConnection(poolKey, () =>
      createDurableAgentConnection({
        agentId,
        token,
        initialOffset: streamOffset,
      }),
    );
  }, [agentId, token, poolKey, streamOffset]);

  useEffect(() => {
    if (!agentId || !token) return undefined;
    return () => {
      releaseConnection(poolKey);
    };
  }, [agentId, token, poolKey]);

  const { messages, sendMessage, status, connectionStatus, isLoading, error, stop } = useChat({
    threadId: conversationKey,
    connection,
    live: Boolean(agentId && token),
    initialMessages: initialMessages as UIMessage[],
  });

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
