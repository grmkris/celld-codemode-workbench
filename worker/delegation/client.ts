import { HostError } from "../../shared/errors";
import { taskCellName } from "../../shared/ids";
import type { Env } from "../env";

export interface DelegationContext {
  teamId: string;
  conversationId: string;
  ownerId: string;
  agentId: string;
}

function teamStub(env: Env) {
  return env.TEAM.get(env.TEAM.idFromName("global"));
}

function taskStub(env: Env, teamId: string, conversationId: string) {
  const key = taskCellName(teamId, conversationId);
  return env.TASK.get(env.TASK.idFromName(key));
}

function agentStub(env: Env, ownerId: string, agentId: string) {
  return env.AGENT.get(env.AGENT.idFromName(`${ownerId}:${agentId}`));
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(body.error ?? body.message ?? response.statusText);
    const code = String(body.code ?? "upstream_error");
    throw new HostError(code, message, response.status);
  }
  return body;
}

export async function listEligibleResources(
  env: Env,
  ctx: DelegationContext,
): Promise<{ profiles: unknown[]; machines: unknown[] }> {
  const response = await teamStub(env).fetch(
    new Request(
      `https://team.internal/teams/${encodeURIComponent(ctx.teamId)}/resources/eligible`,
      {
        method: "GET",
        headers: {
          "x-celld-user": ctx.ownerId,
          "x-celld-owner": ctx.ownerId,
        },
      },
    ),
  );
  const body = await parseJson(response);
  return {
    profiles: Array.isArray(body.profiles) ? body.profiles : [],
    machines: Array.isArray(body.machines) ? body.machines : [],
  };
}

export async function submitDelegation(input: {
  env: Env;
  ctx: DelegationContext;
  title: string;
  harness?: string;
  profileId?: string;
  prompt?: string;
}): Promise<{ taskId: string; attemptId: string; assignmentQueued: boolean }> {
  const sourceCellKey = `${input.ctx.ownerId}:${input.ctx.agentId}`;
  const taskResponse = await taskStub(input.env, input.ctx.teamId, input.ctx.conversationId).fetch(
    new Request("https://task.internal/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: input.ctx.teamId,
        conversationId: input.ctx.conversationId,
        title: input.title,
        sourceCellKey,
        harness: input.harness ?? "fixture",
        profileId: input.profileId ?? null,
        prompt: input.prompt ?? null,
      }),
    }),
  );
  const created = await parseJson(taskResponse);
  const task = created.task as Record<string, unknown> | undefined;
  const taskId = String(task?.id ?? "");
  if (!taskId) throw new HostError("upstream_error", "TaskCell did not return task id", 502);

  const attemptResponse = await taskStub(
    input.env,
    input.ctx.teamId,
    input.ctx.conversationId,
  ).fetch(
    new Request(`https://task.internal/tasks/${encodeURIComponent(taskId)}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  const attemptBody = await parseJson(attemptResponse);
  const attemptId = String((attemptBody.attempt as Record<string, unknown> | undefined)?.id ?? "");
  if (!attemptId) throw new HostError("upstream_error", "TaskCell did not return attempt id", 502);

  const queueResponse = await teamStub(input.env).fetch(
    new Request(
      `https://team.internal/teams/${encodeURIComponent(input.ctx.teamId)}/task-assignments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-celld-user": input.ctx.ownerId,
          "x-celld-owner": input.ctx.ownerId,
        },
        body: JSON.stringify({
          taskId,
          attemptId,
          conversationId: input.ctx.conversationId,
          payload: {
            harness: input.harness ?? "fixture",
            profileId: input.profileId ?? null,
            prompt: input.prompt ?? input.title,
            sourceCellKey,
          },
        }),
      },
    ),
  );
  await parseJson(queueResponse);

  return { taskId, attemptId, assignmentQueued: true };
}

export async function inspectDelegation(
  env: Env,
  ctx: DelegationContext,
  taskId: string,
): Promise<unknown> {
  const response = await taskStub(env, ctx.teamId, ctx.conversationId).fetch(
    new Request(`https://task.internal/tasks/${encodeURIComponent(taskId)}`, { method: "GET" }),
  );
  return parseJson(response);
}

export async function cancelDelegation(
  env: Env,
  ctx: DelegationContext,
  taskId: string,
): Promise<unknown> {
  const response = await taskStub(env, ctx.teamId, ctx.conversationId).fetch(
    new Request(`https://task.internal/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  return parseJson(response);
}

export async function listArtifacts(
  env: Env,
  ctx: DelegationContext,
  taskId?: string,
  attemptId?: string,
): Promise<{ items: unknown[] }> {
  const params = new URLSearchParams();
  if (taskId) params.set("taskId", taskId);
  if (attemptId) params.set("attemptId", attemptId);
  const response = await taskStub(env, ctx.teamId, ctx.conversationId).fetch(
    new Request(`https://task.internal/artifacts?${params.toString()}`, { method: "GET" }),
  );
  const body = await parseJson(response);
  return { items: Array.isArray(body.items) ? body.items : [] };
}

export async function readArtifact(
  env: Env,
  ctx: DelegationContext,
  artifactId: string,
  maxBytes: number,
): Promise<{ artifactId: string; dataB64: string; truncated: boolean; sizeBytes: number }> {
  const response = await taskStub(env, ctx.teamId, ctx.conversationId).fetch(
    new Request(
      `https://task.internal/artifacts/${encodeURIComponent(artifactId)}/read?maxBytes=${maxBytes}`,
      { method: "GET" },
    ),
  );
  const body = await parseJson(response);
  return body as {
    artifactId: string;
    dataB64: string;
    truncated: boolean;
    sizeBytes: number;
  };
}

export async function notifyAgentInbox(
  env: Env,
  sourceCellKey: string,
  event: { eventId: string; kind: string; payload: Record<string, unknown> },
): Promise<void> {
  const [ownerId, agentId] = sourceCellKey.split(":");
  if (!ownerId || !agentId) return;
  await agentStub(env, ownerId, agentId).fetch(
    new Request("https://agent.internal/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }),
  );
}

export function readDelegationContext(
  store: { metaValue: (key: string) => string | null },
  ownerId: string,
  agentId: string,
): DelegationContext | null {
  const teamId = store.metaValue("team_id");
  const conversationId = store.metaValue("conversation_id");
  if (!teamId || !conversationId) return null;
  return { teamId, conversationId, ownerId, agentId };
}
