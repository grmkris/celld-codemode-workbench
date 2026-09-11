import { useCallback, useEffect, useState } from "react";
import { ApprovalsCard } from "@/components/approvals-card";
import { ChatPane } from "@/components/chat-pane";
import { ChatsList } from "@/components/chats-list";
import { LoginForm } from "@/components/login-form";
import { NotificationsCard } from "@/components/notifications-card";
import { PromptForm } from "@/components/prompt-form";
import { StatePanels } from "@/components/state-panels";
import { StatusPills } from "@/components/status-pills";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CHAT_STORAGE_KEY, readInitialChatId, useWorkbench } from "@/hooks/useWorkbench";
import { api } from "@/lib/api";
import type { ChatSummary, EventRow, Panel } from "@/lib/types";
import { ChatPreview } from "@/preview/ChatPreview";

export function App() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1") {
    return <ChatPreview />;
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
      .then((list) => {
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
  }, [token, refreshChats, setError, resetChatState]);

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
    <div className="grid min-h-screen lg:grid-cols-[300px_1fr_380px]">
      <aside className="flex flex-col gap-4 border-r border-border p-5">
        <div>
          <h1 className="font-serif text-2xl font-bold">Application agent</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {sessionOwner || ownerId}/{agentId}
          </p>
        </div>
        <StatusPills
          connected={connected}
          live={live}
          provider={provider}
          runStatus={runStatus}
          model={session?.model}
        />
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 pr-2">
            <ChatsList
              chats={chats}
              activeId={agentId}
              busy={busy}
              onSelect={selectChat}
              onCreate={createChat}
            />
            <ApprovalsCard
              approvals={snapshot?.approvals ?? []}
              onDecide={(id, decision) => void decideApproval(id, decision)}
            />
            <NotificationsCard notifications={snapshot?.notifications ?? []} />
          </div>
        </ScrollArea>
        <Button
          variant="outline"
          onClick={() => {
            localStorage.removeItem("celld_token");
            setToken("");
            resetChatState();
            setChats([]);
          }}
        >
          Leave
        </Button>
      </aside>

      <main className="flex min-h-screen min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPane
            messages={snapshot?.messages ?? []}
            runStatus={runStatus}
            runError={String(snapshot?.run?.error ?? "")}
            error={error}
            onPickSuggestion={setText}
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
          onStop={() => void stop()}
        />
      </main>

      <aside className="border-t border-border p-5 lg:border-t-0 lg:border-l">
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
        />
      </aside>
    </div>
  );
}
