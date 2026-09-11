import { Effect } from "effect";
import { LIMITS } from "../../shared/limits";
import { bytesOf, sha256Hex, stableJson } from "../../shared/crypto";
import { scopedOperationId } from "../../shared/ids";
import {
  ApprovalNeeded,
  BudgetExceeded,
  Conflict,
  InvalidProgram,
  NotFound,
  OutcomeUnknown,
  PermissionDenied,
} from "./faults";
import { Journal, Policy, RunIdentity } from "./services";

export const proposeNotification = (input: { channel: string; message: string }) =>
  Effect.gen(function* () {
    const identity = yield* RunIdentity;
    const policy = yield* Policy;
    const journal = yield* Journal;
    yield* policy.require("integrations");
    yield* policy.requireLiveEffect();
    if (bytesOf(input.channel) > 32) {
      return yield* new BudgetExceeded({ message: "channel exceeds 32 bytes" });
    }
    if (bytesOf(input.message) > LIMITS.notifyMessageBytes) {
      return yield* new BudgetExceeded({
        message: `message exceeds ${LIMITS.notifyMessageBytes} bytes`,
      });
    }
    const args = { channel: input.channel, message: input.message };
    const argsJson = stableJson(args);
    const argsHash = yield* Effect.tryPromise({
      try: () => sha256Hex(argsJson),
      catch: (error) =>
        new InvalidProgram({
          message: error instanceof Error ? error.message : "Could not hash operation",
        }),
    });
    const existing = yield* journal.findOperation(
      identity.executionId,
      "integrations.notify",
      argsHash,
    );
    if (existing) {
      if (String(existing.args_json) !== argsJson) {
        return yield* new Conflict({
          message: "Operation reused with different payload",
        });
      }
      if (String(existing.status) === "succeeded") {
        return JSON.parse(String(existing.result ?? "{}")) as {
          delivered: boolean;
          notificationId: string;
          operationId: string;
        };
      }
      if (String(existing.status) === "proposed") {
        return yield* new ApprovalNeeded({ operationId: String(existing.id) });
      }
      if (String(existing.status) === "uncertain") {
        return yield* new OutcomeUnknown({
          operationId: String(existing.id),
          message: "Previous notify is uncertain; reconcile before retrying",
        });
      }
    }
    const id = scopedOperationId(
      identity.ownerId,
      identity.executionId,
      "integrations.notify",
      argsHash,
    );
    yield* journal.propose({
      id,
      ownerId: identity.ownerId,
      runId: identity.runId,
      executionId: identity.executionId,
      capability: "integrations.notify",
      argsJson,
      argsHash,
      expiry: Date.now() + LIMITS.approvalTtlMs,
    });
    yield* journal.record("approval.proposed", {
      id,
      capability: "integrations.notify",
      args,
    });
    return yield* new ApprovalNeeded({ operationId: id });
  });

export const executeApprovedNotification = (input: {
  id: string;
  decision: string;
  actorOwnerId: string;
}) =>
  Effect.gen(function* () {
    const policy = yield* Policy;
    const journal = yield* Journal;
    yield* policy.requireOwner(input.actorOwnerId);
    const operation = yield* journal.operation(input.id);
    if (!operation) {
      return yield* new NotFound({ message: "Approval not found" });
    }
    if (String(operation.owner_id) !== input.actorOwnerId) {
      return yield* new PermissionDenied({
        capability: "owner",
        message: "Not the owning principal",
      });
    }
    if (Number(operation.expiry) < Date.now() && String(operation.status) === "proposed") {
      yield* journal.mark(String(operation.id), "denied", "expired");
      return yield* new Conflict({ message: "Approval expired" });
    }
    if (input.decision === "deny") {
      yield* journal.mark(String(operation.id), "denied");
      yield* journal.record("approval.denied", { id: operation.id });
      return { status: "denied" as const, id: String(operation.id) };
    }
    if (input.decision !== "approve") {
      return yield* new InvalidProgram({ message: "decision must be approve or deny" });
    }
    if (String(operation.status) === "succeeded") {
      const result = JSON.parse(String(operation.result ?? "{}"));
      return { status: "succeeded" as const, id: String(operation.id), ...result, result };
    }
    if (String(operation.status) !== "proposed" && String(operation.status) !== "approved") {
      return yield* new Conflict({
        message: `Cannot approve a ${String(operation.status)} operation`,
      });
    }
    yield* journal.mark(String(operation.id), "approved");
    const args = JSON.parse(String(operation.args_json)) as {
      channel: string;
      message: string;
    };
    yield* journal.mark(String(operation.id), "dispatched");
    try {
      const delivered = yield* journal.deliverNotification({
        operationId: String(operation.id),
        channel: args.channel,
        message: args.message,
      });
      const result = {
        delivered: true,
        notificationId: delivered.notificationId,
        operationId: operation.id,
      };
      yield* journal.mark(String(operation.id), "succeeded", JSON.stringify(result));
      yield* journal.record("approval.executed", result);
      return { status: "succeeded" as const, ...result };
    } catch (error) {
      yield* journal.mark(
        String(operation.id),
        "uncertain",
        error instanceof Error ? error.message : String(error),
      );
      return yield* new OutcomeUnknown({
        operationId: String(operation.id),
        message: "Effect may have occurred; marked uncertain",
      });
    }
  });
