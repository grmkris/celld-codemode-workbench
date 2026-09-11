import { describe, expect, it } from "vitest";
import { HostError } from "../../shared/errors";
import {
  assertLeaseFence,
  assertLeaseGeneration,
  leaseIsActive,
  type AttemptFence,
  type LeaseRow,
} from "../../worker/task/lease";

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
});
