import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPane } from "@/components/chat-pane";
import { LoginForm } from "@/components/login-form";
import { PromptForm } from "@/components/prompt-form";
import { RunStrip } from "@/components/run-strip";
import { SessionHeader } from "@/components/session-header";
import { SessionRail } from "@/components/session-rail";
import { StatePanels } from "@/components/state-panels";
import { Button } from "@/components/ui/button";
import { CHAT_STORAGE_KEY, readInitialChatId, useWorkbench } from "@/hooks/useWorkbench";
import { api } from "@/lib/api";
import type { ChatSummary, EventRow, Panel } from "@/lib/types";
import { cn } from "@/lib/utils";

const ChatPreview = lazy(() =>
  import("@/preview/ChatPreview").then((mod) => ({ default: mod.ChatPreview })),
);

export function App() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1") {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading preview…</p>}>
        <ChatPreview />
      </Suspense>
    );
  }
  return <Workbench />;
}

function Workbench() {
  const [token, setToken] = useState(localStorage.getItem("celld_token") ?? "");
  const [ownerId, setOwnerId] = useState("operator");
  // Empty until /api/chats confirms an id — avoids snapshot 404 racing DirectoryCell seed.
  const [agentId, setAgentId] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<Panel>("memory");
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );

  const preferredChatId = useMemo(() => readInitialChatId(), []);

  const {
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
    executions,
    openTasks,
    doneTasks,
    activeByName,
    refresh,
    refreshChats: fetchChats,
    resetChatState,
    send,
    stop,
    clearWorkspace,
    decideApproval,
  } = useWorkbench(agentId, token);

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const selectChat = useCallback(
    (id: string) => {
      setAgentId(id);
      localStorage.setItem(CHAT_STORAGE_KEY, id);
      const url = new URL(window.location.href);
      url.searchParams.set("c", id);
      window.history.replaceState({}, "", url);
      resetChatState();
    },
    [resetChatState],
  );

  const refreshChats = useCallback(async () => {
    const list = await fetchChats();
    setChats(list);
    return list;
  }, [fetchChats]);

  useEffect(() => {
    if (!token) return;
    void refreshChats()
      .then(async (list) => {
        if (list.length === 0) {
          setBusy(true);
          try {
            const data = await api<{ chat: ChatSummary }>("/api/chats", {
              method: "POST",
              token,
              body: JSON.stringify({}),
            });
            const next = await refreshChats();
            setChats(next);
            selectChat(data.chat.id);
            setError(null);
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
          return;
        }
        setAgentId((current) => {
          if (current && list.some((chat) => chat.id === current)) return current;
          const preferred =
            preferredChatId && list.some((chat) => chat.id === preferredChatId)
              ? preferredChatId
              : list[0]?.id;
          if (!preferred) return current;
          localStorage.setItem(CHAT_STORAGE_KEY, preferred);
          const url = new URL(window.location.href);
          url.searchParams.set("c", preferred);
          window.history.replaceState({}, "", url);
          if (preferred !== current) resetChatState();
          return preferred;
        });
      })
      .catch((err: Error) => setError(err.message));
  }, [token, refreshChats, preferredChatId, setError, resetChatState, selectChat, setBusy]);

  useEffect(() => {
    if (!token || !agentId || !base) return undefined;
    const cancelled = { current: false };

    const loop = async () => {
      while (!cancelled.current) {
        try {
          const data = await api<{ events: EventRow[]; latestEventId: number }>(
            `${base}/events?after=${cursorRef.current}&wait=1`,
            { token },
          );
          if (cancelled.current) return;
          if (data.events.length) {
            setEvents((current) => {
              const seen = new Set(current.map((row) => row.id));
              const next = [...current];
              for (const row of data.events) {
                if (seen.has(row.id)) continue;
                seen.add(row.id);
                next.push(row);
              }
              return next.slice(-80);
            });
            setCursor(data.latestEventId);
            await refresh();
            await refreshChats().catch(() => undefined);
          }
          setConnected(true);
        } catch {
          if (!cancelled.current) setConnected(false);
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
    };

    void loop();
    return () => {
      cancelled.current = true;
    };
  }, [token, agentId, base, refresh, refreshChats, setConnected, setCursor, setEvents]);

  useEffect(() => {
    if (!token) return undefined;
    const id = window.setInterval(() => {
      void refreshChats().catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [token, refreshChats]);

  // Default inspector tab: Trace while running, State otherwise.
  useEffect(() => {
    if (runStatus === "running" || runStatus === "queued") {
      setPanel("trace");
    }
  }, [runStatus]);

  const createChat = () => {
    setError(null);
    setBusy(true);
    void api<{ chat: ChatSummary }>("/api/chats", {
      method: "POST",
      token,
      body: JSON.stringify({}),
    })
      .then(async (data) => {
        await refreshChats();
        selectChat(data.chat.id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const activeChat = chats.find((chat) => chat.id === agentId);
  const sessionTitle = activeChat?.title || agentId.slice(0, 12) || "Chat";

  if (!token) {
    return (
      <LoginForm
        connected={connected}
        health={health}
        error={error}
        onError={setError}
        onToken={(nextToken, nextOwner) => {
          setToken(nextToken);
          setOwnerId(nextOwner);
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-[var(--bench)]">
      <SessionRail
        chats={chats}
        activeId={agentId}
        busy={busy}
        approvalCount={snapshot?.approvals?.length ?? 0}
        onSelect={selectChat}
        onCreate={createChat}
        onLeave={() => {
          localStorage.removeItem("celld_token");
          setToken("");
          resetChatState();
          setChats([]);
        }}
      />

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SessionHeader
          title={sessionTitle}
          ownerId={sessionOwner || ownerId}
          agentId={agentId}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
        />
        <RunStrip
          runStatus={runStatus}
          live={live}
          provider={provider}
          model={session?.model}
          connected={connected}
          onStop={() => void stop()}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatPane
            messages={snapshot?.messages ?? []}
            approvals={snapshot?.approvals ?? []}
            runStatus={runStatus}
            runError={String(snapshot?.run?.error ?? "")}
            error={error}
            onPickSuggestion={setText}
            onDecide={(id, decision) => void decideApproval(id, decision)}
          />
        </div>
        <PromptForm
          value={text}
          busy={busy}
          live={live}
          provider={provider}
          onChange={setText}
          onSend={() => {
            const next = text;
            setText("");
            void send(next).then((ok) => {
              if (!ok) setText(next);
              else void refreshChats().catch(() => undefined);
            });
          }}
        />
      </main>

      {/* Inspector drawer — overlay below lg */}
      {inspectorOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setInspectorOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={cn(
          "flex min-h-0 shrink-0 flex-col border-l border-border bg-[var(--raised)] transition-[width,transform]",
          "fixed inset-y-0 right-0 z-50 w-[min(100vw,22rem)] lg:static lg:z-auto",
          inspectorOpen
            ? "translate-x-0 lg:w-[22rem]"
            : "pointer-events-none translate-x-full lg:pointer-events-none lg:w-0 lg:translate-x-0 lg:border-0 lg:overflow-hidden",
        )}
        aria-hidden={!inspectorOpen}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden p-4",
            !inspectorOpen && "lg:hidden",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
            <span className="text-sm font-medium">Inspector</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close inspector"
            >
              Close
            </Button>
          </div>
          <StatePanels
            snapshot={snapshot}
            events={events}
            executions={executions}
            openTasks={openTasks}
            doneTasks={doneTasks}
            activeByName={activeByName}
            panel={panel}
            onPanel={setPanel}
            base={base}
            token={token}
            onRefresh={() => void refresh()}
            onClearWorkspace={() => void clearWorkspace()}
            notifications={snapshot?.notifications ?? []}
          />
        </div>
      </aside>
    </div>
  );
}
