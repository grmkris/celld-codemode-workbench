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

export const DEFAULT_LEASE_TTL_MS = 300_000;
export const MIN_LEASE_TTL_MS = 30_000;
export const MAX_LEASE_TTL_MS = 3_600_000;
/** Generations below this may requeue the task after lease expiry. */
export const MAX_LEASE_RETRY_GENERATION = 3;

export function clampLeaseTtlMs(ttlMs: unknown): number {
  const raw = Number(ttlMs ?? DEFAULT_LEASE_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_LEASE_TTL_MS;
  return Math.min(Math.max(raw, MIN_LEASE_TTL_MS), MAX_LEASE_TTL_MS);
}

export function assertLeaseFence(
  attempt: AttemptFence,
  leaseToken: string,
  tokenHash: string,
  now = Date.now(),
): void {
  if (
    attempt.status === "cancelled" ||
    attempt.status === "succeeded" ||
    attempt.status === "failed" ||
    attempt.status === "lost"
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

/** Pure helper: extend an active lease row's expiry. */
export function renewLease(
  row: LeaseRow,
  now: number,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): LeaseRow {
  if (row.revoked_at != null) {
    throw new HostError("fenced", "Lease revoked", 409);
  }
  if (Number(row.expires_at) <= now) {
    throw new HostError("fenced", "Lease expired", 409);
  }
  const ttl = clampLeaseTtlMs(ttlMs);
  return {
    ...row,
    expires_at: now + ttl,
  };
}

export type ExpirableAttempt = {
  id: string;
  task_id: string;
  generation: number;
  status: string;
  lease_expires_at: number | null;
};

export type LeaseExpiryDecision = {
  attemptId: string;
  taskId: string;
  attemptStatus: "lost";
  taskStatus: "pending" | "failed";
};

/** Pure sweeper decision: which attempts lost their lease at `now`. */
export function decideExpiredLeases(
  attempts: ExpirableAttempt[],
  now: number,
  maxRetryGeneration = MAX_LEASE_RETRY_GENERATION,
): LeaseExpiryDecision[] {
  const decisions: LeaseExpiryDecision[] = [];
  for (const attempt of attempts) {
    if (attempt.status !== "pending" && attempt.status !== "running") continue;
    if (attempt.lease_expires_at == null) continue;
    if (Number(attempt.lease_expires_at) >= now) continue;
    decisions.push({
      attemptId: attempt.id,
      taskId: attempt.task_id,
      attemptStatus: "lost",
      taskStatus: Number(attempt.generation) < maxRetryGeneration ? "pending" : "failed",
    });
  }
  return decisions;
}
