import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../shared/crypto";
import {
  enrollmentTokenIsUsable,
  generateEnrollmentToken,
  generateMachineCredential,
  hashEnrollmentToken,
  hashMachineCredential,
  normalizeEnrollmentTtlSeconds,
  type EnrollmentTokenRow,
} from "../../worker/team/enrollment";
import { HostError } from "../../shared/errors";

describe("machine enrollment tokens", () => {
  it("generates unique tokens and stable hashes", async () => {
    const left = generateEnrollmentToken();
    const right = generateEnrollmentToken();
    expect(left).not.toBe(right);
    expect(await hashEnrollmentToken(left)).toBe(await sha256Hex(left));
  });

  it("generates machine credentials", async () => {
    const credential = generateMachineCredential();
    expect(credential.length).toBeGreaterThan(32);
    expect(await hashMachineCredential(credential)).toHaveLength(64);
  });

  it("normalizes enrollment TTL bounds", () => {
    expect(normalizeEnrollmentTtlSeconds(undefined)).toBe(24 * 60 * 60);
    expect(() => normalizeEnrollmentTtlSeconds(0)).toThrow(HostError);
  });

  it("accepts only fresh enrollment tokens", () => {
    const now = Date.now();
    const row: EnrollmentTokenRow = {
      id: "tok_1",
      team_id: "team_1",
      token_hash: "abc",
      expires_at: now + 60_000,
      revoked_at: null,
      created_by: "user_1",
      created_at: now,
    };
    expect(enrollmentTokenIsUsable(row, now)).toBe(true);
    expect(enrollmentTokenIsUsable({ ...row, revoked_at: now }, now)).toBe(false);
    expect(enrollmentTokenIsUsable({ ...row, expires_at: now - 1 }, now)).toBe(false);
  });
});
