import { Context, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ApprovalRequiredError, HostError } from "../../shared/errors";
import {
  ApprovalNeeded,
  BudgetExceeded,
  OutcomeUnknown,
  PermissionDenied,
} from "../../worker/host/faults";
import { toHostError } from "../../worker/host/faults";
import { proposeNotification } from "../../worker/host/notify";
import { runEffectHostProbe } from "../../worker/host/probe";
import { Journal, Policy, RunIdentity } from "../../worker/host/services";

function identity(overrides: Partial<Context.Service.Shape<typeof RunIdentity>> = {}) {
  return {
    ownerId: "alice",
    agentId: "default",
    runId: "run1",
    executionId: "exec1",
    generation: 1,
    mode: "live" as const,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function policy(allowed = new Set(["integrations"])) {
  return {
    require: (capability: string) =>
      allowed.has(capability)
        ? Effect.succeed(undefined)
        : Effect.fail(
            new PermissionDenied({
              capability,
              message: `Capability ${capability} is not granted in this execution`,
            }),
          ),
    requireOwner: (ownerId: string) =>
      ownerId === "alice"
        ? Effect.succeed(undefined)
        : Effect.fail(
            new PermissionDenied({
              capability: "owner",
              message: "Not the owning principal",
            }),
          ),
    requireLiveEffect: () => Effect.succeed(undefined),
  };
}

function journal(existing: Record<string, unknown> | null = null) {
  const proposed: Array<Record<string, unknown>> = [];
  return {
    impl: {
      findOperation: () => Effect.succeed(existing),
      propose: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          proposed.push(input);
        }),
      operation: (id: string) =>
        Effect.succeed(existing && String(existing.id) === id ? existing : null),
      mark: () => Effect.succeed(undefined),
      deliverNotification: () => Effect.succeed({ notificationId: "n1" }),
      record: () => Effect.succeed(undefined),
    },
    proposed,
  };
}

function runNotify(
  services: {
    identity?: Context.Service.Shape<typeof RunIdentity>;
    policy?: Context.Service.Shape<typeof Policy>;
    journal?: Context.Service.Shape<typeof Journal>;
  },
  input = { channel: "demo", message: "hello" },
) {
  const context = Context.make(RunIdentity, services.identity ?? identity()).pipe(
    Context.add(Policy, services.policy ?? policy()),
    Context.add(Journal, services.journal ?? journal().impl),
  );
  return Effect.runPromiseWith(context)(proposeNotification(input));
}

describe("Effect host notify path", () => {
  it("proposes an approval instead of sending immediately", async () => {
    const { impl, proposed } = journal(null);
    await expect(runNotify({ journal: impl })).rejects.toBeInstanceOf(ApprovalNeeded);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.capability).toBe("integrations.notify");
  });

  it("maps approval to the stable public error code", () => {
    const mapped = toHostError(new ApprovalNeeded({ operationId: "op1" }));
    expect(mapped).toBeInstanceOf(ApprovalRequiredError);
    expect(mapped.code).toBe("approval_required");
  });

  it("denies unauthorized callers before journaling", async () => {
    await expect(runNotify({ policy: policy(new Set(["memory"])) })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("does not automatically retry an uncertain effect", async () => {
    const { impl, proposed } = journal({
      id: "op-uncertain",
      status: "uncertain",
      args_json: JSON.stringify({ channel: "demo", message: "hello" }),
    });
    await expect(runNotify({ journal: impl })).rejects.toBeInstanceOf(OutcomeUnknown);
    expect(proposed).toHaveLength(0);
    expect(
      toHostError(new OutcomeUnknown({ operationId: "op-uncertain", message: "x" })).code,
    ).toBe("uncertain");
  });

  it("rejects oversized notify payloads", async () => {
    await expect(
      runNotify({}, { channel: "demo", message: "n".repeat(8_000) }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("scopes owner checks to the acting principal", () => {
    const mapped = toHostError(
      new PermissionDenied({ capability: "owner", message: "Not the owning principal" }),
    );
    expect(mapped).toBeInstanceOf(HostError);
    expect(mapped.status).toBe(403);
  });
});

describe("Effect Worker subset", () => {
  it("runs async work, layers, interruption, and scoped cleanup", async () => {
    const report = await runEffectHostProbe();
    expect(report.asyncOk).toBe(true);
    expect(report.layerOk).toBe(true);
    expect(report.cleaned).toBe(true);
    expect(report.interrupted).toBe(true);
    expect(report.passed).toBe(true);
  });
});
