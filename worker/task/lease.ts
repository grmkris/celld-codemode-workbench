import { HostError } from "../../shared/errors";

export type LeaseRow = {
  token_hash: string;
  generation: number;
  expires_at: number;
  revoked_at: number | null;
};

export type AttemptFence = {
  generation: number;
  lease_token_hash: string | null;
  lease_expires_at: number | null;
  status: string;
};

export function assertLeaseFence(
  attempt: AttemptFence,
  leaseToken: string,
  tokenHash: string,
  now = Date.now(),
): void {
  if (
    attempt.status === "cancelled" ||
    attempt.status === "succeeded" ||
    attempt.status === "failed"
  ) {
    throw new HostError("fenced", "Attempt is no longer active", 409);
  }
  if (!attempt.lease_token_hash || attempt.lease_token_hash !== tokenHash) {
    throw new HostError("fenced", "Invalid lease token", 409);
  }
  if (attempt.lease_expires_at != null && Number(attempt.lease_expires_at) <= now) {
    throw new HostError("fenced", "Lease expired", 409);
  }
  if (leaseToken.length < 16) {
    throw new HostError("invalid", "Malformed lease token", 400);
  }
}

export function assertLeaseGeneration(attempt: AttemptFence, expectedGeneration: number): void {
  if (Number(attempt.generation) !== expectedGeneration) {
    throw new HostError("fenced", "Stale attempt generation", 409);
  }
}

export function leaseIsActive(row: LeaseRow, tokenHash: string, now = Date.now()): boolean {
  if (row.revoked_at != null) return false;
  if (row.token_hash !== tokenHash) return false;
  return Number(row.expires_at) > now;
}
