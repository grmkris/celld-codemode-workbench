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

export function useWorkbench(agentId: string, token: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cursor, setCursor] = useState(0);
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
    setEvents([]);
    setCursor(0);
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
    setCursor(data.latestEventId);
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
        setCursor(data.latestEventId);
        setConnected(true);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
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

  const send = useCallback(
    async (text: string) => {
      if (!agentId || !base) {
        setError("No chat selected");
        return false;
      }
      setError(null);
      setBusy(true);
      try {
        await api(`${base}/chat`, { method: "POST", token, body: JSON.stringify({ text }) });
        await refresh();
        await refreshChats().catch(() => undefined);
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [agentId, base, token, refresh, refreshChats],
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
    setEvents,
    cursor,
    setCursor,
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
    send,
    stop,
    clearWorkspace,
    decideApproval,
  };
}
