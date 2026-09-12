import { useCallback, useEffect, useState } from "react";
import { resolveAgentId } from "@/lib/agent-id";
import { api } from "@/lib/api";
import type {
  ApprovalRecord,
  ChecklistTaskRecord,
  ConversationSummary,
  DelegatedTaskRecord,
  MachineRecord,
  TeamRecord,
} from "@/lib/state-schema";

/**
 * REST-synced team collections backed by `createStateSchema` types.
 * Durable StreamDB wiring lands when `/api/teams/:id/state/stream` is proxied.
 */
export function useTeamState(token: string, teamId: string, activeAgentId?: string) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [checklistTasks, setChecklistTasks] = useState<ChecklistTaskRecord[]>([]);
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [delegatedTasks, setDelegatedTasks] = useState<DelegatedTaskRecord[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
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

      setTeams(teamsRes.teams);
      setConversations(conversationsRes.conversations);
      setMachines(machinesRes.machines);

      if (activeAgentId) {
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
      }
      setSyncError(null);
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [activeAgentId, teamId, token]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const renameConversation = useCallback(
    async (conversation: ConversationSummary, title: string) => {
      const trimmed = title.trim();
      if (!trimmed || trimmed === conversation.title) return;
      const previous = conversation.title;
      setConversations((rows) =>
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
      } catch (err: unknown) {
        setConversations((rows) =>
          rows.map((row) => (row.id === conversation.id ? { ...row, title: previous } : row)),
        );
        throw err;
      } finally {
        await refresh();
      }
    },
    [refresh, teamId, token],
  );

  return {
    conversations,
    approvals,
    checklistTasks,
    machines,
    teams,
    delegatedTasks,
    syncing,
    syncError,
    refresh,
    renameConversation,
    resolveAgentId,
  };
}
