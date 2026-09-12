import { describe, expect, it } from "vitest";
import { HostError } from "../../shared/errors";
import {
  assertLeaseFence,
  assertLeaseGeneration,
  decideExpiredLeases,
  leaseIsActive,
  renewLease,
  type AttemptFence,
  type LeaseRow,
} from "../../worker/task/lease";
import {
  decideRequeueAssignments,
  decideStaleMachines,
  MACHINE_STALE_AFTER_MS,
} from "../../worker/team/sweep";

const baseAttempt: AttemptFence = {
  generation: 2,
  lease_token_hash: "deadbeef",
  lease_expires_at: Date.now() + 60_000,
  status: "running",
};

describe("task lease fencing", () => {
  it("accepts a valid lease", () => {
    expect(() => assertLeaseFence(baseAttempt, "token-value-0123456789", "deadbeef")).not.toThrow();
    assertLeaseGeneration(baseAttempt, 2);
  });

  it("rejects stale generation", () => {
    expect(() => assertLeaseGeneration(baseAttempt, 1)).toThrow(HostError);
  });

  it("rejects expired leases", () => {
    expect(() =>
      assertLeaseFence(
        { ...baseAttempt, lease_expires_at: Date.now() - 1 },
        "token-value-0123456789",
        "deadbeef",
      ),
    ).toThrow(HostError);
  });

  it("tracks lease row activity", () => {
    const row: LeaseRow = {
      token_hash: "abc",
      generation: 1,
      expires_at: Date.now() + 10_000,
      revoked_at: null,
    };
    expect(leaseIsActive(row, "abc")).toBe(true);
    expect(leaseIsActive({ ...row, revoked_at: Date.now() }, "abc")).toBe(false);
  });

  it("renewLease extends expiry", () => {
    const now = 1_000_000;
    const row: LeaseRow = {
      token_hash: "abc",
      generation: 1,
      expires_at: now + 5_000,
      revoked_at: null,
    };
    const renewed = renewLease(row, now, 60_000);
    expect(renewed.expires_at).toBe(now + 60_000);
  });

  it("renewLease rejects expired rows", () => {
    const now = 1_000_000;
    expect(() =>
      renewLease(
        { token_hash: "abc", generation: 1, expires_at: now - 1, revoked_at: null },
        now,
        60_000,
      ),
    ).toThrow(HostError);
  });

  it("decideExpiredLeases marks lost and requeues when retries remain", () => {
    const now = 5_000;
    const decisions = decideExpiredLeases(
      [
        {
          id: "att_1",
          task_id: "task_1",
          generation: 1,
          status: "running",
          lease_expires_at: 4_000,
        },
        {
          id: "att_2",
          task_id: "task_2",
          generation: 3,
          status: "pending",
          lease_expires_at: 4_000,
        },
        {
          id: "att_3",
          task_id: "task_3",
          generation: 1,
          status: "running",
          lease_expires_at: 9_000,
        },
      ],
      now,
    );
    expect(decisions).toEqual([
      {
        attemptId: "att_1",
        taskId: "task_1",
        attemptStatus: "lost",
        taskStatus: "pending",
      },
      {
        attemptId: "att_2",
        taskId: "task_2",
        attemptStatus: "lost",
        taskStatus: "failed",
      },
    ]);
  });
});

describe("team machine sweep", () => {
  it("marks approved machines stale after three heartbeat intervals", () => {
    const now = MACHINE_STALE_AFTER_MS + 10;
    const decisions = decideStaleMachines(
      [
        { id: "m1", status: "approved", last_seen_at: 0 },
        { id: "m2", status: "approved", last_seen_at: now },
        { id: "m3", status: "revoked", last_seen_at: 0 },
      ],
      now,
    );
    expect(decisions).toEqual([{ machineId: "m1", action: "mark_stale" }]);
  });

  it("requeues assigned work on stale machines", () => {
    const decisions = decideRequeueAssignments(
      [
        { id: "a1", machine_id: "m1", status: "assigned" },
        { id: "a2", machine_id: "m1", status: "running" },
        { id: "a3", machine_id: "m2", status: "assigned" },
      ],
      new Set(["m1"]),
    );
    expect(decisions).toEqual([{ assignmentId: "a1", action: "requeue" }]);
  });
});
