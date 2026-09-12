import { EventId } from "../../shared/ids";
import { teamStateSchema } from "../../shared/state-schema";
import { OutboxPublisher } from "../streams/publisher";
import { readStreamsConfig, stateStreamUrl } from "../streams/config";
import type { Sql } from "../sql";
import type { Env } from "../env";

export type SnapshotRows = {
  teams: unknown[];
  conversations: unknown[];
  machines: unknown[];
  delegatedTasks: unknown[];
};

function publisherKey(teamId: string): string {
  return `state:${teamId}`;
}

function outboxKind(teamId: string): string {
  return `state:${teamId}`;
}

export function createTeamStatePublisher(sql: Sql, env: Env, teamId: string) {
  const config = readStreamsConfig(env);
  const publisher = new OutboxPublisher(sql, {
    publisherKey: publisherKey(teamId),
    config,
  });
  const kind = outboxKind(teamId);

  return {
    txid: () => EventId.generate(),
    enqueue: async (event: unknown) => {
      await publisher.enqueue(kind, event);
    },
    flush: async () => {
      return publisher.flush(stateStreamUrl(`team:${teamId}`, config), { kind });
    },
    needsSnapshot: () => {
      return !sql.one<{ key: string }>(
        "SELECT key FROM publisher WHERE key = ?",
        publisherKey(teamId),
      );
    },
    emitSnapshot: async (rows: SnapshotRows, txid: string) => {
      await publisher.enqueue(kind, {
        headers: { control: "snapshot-start", txid },
      });
      for (const value of rows.teams) {
        await publisher.enqueue(
          kind,
          teamStateSchema.teams.insert({ value: value as never, headers: { txid } }),
        );
      }
      for (const value of rows.conversations) {
        await publisher.enqueue(
          kind,
          teamStateSchema.conversations.insert({ value: value as never, headers: { txid } }),
        );
      }
      for (const value of rows.machines) {
        await publisher.enqueue(
          kind,
          teamStateSchema.machines.insert({ value: value as never, headers: { txid } }),
        );
      }
      for (const value of rows.delegatedTasks) {
        await publisher.enqueue(
          kind,
          teamStateSchema.delegatedTasks.insert({ value: value as never, headers: { txid } }),
        );
      }
      await publisher.enqueue(kind, {
        headers: { control: "snapshot-end", txid },
      });
    },
  };
}
