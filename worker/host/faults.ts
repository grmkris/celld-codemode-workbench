import { Data } from "effect";
import { ApprovalRequiredError, CancelledError, FenceError, HostError } from "../../shared/errors";

export class PermissionDenied extends Data.TaggedError("PermissionDenied")<{
  readonly capability: string;
  readonly message: string;
}> {}

export class ApprovalNeeded extends Data.TaggedError("ApprovalNeeded")<{
  readonly operationId: string;
}> {}

export class BudgetExceeded extends Data.TaggedError("BudgetExceeded")<{
  readonly message: string;
}> {}

export class Cancelled extends Data.TaggedError("Cancelled")<{
  readonly message: string;
}> {}

export class Fenced extends Data.TaggedError("Fenced")<{
  readonly message: string;
}> {}

export class OutcomeUnknown extends Data.TaggedError("OutcomeUnknown")<{
  readonly operationId: string;
  readonly message: string;
}> {}

export class InvalidProgram extends Data.TaggedError("InvalidProgram")<{
  readonly message: string;
}> {}

export class TransientFailure extends Data.TaggedError("TransientFailure")<{
  readonly message: string;
}> {}

export class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string;
}> {}

export class Conflict extends Data.TaggedError("Conflict")<{
  readonly message: string;
}> {}

export type HostFault =
  | PermissionDenied
  | ApprovalNeeded
  | BudgetExceeded
  | Cancelled
  | Fenced
  | OutcomeUnknown
  | InvalidProgram
  | TransientFailure
  | NotFound
  | Conflict;

export function toHostError(error: unknown): HostError {
  if (error instanceof HostError) return error;
  if (error instanceof ApprovalNeeded) {
    return new ApprovalRequiredError(error.operationId);
  }
  if (error instanceof PermissionDenied) {
    return new HostError("unauthorized_capability", error.message, 403);
  }
  if (error instanceof BudgetExceeded) {
    return new HostError("limit", error.message, 400);
  }
  if (error instanceof Cancelled) {
    return new CancelledError(error.message);
  }
  if (error instanceof Fenced) {
    return new FenceError(error.message);
  }
  if (error instanceof OutcomeUnknown) {
    return new HostError("uncertain", error.message, 500);
  }
  if (error instanceof InvalidProgram) {
    return new HostError("invalid", error.message, 400);
  }
  if (error instanceof TransientFailure) {
    return new HostError("transient", error.message, 503);
  }
  if (error instanceof NotFound) {
    return new HostError("not_found", error.message, 404);
  }
  if (error instanceof Conflict) {
    return new HostError("conflict", error.message, 409);
  }
  if (error instanceof Error) {
    const tag = (error as Error & { _tag?: string })._tag;
    if (tag === "Interrupt" || /interrupt/i.test(error.message + error.name)) {
      return new CancelledError();
    }
  }
  return new HostError(
    "internal",
    error instanceof Error ? error.message : "Host effect failed",
    500,
  );
}
