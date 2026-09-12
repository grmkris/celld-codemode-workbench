import { bufferToHex, sha256Hex } from "../../shared/crypto";
import { HostError } from "../../shared/errors";

export const DEFAULT_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_INVITATION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

export async function hashInvitationToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function normalizeInvitationTtlSeconds(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_INVITATION_TTL_SECONDS;
  }
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new HostError("invalid", "ttlSeconds must be a positive number", 400);
  }
  return Math.min(Math.floor(ttl), MAX_INVITATION_TTL_SECONDS);
}

export function invitationAcceptPath(token: string): string {
  return `/api/invitations/accept?token=${encodeURIComponent(token)}`;
}

export function buildAcceptUrl(origin: string, token: string): string {
  return new URL(invitationAcceptPath(token), origin).toString();
}

export type InvitationRow = {
  id: string;
  team_id: string;
  role: string;
  token_hash: string;
  email_hint: string | null;
  expires_at: number;
  revoked_at: number | null;
  accepted_by: string | null;
  accepted_at: number | null;
  created_by: string;
  created_at: number;
};

export function invitationIsAcceptable(row: InvitationRow, now = Date.now()): boolean {
  if (row.revoked_at != null) return false;
  if (row.accepted_at != null) return false;
  return Number(row.expires_at) > now;
}

export function invitationRejectReason(row: InvitationRow, now = Date.now()): string {
  if (row.revoked_at != null) return "revoked";
  if (row.accepted_at != null) return "already_accepted";
  if (Number(row.expires_at) <= now) return "expired";
  return "invalid";
}
