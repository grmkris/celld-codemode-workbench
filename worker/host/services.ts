import { Context, Effect } from "effect";
import type { Store } from "../store";
import type { HostContext } from "../capabilities";
import {
  ApprovalNeeded,
  BudgetExceeded,
  Cancelled,
  Conflict,
  Fenced,
  InvalidProgram,
  NotFound,
  OutcomeUnknown,
  PermissionDenied,
  type HostFault,
} from "./faults";

export class RunIdentity extends Context.Service<
  RunIdentity,
  {
    readonly ownerId: string;
    readonly agentId: string;
    readonly runId: string | null;
    readonly executionId: string;
    readonly generation: number;
    readonly mode: HostContext["mode"];
    readonly abortSignal: AbortSignal;
  }
>()("celld/RunIdentity") {}

export class Policy extends Context.Service<
  Policy,
  {
    readonly require: (capability: string) => Effect.Effect<void, HostFault>;
    readonly requireOwner: (ownerId: string) => Effect.Effect<void, HostFault>;
    readonly requireLiveEffect: () => Effect.Effect<void, HostFault>;
  }
>()("celld/Policy") {}

export class Journal extends Context.Service<
  Journal,
  {
    readonly findOperation: (
      executionId: string,
      capability: string,
      argsHash: string,
    ) => Effect.Effect<Record<string, unknown> | null, never>;
    readonly propose: (input: {
      id: string;
      ownerId: string;
      runId: string | null;
      executionId: string;
      capability: string;
      argsJson: string;
      argsHash: string;
      expiry: number;
    }) => Effect.Effect<void, never>;
    readonly operation: (id: string) => Effect.Effect<Record<string, unknown> | null, never>;
    readonly mark: (
      id: string,
      status: string,
      result?: string | null,
    ) => Effect.Effect<void, never>;
    readonly deliverNotification: (input: {
      operationId: string;
      channel: string;
      message: string;
    }) => Effect.Effect<{ notificationId: string }, never>;
    readonly record: (type: string, payload: unknown) => Effect.Effect<void, never>;
  }
>()("celld/Journal") {}

export function makePolicy(ctx: HostContext): Context.Service.Shape<typeof Policy> {
  return {
    require: (capability) =>
      Effect.gen(function* () {
        if (ctx.abortSignal.aborted || ctx.isCancelRequested()) {
          return yield* new Cancelled({ message: "Run was cancelled" });
        }
        if (ctx.expectedGeneration() !== ctx.generation) {
          return yield* new Fenced({ message: "Stale execution fenced" });
        }
        if (!ctx.allowed.has(capability)) {
          return yield* new PermissionDenied({
            capability,
            message: `Capability ${capability} is not granted in this execution`,
          });
        }
        try {
          ctx.consumeHostCall();
        } catch (error) {
          return yield* new BudgetExceeded({
            message: error instanceof Error ? error.message : "Host-call budget exhausted",
          });
        }
      }),
    requireOwner: (ownerId) =>
      ownerId === ctx.ownerId
        ? Effect.succeed(undefined)
        : Effect.fail(
            new PermissionDenied({
              capability: "owner",
              message: "Not the owning principal",
            }),
          ),
    requireLiveEffect: () =>
      ctx.mode === "test"
        ? Effect.fail(
            new PermissionDenied({
              capability: "integrations",
              message: "Live integrations are disabled in tests",
            }),
          )
        : Effect.succeed(undefined),
  };
}

export function makeJournal(store: Store, ctx: HostContext): Context.Service.Shape<typeof Journal> {
  return {
    findOperation: (executionId, capability, argsHash) =>
      Effect.sync(
        () =>
          store.operationByScope(executionId, capability, argsHash) as Record<
            string,
            unknown
          > | null,
      ),
    propose: (input) =>
      Effect.sync(() => {
        store.createOperation({
          id: input.id,
          ownerId: input.ownerId,
          runId: input.runId,
          executionId: input.executionId,
          capability: input.capability,
          argsJson: input.argsJson,
          argsHash: input.argsHash,
          snippetVersionId: null,
          expiry: input.expiry,
        });
      }),
    operation: (id) => Effect.sync(() => store.operation(id) as Record<string, unknown> | null),
    mark: (id, status, result) =>
      Effect.sync(() => {
        store.updateOperation(id, status, result);
      }),
    deliverNotification: (input) =>
      Effect.sync(() => ({
        notificationId: store.insertNotification(input.operationId, input.channel, input.message),
      })),
    record: (type, payload) =>
      Effect.sync(() => {
        ctx.record(type, payload);
      }),
  };
}

export function makeIdentity(ctx: HostContext): Context.Service.Shape<typeof RunIdentity> {
  return {
    ownerId: ctx.ownerId,
    agentId: ctx.agentId,
    runId: ctx.runId,
    executionId: ctx.executionId,
    generation: ctx.generation,
    mode: ctx.mode,
    abortSignal: ctx.abortSignal,
  };
}

export function hostContext(store: Store, ctx: HostContext) {
  return Context.make(RunIdentity, makeIdentity(ctx)).pipe(
    Context.add(Policy, makePolicy(ctx)),
    Context.add(Journal, makeJournal(store, ctx)),
  );
}

export { ApprovalNeeded, Conflict, InvalidProgram, NotFound, OutcomeUnknown };
