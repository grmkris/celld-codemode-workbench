import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InvitePage } from "@/components/auth/invite-page";
import { EmailAuthForm } from "@/components/auth/email-auth-form";
import { ArtifactReviewStub } from "@/components/artifact-review-stub";
import { ChatTranscript } from "@/components/chat-transcript";
import { LoginForm } from "@/components/login-form";
import { MachinesPanel } from "@/components/machines-panel";
import { PromptForm } from "@/components/prompt-form";
import { derivePlatformStatus, RunStrip } from "@/components/run-strip";
import { SessionHeader } from "@/components/session-header";
import { SessionRail } from "@/components/session-rail";
import { StatePanels } from "@/components/state-panels";
import { TeamMembersPanel } from "@/components/team-members-panel";
import { TeamRail } from "@/components/team-rail";
import { Button } from "@/components/ui/button";
import { useAgentChat } from "@/hooks/useAgentChat";
import { useRoute } from "@/hooks/useRoute";
import { useTeamState } from "@/hooks/useTeamState";
import { CHAT_STORAGE_KEY, readInitialChatId, useWorkbench } from "@/hooks/useWorkbench";
import { resolveAgentId } from "@/lib/agent-id";
import { detectAuthMode, type AuthMode } from "@/lib/auth-client";
import { api } from "@/lib/api";
import type { AppRoute } from "@/lib/router";
import type { ChatSummary, EventRow, HealthInfo, Panel } from "@/lib/types";
import { mergeTranscript } from "@/lib/transcript";
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
  return <RouterApp />;
}

function RouterApp() {
  const [route, navigate] = useRoute();
  const [token, setToken] = useState(localStorage.getItem("celld_token") ?? "");
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [healthConnected, setHealthConnected] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    void detectAuthMode().then(setAuthMode);
    void api<HealthInfo>("/health")
      .then((data) => {
        setHealth(data);
        setHealthConnected(true);
      })
      .catch(() => setHealthConnected(false));
  }, []);

  const leave = useCallback(() => {
    localStorage.removeItem("celld_token");
    setToken("");
    navigate({ name: authMode === "fixture" ? "legacy-workbench" : "login" }, true);
  }, [authMode, navigate]);

  if (route.name === "invite") {
    return (
      <InvitePage
        token={route.token}
        authMode={authMode ?? "email"}
        health={health}
        connected={healthConnected}
        onAuthed={(next) => {
          setToken(next);
          navigate({ name: "legacy-workbench" }, true);
        }}
      />
    );
  }

  if (!token) {
    if (route.name === "signup") {
      return (
        <AuthShell connected={healthConnected} health={health} title="Create account">
          <EmailAuthForm
            mode="signup"
            onToken={(next) => {
              setToken(next);
              navigate({ name: "legacy-workbench" }, true);
            }}
            onSwitchMode={() => navigate({ name: "login" })}
          />
        </AuthShell>
      );
    }
    if (route.name === "login" && authMode === "email") {
      return (
        <AuthShell connected={healthConnected} health={health} title="Application agent">
          <EmailAuthForm
            mode="login"
            onToken={(next) => {
              setToken(next);
              navigate({ name: "legacy-workbench" }, true);
            }}
            onSwitchMode={() => navigate({ name: "signup" })}
          />
        </AuthShell>
      );
    }
    return (
      <LoginForm
        connected={healthConnected}
        health={health}
        error={null}
        onError={() => undefined}
        onToken={(nextToken) => {
          setToken(nextToken);
          navigate({ name: "legacy-workbench" }, true);
        }}
      />
    );
  }

  if (route.name === "team-machines") {
    return (
      <TeamMachinesPage token={token} teamId={route.teamId} onLeave={leave} navigate={navigate} />
    );
  }

  if (route.name === "team-task") {
    return (
      <div className="min-h-dvh bg-[var(--bench)]">
        <ArtifactReviewStub taskId={route.taskId} teamId={route.teamId} />
      </div>
    );
  }

  if (route.name === "team-chat") {
    return (
      <TeamWorkbench
        token={token}
        teamId={route.teamId}
        conversationId={route.conversationId}
        navigate={navigate}
        onLeave={leave}
      />
    );
  }

  return (
    <LegacyWorkbench
      token={token}
      preferredChatId={
        route.name === "legacy-workbench"
          ? (route.conversationId ?? readInitialChatId())
          : readInitialChatId()
      }
      navigate={navigate}
      onLeave={leave}
    />
  );
}

function AuthShell({
  title,
  connected,
  health,
  children,
}: {
  title: string;
  connected: boolean;
  health: HealthInfo | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bench)] p-6">
      <div className="w-full max-w-md">
        <h1 className="text-[1.75rem] leading-8 font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Team-scoped Celld workbench with durable chat streams.
        </p>
        <p className="machine mt-3 text-muted-foreground">
          {connected ? "Celld reachable" : "Waiting for Celld"}
          {" — "}
          {health?.live ? "live model" : "fixture model"}
          {health?.provider ? ` ${health.provider}` : ""}
        </p>
        {children}
      </div>
    </div>
  );
}

function TeamMachinesPage({
  token,
  teamId,
  onLeave,
  navigate,
}: {
  token: string;
  teamId: string;
  onLeave: () => void;
  navigate: (route: AppRoute, replace?: boolean) => void;
}) {
  const { machines, teams } = useTeamState(token, teamId);
  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-[var(--bench)]">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <h1 className="text-sm font-medium">Machines</h1>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigate({ name: "team-chat", teamId, conversationId: "new" }, true)}
          >
            Back
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onLeave}>
            Leave
          </Button>
        </div>
      </header>
      <main className="overflow-auto p-5">
        <MachinesPanel machines={machines} />
        <p className="machine mt-4 text-muted-foreground">{teams[0]?.name}</p>
      </main>
    </div>
  );
}

function TeamWorkbench({
  token,
  teamId,
  conversationId,
  navigate,
  onLeave,
}: {
  token: string;
  teamId: string;
  conversationId: string;
  navigate: (route: AppRoute, replace?: boolean) => void;
  onLeave: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("memory");
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );

  const teamState = useTeamState(token, teamId, conversationId);
  const activeConversation = teamState.conversations.find((row) => row.id === conversationId);
  const agentId = activeConversation ? resolveAgentId(activeConversation) : conversationId;

  const workbench = useWorkbench(agentId, token);
  const chat = useAgentChat(agentId, token, conversationId);

  useEffect(() => {
    if (!token) return;
    void api("/api/teams/bootstrap-personal", { method: "POST", token }).catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token || !teamId || busy) return;
    const known = teamState.conversations.some((row) => row.id === conversationId);
    if (known) return;
    if (teamState.conversations.length > 0) {
      navigate({ name: "team-chat", teamId, conversationId: teamState.conversations[0].id }, true);
      return;
    }
    setBusy(true);
    void api<{ conversation: { id: string } }>(
      `/api/teams/${encodeURIComponent(teamId)}/conversations`,
      { method: "POST", token, body: JSON.stringify({}) },
    )
      .then((data) => {
        navigate({ name: "team-chat", teamId, conversationId: data.conversation.id }, true);
      })
      .finally(() => setBusy(false));
  }, [busy, conversationId, navigate, teamId, teamState.conversations, token]);

  const platformStatus = derivePlatformStatus({
    runStatus: String(workbench.snapshot?.run?.status ?? "idle"),
    connectionStatus: chat.connectionStatus,
    chatStatus: chat.status,
    syncing: teamState.syncing,
    pendingApprovals: teamState.approvals.filter((row) => row.status === "pending").length,
  });

  const snapshotApprovals =
    workbench.snapshot?.approvals ??
    teamState.approvals.map((row) => ({
      id: row.id,
      capability: row.capability,
      args_json: row.argsJson,
      status: row.status,
    }));

  return (
    <WorkbenchShell
      rail={
        <TeamRail
          teams={teamState.teams}
          teamId={teamId}
          conversations={teamState.conversations}
          activeConversationId={conversationId}
          busy={busy || chat.isLoading}
          approvalCount={snapshotApprovals.filter((row) => row.status === "pending").length}
          onTeamSelect={(nextTeamId) => {
            const first = teamState.conversations[0];
            navigate({
              name: "team-chat",
              teamId: nextTeamId,
              conversationId: first?.id ?? "new",
            });
          }}
          onSelect={(id) => navigate({ name: "team-chat", teamId, conversationId: id })}
          onCreate={() => {
            setBusy(true);
            void api<{ conversation: { id: string } }>(
              `/api/teams/${encodeURIComponent(teamId)}/conversations`,
              { method: "POST", token, body: JSON.stringify({}) },
            )
              .then((data) =>
                navigate({ name: "team-chat", teamId, conversationId: data.conversation.id }),
              )
              .finally(() => setBusy(false));
          }}
          onMachines={() => navigate({ name: "team-machines", teamId })}
          onMembers={() => setMembersOpen((open) => !open)}
          onLeave={onLeave}
          membersOpen={membersOpen}
        />
      }
      headerTitle={activeConversation?.title ?? conversationId.slice(0, 12)}
      ownerId={workbench.sessionOwner}
      agentId={agentId}
      inspectorOpen={inspectorOpen}
      onToggleInspector={() => setInspectorOpen((open) => !open)}
      platformStatus={platformStatus}
      runStatus={String(workbench.snapshot?.run?.status ?? "idle")}
      live={workbench.live}
      provider={workbench.provider}
      model={workbench.session?.model}
      connected={workbench.connected}
      onStop={() => void workbench.stop()}
      chat={
        <ChatTranscript
          messages={mergeTranscript(chat.messages, workbench.snapshot?.messages ?? [])}
          approvals={snapshotApprovals}
          isBusy={chat.isLoading}
          runError={String(workbench.snapshot?.run?.error ?? "")}
          error={chat.error?.message ?? workbench.error}
          onPickSuggestion={chat.setDraft}
          onDecide={(id, decision) => void workbench.decideApproval(id, decision)}
        />
      }
      composer={
        <PromptForm
          value={chat.draft}
          busy={busy || chat.isLoading}
          live={workbench.live}
          provider={workbench.provider}
          onChange={chat.setDraft}
          onSend={() => {
            void chat.sendDraft().then((ok) => {
              if (ok) void workbench.refresh();
            });
          }}
        />
      }
      inspector={
        <>
          {membersOpen ? (
            <div className="mb-4 rounded-[var(--radius-card)] border border-border bg-[var(--inset)] p-3">
              <TeamMembersPanel teamId={teamId} token={token} />
            </div>
          ) : null}
          <StatePanels
            snapshot={workbench.snapshot}
            events={workbench.events}
            executions={workbench.executions}
            openTasks={workbench.openTasks}
            doneTasks={workbench.doneTasks}
            activeByName={workbench.activeByName}
            panel={panel}
            onPanel={setPanel}
            base={workbench.base}
            token={token}
            onRefresh={() => void workbench.refresh()}
            onClearWorkspace={() => void workbench.clearWorkspace()}
            notifications={workbench.snapshot?.notifications ?? []}
          />
        </>
      }
      inspectorOpenState={inspectorOpen}
    />
  );
}

function LegacyWorkbench({
  token,
  preferredChatId,
  navigate,
  onLeave,
}: {
  token: string;
  preferredChatId: string;
  navigate: (route: AppRoute, replace?: boolean) => void;
  onLeave: () => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [panel, setPanel] = useState<Panel>("memory");
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );
  const [busy, setBusy] = useState(false);

  const workbench = useWorkbench(agentId, token);
  // Prefer snapshot/long-poll for the fixture workbench path; streams are optional.
  const chat = useAgentChat(agentId, token, agentId || "pending", { live: false });
  const cursorRef = useRef(workbench.cursor);
  cursorRef.current = workbench.cursor;

  const selectChat = useCallback(
    (id: string) => {
      setAgentId(id);
      localStorage.setItem(CHAT_STORAGE_KEY, id);
      navigate({ name: "legacy-workbench", conversationId: id }, true);
      workbench.resetChatState();
    },
    [navigate, workbench],
  );

  const refreshChats = useCallback(async () => {
    const list = await workbench.refreshChats();
    setChats(list);
    return list;
  }, [workbench]);

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
          } catch (err: unknown) {
            workbench.setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
          return;
        }
        setAgentId((current) => {
          if (current && list.some((chatRow) => chatRow.id === current)) return current;
          const preferred =
            preferredChatId && list.some((chatRow) => chatRow.id === preferredChatId)
              ? preferredChatId
              : list[0]?.id;
          if (!preferred) return current;
          localStorage.setItem(CHAT_STORAGE_KEY, preferred);
          navigate({ name: "legacy-workbench", conversationId: preferred }, true);
          if (preferred !== current) workbench.resetChatState();
          return preferred;
        });
      })
      .catch((err: Error) => workbench.setError(err.message));
  }, [
    token,
    refreshChats,
    preferredChatId,
    workbench.setError,
    workbench.resetChatState,
    selectChat,
    navigate,
  ]);

  useEffect(() => {
    if (!token || !agentId || !workbench.base) return undefined;
    const cancelled = { current: false };
    const loop = async () => {
      while (!cancelled.current) {
        try {
          const data = await api<{ events: EventRow[]; latestEventId: number }>(
            `${workbench.base}/events?after=${cursorRef.current}&wait=1`,
            { token },
          );
          if (cancelled.current) return;
          if (data.events.length) {
            workbench.setEvents((current) => {
              const seen = new Set(current.map((row) => row.id));
              const next = [...current];
              for (const row of data.events) {
                if (seen.has(row.id)) continue;
                seen.add(row.id);
                next.push(row);
              }
              return next.slice(-80);
            });
            workbench.setCursor(data.latestEventId);
            await workbench.refresh();
            await refreshChats().catch(() => undefined);
          }
          workbench.setConnected(true);
        } catch {
          if (!cancelled.current) workbench.setConnected(false);
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
    };
    void loop();
    return () => {
      cancelled.current = true;
    };
  }, [token, agentId, workbench.base, workbench, refreshChats]);

  useEffect(() => {
    if (!token) return undefined;
    const id = window.setInterval(() => {
      void refreshChats().catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [token, refreshChats]);

  useEffect(() => {
    const status = String(workbench.snapshot?.run?.status ?? "idle");
    if (status === "running" || status === "queued") setPanel("trace");
  }, [workbench.snapshot?.run?.status]);

  const createChat = () => {
    workbench.setError(null);
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
      .catch((err: Error) => workbench.setError(err.message))
      .finally(() => setBusy(false));
  };

  const activeChat = chats.find((row) => row.id === agentId);
  const platformStatus = derivePlatformStatus({
    runStatus: workbench.runStatus,
    connectionStatus: chat.connectionStatus,
    chatStatus: chat.status,
    pendingApprovals: workbench.snapshot?.approvals?.length ?? 0,
  });

  return (
    <WorkbenchShell
      rail={
        <SessionRail
          chats={chats}
          activeId={agentId}
          busy={busy || chat.isLoading}
          approvalCount={workbench.snapshot?.approvals?.length ?? 0}
          onSelect={selectChat}
          onCreate={createChat}
          onLeave={onLeave}
        />
      }
      headerTitle={activeChat?.title || agentId.slice(0, 12) || "Chat"}
      ownerId={workbench.sessionOwner}
      agentId={agentId}
      inspectorOpen={inspectorOpen}
      onToggleInspector={() => setInspectorOpen((open) => !open)}
      platformStatus={platformStatus}
      runStatus={workbench.runStatus}
      live={workbench.live}
      provider={workbench.provider}
      model={workbench.session?.model}
      connected={workbench.connected}
      onStop={() => void workbench.stop()}
      chat={
        <ChatTranscript
          messages={mergeTranscript(chat.messages, workbench.snapshot?.messages ?? [])}
          approvals={workbench.snapshot?.approvals ?? []}
          isBusy={busy || workbench.busy || chat.isLoading}
          runError={String(workbench.snapshot?.run?.error ?? "")}
          error={workbench.error}
          onPickSuggestion={chat.setDraft}
          onDecide={(id, decision) => void workbench.decideApproval(id, decision)}
        />
      }
      composer={
        <PromptForm
          value={chat.draft}
          busy={busy || workbench.busy || chat.isLoading}
          live={workbench.live}
          provider={workbench.provider}
          onChange={chat.setDraft}
          onSend={() => {
            const text = chat.draft.trim();
            if (!text) return;
            chat.setDraft("");
            void workbench.send(text).then((ok) => {
              if (!ok) chat.setDraft(text);
              else void refreshChats().catch(() => undefined);
            });
          }}
        />
      }
      inspector={
        <StatePanels
          snapshot={workbench.snapshot}
          events={workbench.events}
          executions={workbench.executions}
          openTasks={workbench.openTasks}
          doneTasks={workbench.doneTasks}
          activeByName={workbench.activeByName}
          panel={panel}
          onPanel={setPanel}
          base={workbench.base}
          token={token}
          onRefresh={() => void workbench.refresh()}
          onClearWorkspace={() => void workbench.clearWorkspace()}
          notifications={workbench.snapshot?.notifications ?? []}
        />
      }
      inspectorOpenState={inspectorOpen}
    />
  );
}

function WorkbenchShell({
  rail,
  headerTitle,
  ownerId,
  agentId,
  inspectorOpen,
  onToggleInspector,
  platformStatus,
  runStatus,
  live,
  provider,
  model,
  connected,
  onStop,
  chat,
  composer,
  inspector,
  inspectorOpenState,
}: {
  rail: React.ReactNode;
  headerTitle: string;
  ownerId: string;
  agentId: string;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  platformStatus: ReturnType<typeof derivePlatformStatus>;
  runStatus: string;
  live: boolean;
  provider: string;
  model?: string;
  connected: boolean;
  onStop: () => void;
  chat: React.ReactNode;
  composer: React.ReactNode;
  inspector: React.ReactNode;
  inspectorOpenState: boolean;
}) {
  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-[var(--bench)]">
      {rail}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SessionHeader
          title={headerTitle}
          ownerId={ownerId}
          agentId={agentId}
          inspectorOpen={inspectorOpen}
          onToggleInspector={onToggleInspector}
        />
        <RunStrip
          platformStatus={platformStatus}
          runStatus={runStatus}
          live={live}
          provider={provider}
          model={model}
          connected={connected}
          onStop={onStop}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{chat}</div>
        {composer}
      </main>
      {inspectorOpenState ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onToggleInspector}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={cn(
          "flex min-h-0 shrink-0 flex-col border-l border-border bg-[var(--raised)] transition-[width,transform]",
          "fixed inset-y-0 right-0 z-50 w-[min(100vw,22rem)] lg:static lg:z-auto",
          inspectorOpenState
            ? "translate-x-0 lg:w-[22rem]"
            : "pointer-events-none translate-x-full lg:pointer-events-none lg:w-0 lg:translate-x-0 lg:border-0 lg:overflow-hidden",
        )}
        aria-hidden={!inspectorOpenState}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden p-4",
            !inspectorOpenState && "lg:hidden",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
            <span className="text-sm font-medium">Inspector</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onToggleInspector}
              aria-label="Close inspector"
            >
              Close
            </Button>
          </div>
          {inspector}
        </div>
      </aside>
    </div>
  );
}
