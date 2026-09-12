import { describe, expect, it } from "vitest";
import { teamStateSchema } from "../../shared/state-schema";
import {
  stateConversationValue,
  stateDelegatedTaskValue,
  stateMachineValue,
  stateTeamValue,
} from "../../worker/team/state-values";

describe("team state schema events", () => {
  it("emits schema-valid insert/update events for each collection", () => {
    const txid = "txid_test_1";
    const team = stateTeamValue(
      {
        id: "team_a",
        name: "Personal",
        personal_user_id: "user_1",
        created_at: 1,
        updated_at: 2,
      },
      "owner",
    );
    const conversation = stateConversationValue({
      id: "conv_a",
      team_id: "team_a",
      title: "Hello",
      cell_address: "team:team_a:conv:conv_a",
      activity_revision: 0,
      last_message: "",
      run_status: "idle",
      archived: 0,
      created_at: 1,
      updated_at: 1,
    });
    const machine = stateMachineValue({
      id: "mach_a",
      team_id: "team_a",
      name: "box",
      status: "approved",
      labels_json: "{}",
      last_seen_at: 10,
      created_at: 1,
    });
    const delegated = stateDelegatedTaskValue({
      id: "asg_a",
      team_id: "team_a",
      conversation_id: "conv_a",
      status: "pending",
      payload_json: JSON.stringify({ title: "Do work" }),
      updated_at: 3,
    });

    const events = [
      teamStateSchema.teams.insert({ value: team, headers: { txid } }),
      teamStateSchema.conversations.insert({ value: conversation, headers: { txid } }),
      teamStateSchema.conversations.update({
        value: { ...conversation, title: "Renamed" },
        headers: { txid },
      }),
      teamStateSchema.machines.insert({ value: machine, headers: { txid } }),
      teamStateSchema.machines.update({
        value: { ...machine, status: "stale" },
        headers: { txid },
      }),
      teamStateSchema.delegatedTasks.insert({ value: delegated, headers: { txid } }),
      teamStateSchema.delegatedTasks.delete({
        key: delegated.id,
        headers: { txid },
      }),
    ];

    for (const event of events) {
      expect(event.type).toBeTruthy();
      expect(event.headers.txid).toBe(txid);
      expect(["insert", "update", "delete"]).toContain(event.headers.operation);
      if (event.headers.operation !== "delete") {
        expect(event.value).toBeTruthy();
      }
    }
  });
});
