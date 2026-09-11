import { betterAuth, type Auth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { hashPassword } from "better-auth/crypto";
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
    const secret = this.env.BETTER_AUTH_SECRET ?? this.env.AUTH_SECRET;
    const baseURL = this.env.BETTER_AUTH_URL?.trim() || undefined;
    return betterAuth({
      secret,
      baseURL,
      database: {
        dialect: new CelldSqliteDialect({ storage: this.ctx.storage.sql }),
        type: "sqlite" as const,
        transaction: true,
      },
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        minPasswordLength: 8,
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
      const passwordHash = await hashPassword(FIXTURE_PASSWORD);
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
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    return json({ error: "not found" }, 404);
  }
}
