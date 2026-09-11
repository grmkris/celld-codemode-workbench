import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../shared/crypto";
import {
  buildAcceptUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationIsAcceptable,
  invitationRejectReason,
  normalizeInvitationTtlSeconds,
  type InvitationRow,
} from "../../worker/team/invitations";
import { HostError } from "../../shared/errors";

describe("team invitation tokens", () => {
  it("generates unique plaintext tokens and stable SHA-256 hashes", async () => {
    const left = generateInvitationToken();
    const right = generateInvitationToken();
    expect(left).not.toBe(right);
    expect(left.length).toBeGreaterThan(32);

    const hash = await hashInvitationToken(left);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(await sha256Hex(left));
  });

  it("normalizes invitation TTL bounds", () => {
    expect(normalizeInvitationTtlSeconds(undefined)).toBe(7 * 24 * 60 * 60);
    expect(normalizeInvitationTtlSeconds(3600)).toBe(3600);
    expect(normalizeInvitationTtlSeconds(999_999_999)).toBe(30 * 24 * 60 * 60);
    expect(() => normalizeInvitationTtlSeconds(-1)).toThrow(HostError);
  });

  it("builds accept URLs without leaking stored hashes", () => {
    const token = "abc123";
    expect(buildAcceptUrl("https://celld.example", token)).toBe(
      "https://celld.example/api/invitations/accept?token=abc123",
    );
  });

  it("accepts only fresh single-use invitations", () => {
    const now = Date.now();
    const base: InvitationRow = {
      id: "inv_test",
      team_id: "team_test",
      role: "member",
      token_hash: "deadbeef",
      email_hint: null,
      expires_at: now + 60_000,
      revoked_at: null,
      accepted_by: null,
      accepted_at: null,
      created_by: "user_creator",
      created_at: now,
    };

    expect(invitationIsAcceptable(base, now)).toBe(true);
    expect(invitationRejectReason({ ...base, revoked_at: now }, now)).toBe("revoked");
    expect(invitationRejectReason({ ...base, accepted_at: now }, now)).toBe("already_accepted");
    expect(invitationRejectReason({ ...base, expires_at: now - 1 }, now)).toBe("expired");
  });
});
