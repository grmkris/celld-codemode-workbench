import { hmacSha256Hex } from "../shared/crypto";
import { validOwnerId } from "../shared/ids";
import { HostError } from "../shared/errors";
import type { Env } from "./env";

export interface Session {
  ownerId: string;
  exp: number;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  ownerId: string;
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

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

/** @deprecated Prefer requireUser for Better Auth sessions. */
export async function requireSession(request: Request, secret: string): Promise<Session> {
  return verifySession(secret, readBearer(request));
}

export function stripInternalHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  const keys = Array.from(headers.keys());
  for (const key of keys) {
    if (key.toLowerCase().startsWith("x-celld-")) {
      headers.delete(key);
    }
  }
  return new Request(request, { headers });
}

function requestHost(request: Request): string {
  return new URL(request.url).host;
}

function headerHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function assertOrigin(request: Request, _env: Env): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  const originHost =
    headerHost(request.headers.get("origin")) ?? headerHost(request.headers.get("referer"));
  if (!originHost) {
    return;
  }
  if (originHost !== requestHost(request)) {
    throw new HostError("forbidden", "Origin mismatch", 403);
  }
}

function resolveOwnerId(userId: string): string {
  if (validOwnerId(userId)) return userId;
  throw new HostError("invalid_owner", "Invalid owner id", 400);
}

async function identitySession(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const id = env.IDENTITY.idFromName("global");
  const response = await env.IDENTITY.get(id).fetch(
    new Request(new URL("/session", request.url), { headers: request.headers }),
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { userId?: string; email?: string; name?: string };
  if (!body.userId || !body.email || !body.name) return null;
  return {
    userId: body.userId,
    email: body.email,
    name: body.name,
    ownerId: resolveOwnerId(body.userId),
  };
}

export async function requireUser(request: Request, env: Env): Promise<AuthenticatedUser> {
  const session = await identitySession(request, env);
  if (session) return session;

  if (env.AUTH_FIXTURE === "1") {
    const legacy = await verifySession(env.AUTH_SECRET, readBearer(request));
    return {
      userId: legacy.ownerId,
      email: `${legacy.ownerId}@example.com`,
      name: legacy.ownerId,
      ownerId: legacy.ownerId,
    };
  }

  throw new HostError("unauthenticated", "Missing session", 401);
}
