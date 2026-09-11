import { describe, expect, it } from "vitest";
import {
  assertActivityRevision,
  nextActivityRevision,
  shouldAcceptActivityPush,
} from "../../worker/team/activity";
import { HostError } from "../../shared/errors";

describe("conversation activity revision CAS", () => {
  it("rejects stale activity pushes", () => {
    expect(shouldAcceptActivityPush(5, 4)).toEqual({
      accepted: false,
      reason: "stale_revision",
    });
    expect(shouldAcceptActivityPush(5, 5)).toEqual({ accepted: true });
    expect(shouldAcceptActivityPush(5, 6)).toEqual({ accepted: true });
  });

  it("monotonically advances revision counters", () => {
    expect(nextActivityRevision(3)).toBe(4);
    expect(nextActivityRevision(3, 3)).toBe(4);
    expect(nextActivityRevision(3, 10)).toBe(10);
  });

  it("validates revision numbers", () => {
    expect(assertActivityRevision(0)).toBe(0);
    expect(assertActivityRevision(12.9)).toBe(12);
    expect(() => assertActivityRevision(-1)).toThrow(HostError);
    expect(() => assertActivityRevision("nope")).toThrow(HostError);
  });
});
