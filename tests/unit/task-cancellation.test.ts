import { describe, expect, it } from "vitest";
import { HostError } from "../../shared/errors";
import {
  canTransitionCancellation,
  cancellationIsTerminal,
  cancellationShouldSignal,
  transitionCancellation,
} from "../../worker/task/cancellation";

describe("task cancellation transitions", () => {
  it("walks the state machine in order", () => {
    expect(transitionCancellation("none", "requested")).toBe("requested");
    expect(transitionCancellation("requested", "signalled")).toBe("signalled");
    expect(transitionCancellation("signalled", "escalated")).toBe("escalated");
    expect(transitionCancellation("escalated", "confirmed")).toBe("confirmed");
  });

  it("allows confirmed from any active state", () => {
    expect(transitionCancellation("requested", "confirmed")).toBe("confirmed");
    expect(transitionCancellation("signalled", "confirmed")).toBe("confirmed");
  });

  it("rejects invalid jumps", () => {
    expect(() => transitionCancellation("none", "confirmed")).toThrow(HostError);
    expect(canTransitionCancellation("confirmed", "requested")).toBe(false);
  });

  it("flags signal and terminal states", () => {
    expect(cancellationShouldSignal("requested")).toBe(true);
    expect(cancellationShouldSignal("none")).toBe(false);
    expect(cancellationIsTerminal("confirmed")).toBe(true);
    expect(cancellationIsTerminal("signalled")).toBe(false);
  });
});
