import { hmacSha256Hex } from "../shared/crypto";
import { validOwnerId } from "../shared/ids";
import { HostError } from "../shared/errors";

export interface Session {
  ownerId: string;
  exp: number;
}

function encodePayload(session: Session): string {
  return btoa(JSON.stringify(session))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodePayload(value: string): Session {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return JSON.parse(atob(padded + pad)) as Session;
}

export async function signSession(
  secret: string,
  ownerId: string,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
): Promise<string> {
  if (!validOwnerId(ownerId)) {
    throw new HostError("invalid_owner", "Invalid owner id");
  }
  const payload = encodePayload({ ownerId, exp: Date.now() + ttlMs });
  const signature = await hmacSha256Hex(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySession(secret: string, token: string | null): Promise<Session> {
  if (!token) throw new HostError("unauthenticated", "Missing session", 401);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw new HostError("unauthenticated", "Malformed session", 401);
  }
  const expected = await hmacSha256Hex(secret, payload);
  if (expected.length !== signature.length) {
    throw new HostError("unauthenticated", "Invalid session", 401);
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw new HostError("unauthenticated", "Invalid session", 401);
  }
  const session = decodePayload(payload);
  if (!validOwnerId(session.ownerId) || session.exp < Date.now()) {
    throw new HostError("unauthenticated", "Session expired", 401);
  }
  return session;
}

export function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)celld_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireSession(request: Request, secret: string): Promise<Session> {
  return verifySession(secret, readBearer(request));
}
