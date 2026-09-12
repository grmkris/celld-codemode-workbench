import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { createStreamDB } from "@durable-streams/state/db";
import { api } from "@/lib/api";
import {
  teamStateSchema,
  type ApprovalRecord,
  type ChecklistTaskRecord,
  type ConversationSummary,
  type DelegatedTaskRecord,
  type MachineRecord,
  type TeamRecord,
} from "@/lib/state-schema";

type TeamStreamDB = ReturnType<typeof createTeamStreamDB>;

function createTeamStreamDB(token: string, teamId: string) {
  return createStreamDB({
    streamOptions: {
      url: new URL(
        `/api/teams/${encodeURIComponent(teamId)}/state/stream`,
        window.location.origin,
      ).toString(),
      headers: { Authorization: `Bearer ${token}` },
      contentType: "application/json",
    },
    live: true,
    state: teamStateSchema,
    actions: ({ db }) => ({
      renameConversation: {
        onMutate: ({
          conversation,
          title,
        }: {
          conversation: ConversationSummary;
          title: string;
        }) => {
          db.collections.conversations.update(conversation.id, (draft) => {
            draft.title = title;
          });
        },
        mutationFn: async ({
          conversation,
          title,
        }: {
          conversation: ConversationSummary;
          title: string;
        }) => {
          const res = await api<{ txid?: string }>(
            `/api/teams/${encodeURIComponent(teamId)}/conversations/${conversation.id}`,
            {
              method: "PATCH",
              token,
              body: JSON.stringify({
                title,
                expectedActivityRevision: conversation.activityRevision,
              }),
            },
          );
          if (res.txid) {
            await db.utils.awaitTxId(res.txid, 10_000);
          }
        },
      },
    }),
  });
}

/**
 * Team collections via StreamDB (Durable State), with REST seed so the rail
 * stays usable while the stream catches up. Approvals/checklist stay on the
 * agent snapshot.
 */
export function useTeamState(token: string, teamId: string, activeAgentId?: string) {
  const [db, setDb] = useState<TeamStreamDB | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [restConversations, setRestConversations] = useState<ConversationSummary[]>([]);
  const [restMachines, setRestMachines] = useState<MachineRecord[]>([]);
  const [restTeams, setRestTeams] = useState<TeamRecord[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [checklistTasks, setChecklistTasks] = useState<ChecklistTaskRecord[]>([]);

  const refreshRest = useCallback(async () => {
    if (!token || !teamId) return;
    setSyncing(true);
    try {
      const [teamsRes, conversationsRes, machinesRes] = await Promise.all([
        api<{ teams: TeamRecord[] }>("/api/teams", { token }),
        api<{ conversations: ConversationSummary[] }>(
          `/api/teams/${encodeURIComponent(teamId)}/conversations`,
          { token },
        ),
        api<{ machines: MachineRecord[] }>(`/api/teams/${encodeURIComponent(teamId)}/machines`, {
          token,
        }).catch(() => ({ machines: [] as MachineRecord[] })),
      ]);
      setRestTeams(teamsRes.teams);
      setRestConversations(conversationsRes.conversations);
      setRestMachines(machinesRes.machines);
      setSyncError(null);
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [teamId, token]);

  useEffect(() => {
    void refreshRest();
  }, [refreshRest]);

  useEffect(() => {
    if (!token || !teamId) return;
    let cancelled = false;
    const instance = createTeamStreamDB(token, teamId);
    setDb(instance);
    setStreamReady(false);
    void instance
      .preload()
      .then(() => {
        if (!cancelled) {
          setStreamReady(true);
          setSyncError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSyncError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
      instance.close();
      setDb(null);
      setStreamReady(false);
    };
  }, [token, teamId]);

  const conversationsQuery = useLiveQuery(
    (q) => (db ? q.from({ conversations: db.collections.conversations }) : undefined),
    [db],
  );
  const machinesQuery = useLiveQuery(
    (q) => (db ? q.from({ machines: db.collections.machines }) : undefined),
    [db],
  );
  const teamsQuery = useLiveQuery(
    (q) => (db ? q.from({ teams: db.collections.teams }) : undefined),
    [db],
  );
  const delegatedQuery = useLiveQuery(
    (q) => (db ? q.from({ delegatedTasks: db.collections.delegatedTasks }) : undefined),
    [db],
  );

  const streamConversations = (conversationsQuery.data ?? []) as ConversationSummary[];
  const streamMachines = (machinesQuery.data ?? []) as MachineRecord[];
  const streamTeams = (teamsQuery.data ?? []) as TeamRecord[];
  const delegatedTasks = (delegatedQuery.data ?? []) as DelegatedTaskRecord[];

  const conversations =
    streamReady && streamConversations.length > 0 ? streamConversations : restConversations;
  const machines = streamReady && streamMachines.length > 0 ? streamMachines : restMachines;
  const teams = streamReady && streamTeams.length > 0 ? streamTeams : restTeams;

  const refreshApprovals = useCallback(async () => {
    if (!token || !activeAgentId) {
      setApprovals([]);
      setChecklistTasks([]);
      return;
    }
    try {
      const snapshot = await api<{
        approvals: Array<{ id: string; capability: string; args_json: string; status: string }>;
        tasks: Array<{ id: string; title: string; status: string }>;
      }>(`/api/agents/${encodeURIComponent(activeAgentId)}/snapshot`, { token });
      setApprovals(
        (snapshot.approvals ?? []).map((row) => ({
          id: row.id,
          capability: row.capability,
          argsJson: row.args_json,
          status: row.status,
          conversationId: activeAgentId,
        })),
      );
      setChecklistTasks(
        (snapshot.tasks ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          conversationId: activeAgentId,
        })),
      );
    } catch {
      // keep last known agent-local state
    }
  }, [activeAgentId, token]);

  useEffect(() => {
    void refreshApprovals();
    const id = window.setInterval(() => void refreshApprovals(), 5_000);
    return () => window.clearInterval(id);
  }, [refreshApprovals]);

  const renameConversation = useCallback(
    async (conversation: ConversationSummary, title: string) => {
      const trimmed = title.trim();
      if (!trimmed || trimmed === conversation.title) return;
      if (db && streamReady) {
        const tx = db.actions.renameConversation({ conversation, title: trimmed });
        await tx.isPersisted.promise;
        return;
      }
      setRestConversations((rows) =>
        rows.map((row) => (row.id === conversation.id ? { ...row, title: trimmed } : row)),
      );
      try {
        await api(`/api/teams/${encodeURIComponent(teamId)}/conversations/${conversation.id}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({
            title: trimmed,
            expectedActivityRevision: conversation.activityRevision,
          }),
        });
      } catch (err) {
        await refreshRest();
        throw err;
      }
      await refreshRest();
    },
    [db, refreshRest, streamReady, teamId, token],
  );

  const refresh = useCallback(async () => {
    await Promise.all([refreshRest(), refreshApprovals()]);
  }, [refreshApprovals, refreshRest]);

  return {
    conversations,
    approvals,
    checklistTasks,
    machines,
    teams,
    delegatedTasks,
    syncing: syncing && !streamReady,
    syncError,
    refresh,
    renameConversation,
  };
}
