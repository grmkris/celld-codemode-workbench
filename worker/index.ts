import { validAgentId, validOwnerId } from "../shared/ids";
import { HostError } from "../shared/errors";
import { requireSession, signSession } from "./auth";
import { configureQuickJSWasm } from "./isolate";
import type { Env } from "./env";
import wasmModule from "./vendor/emscripten-module.wasm";

export { AgentCell } from "./agent-cell";
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "celld-app-agent",
        celld: "v0.4.1",
        provider: env.MODEL_PROVIDER ?? "fixture",
        model:
          env.MODEL_PROVIDER === "alibaba"
            ? (env.ALIBABA_MODEL ?? "qwen3.8-max")
            : env.MODEL_PROVIDER === "grok"
              ? env.XAI_MODEL
              : env.OPENAI_MODEL,
        live: isLiveProvider(env),
        hasAlibabaKey: Boolean(env.ALIBABA_TOKEN_PLAN_API_KEY),
      });
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/login") {
        const body = (await request.json()) as { ownerId?: string; secret?: string };
        if (body.secret !== env.AUTH_SECRET) {
          return json({ error: "invalid secret" }, 401);
        }
        if (!validOwnerId(String(body.ownerId ?? ""))) {
          return json({ error: "invalid owner id" }, 400);
        }
        const token = await signSession(env.AUTH_SECRET, body.ownerId!);
        return json({ token, ownerId: body.ownerId }, 200, {
          "set-cookie": `celld_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
        });
      }

      const session = await requireSession(request, env.AUTH_SECRET);
      if (url.pathname === "/api/session") {
        return json({
          ownerId: session.ownerId,
          provider: env.MODEL_PROVIDER ?? "fixture",
          model:
            env.MODEL_PROVIDER === "alibaba"
              ? (env.ALIBABA_MODEL ?? "qwen3.8-max")
              : env.MODEL_PROVIDER === "grok"
                ? env.XAI_MODEL
                : env.OPENAI_MODEL,
          live: isLiveProvider(env),
        });
      }

      if (url.pathname === "/api/probe") {
        const id = env.PROBE.idFromName(`probe:${session.ownerId}:${Date.now()}`);
        return env.PROBE.get(id).fetch(request);
      }

      const match = url.pathname.match(/^\/api\/agents\/([^/]+)(\/.*)?$/);
      if (!match) {
        if (request.method === "GET") return assetFallback(request, env);
        return json({ error: "not found" }, 404);
      }
      const agentId = match[1];
      const rest = match[2] ?? "/snapshot";
      if (!validAgentId(agentId)) return json({ error: "invalid agent id" }, 400);
      const id = env.AGENT.idFromName(`${session.ownerId}:${agentId}`);
      const stub = env.AGENT.get(id);
      const forwarded = new Request(new URL(rest + url.search, request.url), request);
      forwarded.headers.set("x-celld-owner", session.ownerId);
      forwarded.headers.set("x-celld-agent", agentId);
      return stub.fetch(forwarded);
    } catch (error) {
      if (error instanceof HostError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
