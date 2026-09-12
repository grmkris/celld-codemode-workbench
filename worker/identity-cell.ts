import { betterAuth, type Auth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { generateId } from "@better-auth/core/utils/id";
import { CelldSqliteDialect } from "./auth/sql-dialect";
import { IDENTITY_SCHEMA_SQL, IDENTITY_SCHEMA_VERSION } from "./identity-schema";
import { Sql } from "./sql";
import type { Env } from "./env";

const FIXTURE_PASSWORD = "fixture-pass-change-me";

const FIXTURE_USERS = [
  { id: "alice", email: "alice@example.com", name: "Alice" },
  { id: "bob", email: "bob@example.com", name: "Bob" },
  { id: "carol", email: "carol@example.com", name: "Carol" },
] as const;

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** PBKDF2-SHA256 via WebCrypto — Celld does not implement node:crypto scrypt. */
async function hashPasswordPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `pbkdf2_sha256$100000$${saltB64}$${hashB64}`;
}

async function verifyPasswordPbkdf2(data: { hash: string; password: string }): Promise<boolean> {
  const [algo, iterRaw, saltB64, hashB64] = data.hash.split("$");
  if (algo !== "pbkdf2_sha256" || !iterRaw || !saltB64 || !hashB64) return false;
  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const expected = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(data.password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    expected.length * 8,
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) mismatch |= actual[i]! ^ expected[i]!;
  return mismatch === 0;
}

export class IdentityCell {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly sql: Sql;
  private auth: Auth | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = new Sql(ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.sql.migrate(IDENTITY_SCHEMA_SQL, IDENTITY_SCHEMA_VERSION);
      this.auth = this.createAuth();
      if (this.env.AUTH_FIXTURE === "1") {
        await this.seedFixtureUsers();
      }
    });
  }

  private createAuth(): Auth {
    const secret =
      this.env.BETTER_AUTH_SECRET && this.env.BETTER_AUTH_SECRET.length >= 32
        ? this.env.BETTER_AUTH_SECRET
        : `${this.env.AUTH_SECRET}:celld-better-auth-dev-secret!!`;
    const baseURL = this.env.BETTER_AUTH_URL?.trim() || undefined;
    return betterAuth({
      secret,
      baseURL,
      database: {
        dialect: new CelldSqliteDialect({ storage: this.ctx.storage.sql }),
        type: "sqlite" as const,
        transaction: false,
      },
      advanced: {
        database: {
          // Celld dialect cannot run Better Auth's introspection probes reliably.
          validateSchema: false,
        },
      },
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        minPasswordLength: 8,
        password: {
          hash: hashPasswordPbkdf2,
          verify: verifyPasswordPbkdf2,
        },
      },
      plugins: [bearer()],
    }) as unknown as Auth;
  }

  private authOrThrow(): Auth {
    if (!this.auth) {
      throw new Error("IdentityCell auth not initialized");
    }
    return this.auth;
  }

  private async seedFixtureUsers(): Promise<void> {
    const now = Date.now();
    for (const fixture of FIXTURE_USERS) {
      const existing = this.sql.one<{ id: string }>("SELECT id FROM user WHERE id = ?", fixture.id);
      if (existing) continue;
      const passwordHash = await hashPasswordPbkdf2(FIXTURE_PASSWORD);
      this.sql.exec(
        `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        fixture.id,
        fixture.name,
        fixture.email,
        1,
        null,
        now,
        now,
      );
      this.sql.exec(
        `INSERT INTO account (
           id, accountId, providerId, userId, password, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        generateId(),
        fixture.id,
        "credential",
        fixture.id,
        passwordHash,
        now,
        now,
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const auth = this.authOrThrow();

    if (request.method === "GET" && url.pathname === "/session") {
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
          return json({ error: "unauthenticated", code: "unauthenticated" }, 401);
        }
        return json({
          userId: session.user.id,
          email: session.user.email,
          name: session.user.name,
        });
      } catch {
        return json({ error: "unauthenticated", code: "unauthenticated" }, 401);
      }
    }

    if (url.pathname.startsWith("/api/auth")) {
      try {
        return await auth.handler(request);
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : String(error),
            code: "auth_failed",
          },
          500,
        );
      }
    }

    return json({ error: "not found" }, 404);
  }
}
