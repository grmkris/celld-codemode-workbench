import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { ChatPane } from "@/components/chat-pane";
import { LoginForm } from "@/components/login-form";
import { PromptForm } from "@/components/prompt-form";
import { RunStrip } from "@/components/run-strip";
import { SessionHeader } from "@/components/session-header";
import { SessionRail } from "@/components/session-rail";
import { StatePanels } from "@/components/state-panels";
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
  const [agentId, setAgentId] = useState(readInitialChatId);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [text, setText] = useState(
    "Remember that this project's priority is reliability. Create three maintenance tasks.",
  );
  const [panel, setPanel] = useState<Panel>("memory");
  const [inspectorOpen, setInspectorOpen] = useState(true);

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
          if (list.some((chat) => chat.id === current)) return current;
          const next = list[0]?.id;
          if (!next) return current;
          localStorage.setItem(CHAT_STORAGE_KEY, next);
          const url = new URL(window.location.href);
          url.searchParams.set("c", next);
          window.history.replaceState({}, "", url);
          resetChatState();
          return next;
        });
      })
      .catch((err: Error) => setError(err.message));
  }, [token, refreshChats, setError, resetChatState, selectChat, setBusy]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api<{ events: EventRow[]; latestEventId: number }>(
          `${base}/events?after=${cursor}&wait=1`,
          { token },
        );
        if (cancelled) return;
        if (data.events.length) {
          setEvents((current) => [...current, ...data.events].slice(-80));
          setCursor(data.latestEventId);
          await refresh();
          await refreshChats().catch(() => undefined);
        }
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, base, cursor, refresh, refreshChats, setConnected, setCursor, setEvents]);

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
    <div className="flex min-h-screen bg-[var(--bench)]">
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

      <main className="relative flex min-w-0 flex-1 flex-col">
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
        <div className="flex min-h-0 flex-1 flex-col">
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
            void send(next).then(() => refreshChats().catch(() => undefined));
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
          "flex shrink-0 flex-col border-l border-border bg-[var(--raised)] transition-[width,transform]",
          "fixed inset-y-0 right-0 z-50 w-[min(100vw,22rem)] lg:static lg:z-auto",
          inspectorOpen
            ? "translate-x-0 lg:w-[22rem]"
            : "pointer-events-none translate-x-full lg:pointer-events-none lg:w-0 lg:translate-x-0 lg:border-0 lg:overflow-hidden",
        )}
        aria-hidden={!inspectorOpen}
      >
        <div className={cn("flex min-h-0 flex-1 flex-col p-4", !inspectorOpen && "lg:hidden")}>
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
