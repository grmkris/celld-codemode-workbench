import { HostError } from "../../shared/errors";

export type CancellationState = "none" | "requested" | "signalled" | "escalated" | "confirmed";

const ORDER: Record<CancellationState, number> = {
  none: 0,
  requested: 1,
  signalled: 2,
  escalated: 3,
  confirmed: 4,
};

export function parseCancellationState(value: unknown): CancellationState {
  const state = String(value ?? "none").trim() as CancellationState;
  if (state in ORDER) return state;
  throw new HostError("invalid", "Invalid cancellation state", 400);
}

export function canTransitionCancellation(from: CancellationState, to: CancellationState): boolean {
  if (from === to) return true;
  if (to === "confirmed") {
    return from === "requested" || from === "signalled" || from === "escalated";
  }
  return ORDER[to] === ORDER[from] + 1;
}

export function transitionCancellation(
  from: CancellationState,
  to: CancellationState,
): CancellationState {
  if (from === to) return from;
  if (!canTransitionCancellation(from, to)) {
    throw new HostError("conflict", `Cannot transition cancellation ${from} → ${to}`, 409);
  }
  return to;
}

export function cancellationShouldSignal(state: CancellationState): boolean {
  return state === "requested" || state === "escalated";
}

export function cancellationIsTerminal(state: CancellationState): boolean {
  return state === "confirmed";
}
