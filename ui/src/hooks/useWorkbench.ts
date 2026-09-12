import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ChatSummary, EventRow, HealthInfo, SessionInfo, Snapshot } from "@/lib/types";

export const CHAT_STORAGE_KEY = "celld_chat_id";

/** Preferred chat id from URL or localStorage. Empty until the directory confirms it. */
export function readInitialChatId(): string {
  if (typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("c");
  if (fromQuery && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(fromQuery)) return fromQuery;
  return localStorage.getItem(CHAT_STORAGE_KEY) ?? "";
}

function partsToEvents(snapshot: Snapshot | null): EventRow[] {
  const parts = snapshot?.messageParts ?? [];
  return parts.map((part, index) => ({
    id: index + 1,
    type: String(part.kind),
    payload: typeof part.payload === "string" ? part.payload : JSON.stringify(part.payload ?? {}),
  }));
}

export function useWorkbench(agentId: string, token: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const base = agentId ? `/api/agents/${agentId}` : "";
  const runStatus = String(snapshot?.run?.status ?? "idle");
  const live = Boolean(session?.live ?? health?.live);
  const provider = session?.provider ?? health?.provider ?? "fixture";
  const sessionOwner = session?.ownerId ?? "";

  const resetChatState = useCallback(() => {
    setSnapshot(null);
    setError(null);
  }, []);

  const refreshChats = useCallback(async () => {
    const data = await api<{ chats: ChatSummary[] }>("/api/chats", { token });
    return data.chats;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!agentId || !base) return;
    const data = await api<Snapshot>(`${base}/snapshot`, { token });
    setSnapshot(data);
    setConnected(true);
    setError(null);
  }, [agentId, base, token]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const data = await api<HealthInfo>("/health");
        if (!cancelled) {
          setHealth(data);
          setConnected(true);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    void ping();
    const id = window.setInterval(() => void ping(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void api<SessionInfo>("/api/session", { token })
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Snapshot only after a real chat id is selected. Cancel so a late 404 cannot stick.
  useEffect(() => {
    if (!token || !agentId || !base) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<Snapshot>(`${base}/snapshot`, { token });
        if (cancelled) return;
        setSnapshot(data);
        setConnected(true);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, agentId, base]);

  const activeByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of snapshot?.activations ?? []) {
      map.set(String(row.name), String(row.version_id));
    }
    return map;
  }, [snapshot]);

  const events = useMemo(() => {
    if (snapshot?.events?.length) return snapshot.events;
    return partsToEvents(snapshot);
  }, [snapshot]);

  const executions = useMemo(
    () =>
      events.filter((row) =>
        ["TOOL_CALL_START", "run.completed", "approval.proposed", "approval.executed"].includes(
          row.type,
        ),
      ),
    [events],
  );

  const openTasks = useMemo(
    () => (snapshot?.tasks ?? []).filter((item) => item.status !== "done"),
    [snapshot],
  );
  const doneTasks = useMemo(
    () => (snapshot?.tasks ?? []).filter((item) => item.status === "done"),
    [snapshot],
  );

  const stop = useCallback(async () => {
    if (!agentId || !base) return;
    await api(`${base}/stop`, { method: "POST", token });
    await refresh();
  }, [agentId, base, token, refresh]);

  const clearWorkspace = useCallback(async () => {
    if (!agentId || !base) return;
    if (
      !window.confirm(
        "Delete all memory and tasks, deactivate snippets, and cancel schedules? Chat history stays.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api(`${base}/reset`, {
        method: "POST",
        token,
        body: JSON.stringify({ confirm: true }),
      });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [agentId, base, token, refresh]);

  const decideApproval = useCallback(
    async (id: string, decision: "approve" | "deny") => {
      if (!agentId || !base) return;
      await api(`${base}/approvals`, {
        method: "POST",
        token,
        body: JSON.stringify({ id, decision }),
      });
      await refresh();
    },
    [agentId, base, token, refresh],
  );

  return {
    snapshot,
    events,
    error,
    setError,
    connected,
    setConnected,
    health,
    session,
    busy,
    setBusy,
    base,
    runStatus,
    live,
    provider,
    sessionOwner,
    activeByName,
    executions,
    openTasks,
    doneTasks,
    refresh,
    refreshChats,
    resetChatState,
    stop,
    clearWorkspace,
    decideApproval,
  };
}
