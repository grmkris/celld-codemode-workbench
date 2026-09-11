import { describe, expect, it } from "vitest";
import { assertApprovalCas } from "../../worker/commands/approvals";
import { resolveCommandDedup } from "../../worker/commands/dedup";
import { shouldAdvanceQueue } from "../../worker/commands/queue";
import { evaluateStopFence } from "../../worker/commands/stop";
import type { CommandRow } from "../../worker/commands/types";
import { HostError } from "../../shared/errors";

function commandRow(overrides: Partial<CommandRow> = {}): CommandRow {
  return {
    principal: "user_1",
    command_id: "cmd_1",
    kind: "send",
    payload_hash: "hash-a",
    payload: "{}",
    outcome_json: JSON.stringify({ ok: true }),
    message_id: null,
    run_id: null,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("resolveCommandDedup", () => {
  it("returns replay outcome for matching payload hash", () => {
    const replay = resolveCommandDedup(commandRow(), "hash-a");
    expect(replay?.replay).toBe(true);
    expect(replay?.outcome).toEqual({ ok: true });
  });

  it("throws conflict when payload hash differs", () => {
    expect(() => resolveCommandDedup(commandRow(), "hash-b")).toThrow(HostError);
    try {
      resolveCommandDedup(commandRow(), "hash-b");
    } catch (error) {
      expect((error as HostError).code).toBe("conflict");
      expect((error as HostError).status).toBe(409);
    }
  });

  it("throws conflict when command is still in flight", () => {
    expect(() => resolveCommandDedup(commandRow({ outcome_json: null }), "hash-a")).toThrow(
      HostError,
    );
  });
});

describe("evaluateStopFence", () => {
  it("allows stop without explicit fencing", () => {
    expect(
      evaluateStopFence({
        activeRunId: "run_1",
        activeGeneration: 2,
      }),
    ).toEqual({ allowed: true, stale: false });
  });

  it("rejects stale stop when generation mismatches", () => {
    expect(
      evaluateStopFence({
        activeRunId: "run_1",
        activeGeneration: 3,
        expectedRunId: "run_1",
        expectedGeneration: 2,
      }),
    ).toEqual({ allowed: false, stale: true, reason: "generation_mismatch" });
  });

  it("rejects stale stop when run id mismatches", () => {
    expect(
      evaluateStopFence({
        activeRunId: "run_2",
        activeGeneration: 2,
        expectedRunId: "run_1",
        expectedGeneration: 2,
      }),
    ).toEqual({ allowed: false, stale: true, reason: "run_mismatch" });
  });

  it("reports idle when no active run", () => {
    expect(
      evaluateStopFence({
        activeRunId: null,
        activeGeneration: null,
        expectedRunId: "run_1",
      }),
    ).toEqual({ allowed: false, stale: false, reason: "idle" });
  });
});

describe("shouldAdvanceQueue", () => {
  it("does not advance when queue is paused", () => {
    expect(
      shouldAdvanceQueue({
        queuePaused: true,
        hasActiveRun: false,
        hasQueued: true,
      }),
    ).toBe(false);
  });

  it("advances when queue is ready", () => {
    expect(
      shouldAdvanceQueue({
        queuePaused: false,
        hasActiveRun: false,
        hasQueued: true,
      }),
    ).toBe(true);
  });
});

describe("assertApprovalCas", () => {
  it("allows idempotent approve on succeeded operations", () => {
    expect(() => assertApprovalCas("succeeded", "proposed", "approve")).not.toThrow();
  });

  it("rejects approve when expected status does not match", () => {
    expect(() => assertApprovalCas("denied", "proposed", "approve")).toThrow(HostError);
  });
});
