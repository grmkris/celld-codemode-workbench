import { bufferToHex } from "../../shared/crypto";
import { HostError } from "../../shared/errors";
import { sha256Hex } from "../../shared/crypto";

export const DEFAULT_ENROLLMENT_TTL_SECONDS = 24 * 60 * 60;
export const MAX_ENROLLMENT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function generateEnrollmentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

export async function hashEnrollmentToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function normalizeEnrollmentTtlSeconds(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ENROLLMENT_TTL_SECONDS;
  }
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new HostError("invalid", "ttlSeconds must be a positive number", 400);
  }
  return Math.min(Math.floor(ttl), MAX_ENROLLMENT_TTL_SECONDS);
}

export function generateMachineCredential(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

export async function hashMachineCredential(credential: string): Promise<string> {
  return sha256Hex(credential);
}

export type EnrollmentTokenRow = {
  id: string;
  team_id: string;
  token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  created_by: string;
  created_at: number;
};

export function enrollmentTokenIsUsable(row: EnrollmentTokenRow, now = Date.now()): boolean {
  if (row.revoked_at != null) return false;
  return Number(row.expires_at) > now;
}
