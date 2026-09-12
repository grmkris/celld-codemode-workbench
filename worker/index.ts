import { validAgentId } from "../shared/ids";
import { HostError } from "../shared/errors";
import { assertOrigin, requireUser, signSession, stripInternalHeaders } from "./auth";
import { configureQuickJSWasm } from "./isolate";
import type { Env } from "./env";
import wasmModule from "./vendor/emscripten-module.wasm";

export { AgentCell } from "./agent-cell";
export { DirectoryCell } from "./directory-cell";
export { IdentityCell } from "./identity-cell";
export { TeamCell } from "./team-cell";
export { TaskCell } from "./task-cell";
export { ProbeCell } from "./probe";

configureQuickJSWasm(wasmModule);

function isLiveProvider(env: Env): boolean {
  const provider = env.MODEL_PROVIDER ?? "fixture";
  if (provider === "alibaba") return Boolean(env.ALIBABA_TOKEN_PLAN_API_KEY);
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY);
  if (provider === "grok") return Boolean(env.XAI_API_KEY);
  return false;
}

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function assetFallback(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return json({ error: "not found" }, 404);
  return env.ASSETS.fetch(request);
}

function modelFor(env: Env): string | undefined {
  if (env.MODEL_PROVIDER === "alibaba") return env.ALIBABA_MODEL ?? "qwen3.8-max";
  if (env.MODEL_PROVIDER === "grok") return env.XAI_MODEL;
  return env.OPENAI_MODEL;
}

function identityStub(env: Env) {
  return env.IDENTITY.get(env.IDENTITY.idFromName("global"));
}

function forwardWithUser(
  request: Request,
  user: { userId: string; ownerId: string },
  extraHeaders?: Record<string, string>,
): Request {
  const forwarded = stripInternalHeaders(request);
  const headers = new Headers(forwarded.headers);
  headers.set("x-celld-user", user.userId);
  headers.set("x-celld-owner", user.ownerId);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(key, value);
  }
  return new Request(forwarded, { headers });
}

function teamStub(env: Env) {
  return env.TEAM.get(env.TEAM.idFromName("global"));
}

function taskStub(env: Env, workspaceKey: string) {
  return env.TASK.get(env.TASK.idFromName(workspaceKey));
}

function forwardTeamPath(
  request: Request,
  user: { userId: string; ownerId: string },
  pathname: string,
): Request {
  return new Request(
    new URL(pathname + new URL(request.url).search, request.url),
    forwardWithUser(request, user),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    request = stripInternalHeaders(request);
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "celld-app-agent",
        celld: "v0.4.1",
        provider: env.MODEL_PROVIDER ?? "fixture",
        model: modelFor(env),
        live: isLiveProvider(env),
        hasAlibabaKey: Boolean(env.ALIBABA_TOKEN_PLAN_API_KEY),
        authFixture: env.AUTH_FIXTURE === "1",
      });
    }

    try {
      if (url.pathname.startsWith("/api/auth")) {
        assertOrigin(request, env);
        return identityStub(env).fetch(request);
      }

      if (request.method === "POST" && url.pathname === "/api/login") {
        assertOrigin(request, env);
        if (env.AUTH_FIXTURE !== "1") {
          return json(
            {
              error: "Shared-secret login removed; use /api/auth/sign-in/email",
              code: "auth_deprecated",
            },
            410,
          );
        }
        const body = (await request.json()) as { ownerId?: string; secret?: string };
        if (body.secret !== env.AUTH_SECRET) {
          return json({ error: "invalid secret" }, 401);
        }
        const ownerId = String(body.ownerId ?? "");
        if (!ownerId) {
          return json({ error: "invalid owner id" }, 400);
        }
        const token = await signSession(env.AUTH_SECRET, ownerId);
        return json({ token, ownerId }, 200, {
          "set-cookie": `celld_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
        });
      }

      assertOrigin(request, env);

      if (request.method === "POST" && url.pathname === "/api/machines/enroll") {
        return teamStub(env).fetch(
          new Request(new URL("/machines/enroll" + url.search, request.url), request),
        );
      }

      const machineApi = url.pathname.match(/^\/api\/machines\/([^/]+)(\/.*)?$/);
      if (machineApi) {
        const rest = `/machines/${machineApi[1]}${machineApi[2] ?? ""}`;
        return teamStub(env).fetch(new Request(new URL(rest + url.search, request.url), request));
      }

      const user = await requireUser(request, env);

      if (url.pathname === "/api/session") {
        return json({
          ownerId: user.ownerId,
          userId: user.userId,
          email: user.email,
          name: user.name,
          provider: env.MODEL_PROVIDER ?? "fixture",
          model: modelFor(env),
          live: isLiveProvider(env),
        });
      }

      if (url.pathname === "/api/probe") {
        const id = env.PROBE.idFromName(`probe:${user.ownerId}:${Date.now()}`);
        return env.PROBE.get(id).fetch(forwardWithUser(request, user));
      }

      if (url.pathname === "/api/chats" || url.pathname.startsWith("/api/chats/")) {
        const rest = url.pathname === "/api/chats" ? "/chats" : url.pathname.slice("/api".length);
        const id = env.DIRECTORY.idFromName(user.ownerId);
        const stub = env.DIRECTORY.get(id);
        const forwarded = new Request(
          new URL(rest + url.search, request.url),
          forwardWithUser(request, user),
        );
        return stub.fetch(forwarded);
      }

      if (url.pathname === "/api/teams/bootstrap-personal") {
        return teamStub(env).fetch(forwardTeamPath(request, user, "/bootstrap-personal"));
      }

      if (url.pathname === "/api/teams" || url.pathname.startsWith("/api/teams/")) {
        const rest = url.pathname === "/api/teams" ? "/teams" : url.pathname.slice("/api".length);
        return teamStub(env).fetch(forwardTeamPath(request, user, rest));
      }

      if (
        url.pathname === "/api/invitations/accept" ||
        url.pathname.startsWith("/api/invitations/")
      ) {
        const rest = url.pathname.slice("/api".length);
        return teamStub(env).fetch(forwardTeamPath(request, user, rest));
      }

      const taskApi = url.pathname.match(
        /^\/api\/teams\/([^/]+)\/conversations\/([^/]+)\/tasks(\/.*)?$/,
      );
      if (taskApi) {
        const teamId = decodeURIComponent(taskApi[1]);
        const conversationId = decodeURIComponent(taskApi[2]);
        const rest = taskApi[3] ?? "";
        const workspaceKey = `team:${teamId}:conv:${conversationId}:tasks`;
        const attemptRest = rest.match(/^\/attempts\/([^/]+)(\/.*)?$/);
        const artifactRest = rest.match(/^\/artifacts\/([^/]+)(\/.*)?$/);
        const pathname = attemptRest
          ? `/attempts/${attemptRest[1]}${attemptRest[2] ?? ""}`
          : artifactRest
            ? `/artifacts/${artifactRest[1]}${artifactRest[2] ?? ""}`
            : `/tasks${rest}`;
        const forwarded = new Request(
          new URL(pathname + url.search, request.url),
          forwardWithUser(request, user),
        );
        return taskStub(env, workspaceKey).fetch(forwarded);
      }

      const match = url.pathname.match(/^\/api\/agents\/([^/]+)(\/.*)?$/);
      if (!match) {
        if (request.method === "GET") return assetFallback(request, env);
        return json({ error: "not found" }, 404);
      }
      const agentId = match[1];
      const rest = match[2] ?? "/snapshot";
      if (!validAgentId(agentId)) return json({ error: "invalid agent id" }, 400);
      const id = env.AGENT.idFromName(`${user.ownerId}:${agentId}`);
      const stub = env.AGENT.get(id);
      const forwarded = new Request(
        new URL(rest + url.search, request.url),
        forwardWithUser(request, user, { "x-celld-agent": agentId }),
      );
      return stub.fetch(forwarded);
    } catch (error) {
      if (error instanceof HostError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
