/**
 * TaskCell — one Durable Object per conversation workspace.
 * Owns tasks, attempts, leases, artifacts, and cancellation for that workspace.
 */
import { bytesOf, sha256Hex, stableJson } from "../shared/crypto";
import { HostError } from "../shared/errors";
import {
  ArtifactId,
  AttemptId,
  ConversationId,
  EventId,
  TaskId,
  TeamId,
  taskCellName,
} from "../shared/ids";
import { LIMITS } from "../shared/limits";
import {
  cancellationIsTerminal,
  parseCancellationState,
  transitionCancellation,
  type CancellationState,
} from "./task/cancellation";
import { assertLeaseFence, type AttemptFence } from "./task/lease";
import { TASK_SCHEMA_SQL, TASK_SCHEMA_VERSION } from "./task-schema";
import { Sql } from "./sql";
import type { Env } from "./env";

type TaskRow = {
  id: string;
  team_id: string;
  conversation_id: string;
  title: string;
  status: string;
  cancellation_state: CancellationState;
  workspace_key: string;
  created_at: number;
  updated_at: number;
};

type AttemptRow = AttemptFence & {
  id: string;
  task_id: string;
  machine_id: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
};

export class TaskCell {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly sql: Sql;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = new Sql(ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.sql.migrate(TASK_SCHEMA_SQL, TASK_SCHEMA_VERSION);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/tasks") {
        return this.createTask(await request.json());
      }
      if (request.method === "GET" && url.pathname === "/tasks") {
        return this.listTasks();
      }

      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)(\/.*)?$/);
      if (taskMatch) {
        const taskId = TaskId.parse(decodeURIComponent(taskMatch[1]));
        const rest = taskMatch[2] ?? "";

        if (request.method === "GET" && rest === "") {
          return this.getTask(taskId);
        }
        if (request.method === "POST" && rest === "/cancel") {
          return this.cancelTask(taskId);
        }
        if (request.method === "POST" && rest === "/attempts") {
          return await this.createAttempt(taskId, await request.json());
        }
      }

      const attemptEvents = url.pathname.match(/^\/attempts\/([^/]+)\/events$/);
      if (request.method === "POST" && attemptEvents) {
        return this.submitAttemptEvents(
          AttemptId.parse(decodeURIComponent(attemptEvents[1])),
          await request.json(),
        );
      }

      const attemptToolExec = url.pathname.match(/^\/attempts\/([^/]+)\/tool-exec$/);
      if (request.method === "POST" && attemptToolExec) {
        return await this.toolExec(
          AttemptId.parse(decodeURIComponent(attemptToolExec[1])),
          await request.json(),
        );
      }

      const artifactChunks = url.pathname.match(/^\/artifacts\/([^/]+)\/chunks$/);
      if (request.method === "POST" && artifactChunks) {
        return this.uploadArtifactChunk(
          ArtifactId.parse(decodeURIComponent(artifactChunks[1])),
          await request.json(),
        );
      }

      const artifactApprove = url.pathname.match(/^\/artifacts\/([^/]+)\/approve$/);
      if (request.method === "POST" && artifactApprove) {
        return this.approveArtifact(
          ArtifactId.parse(decodeURIComponent(artifactApprove[1])),
          await request.json(),
        );
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof HostError || (error instanceof Error && error.name === "HostError")) {
        const host = error as HostError;
        return json({ error: host.message, code: host.code }, host.status ?? 400);
      }
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  private createTask(body: { teamId?: string; conversationId?: string; title?: string }): Response {
    const teamId = TeamId.parse(body.teamId);
    const conversationId = ConversationId.parse(body.conversationId);
    const title = normalizeTitle(body.title);
    const now = Date.now();
    const taskId = TaskId.generate();
    const workspaceKey = taskCellName(teamId, conversationId);

    this.sql.exec(
      `INSERT INTO tasks(
         id, team_id, conversation_id, title, status, cancellation_state,
         workspace_key, created_at, updated_at
       ) VALUES(?, ?, ?, ?, 'pending', 'none', ?, ?, ?)`,
      taskId,
      teamId,
      conversationId,
      title,
      workspaceKey,
      now,
      now,
    );

    return json({ task: publicTask(this.task(taskId)!) }, 201);
  }

  private listTasks(): Response {
    const rows = this.sql.exec(
      `SELECT * FROM tasks ORDER BY updated_at DESC, created_at DESC`,
    ) as TaskRow[];
    return json({ tasks: rows.map(publicTask) });
  }

  private getTask(taskId: TaskId): Response {
    const row = this.task(taskId);
    if (!row) throw new HostError("not_found", "Task not found", 404);
    const attempts = this.sql.exec(
      "SELECT * FROM attempts WHERE task_id = ? ORDER BY generation ASC",
      taskId,
    ) as AttemptRow[];
    return json({ task: publicTask(row), attempts: attempts.map(publicAttempt) });
  }

  private cancelTask(taskId: TaskId): Response {
    const row = this.task(taskId);
    if (!row) throw new HostError("not_found", "Task not found", 404);
    if (row.status === "cancelled" || row.status === "succeeded" || row.status === "failed") {
      throw new HostError("conflict", "Task is already terminal", 409);
    }

    const current = parseCancellationState(row.cancellation_state);
    const next = transitionCancellation(current, "requested");
    const now = Date.now();

    this.sql.exec(
      `UPDATE tasks
       SET cancellation_state = ?, status = CASE WHEN status = 'running' THEN status ELSE 'cancelled' END,
           updated_at = ?
       WHERE id = ?`,
      next,
      now,
      taskId,
    );

    return json({ task: publicTask(this.task(taskId)!), cancellationState: next });
  }

  private async createAttempt(
    taskId: TaskId,
    body: { machineId?: string; leaseTtlMs?: number },
  ): Promise<Response> {
    const task = this.task(taskId);
    if (!task) throw new HostError("not_found", "Task not found", 404);

    const active = this.sql.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM attempts
       WHERE task_id IN (SELECT id FROM tasks WHERE workspace_key = ?)
         AND status IN ('pending', 'running')`,
      task.workspace_key,
    );
    if (Number(active?.n ?? 0) > 0) {
      throw new HostError("conflict", "Workspace already has an active attempt", 409);
    }

    const lastGen = this.sql.one<{ generation: number }>(
      "SELECT MAX(generation) AS generation FROM attempts WHERE task_id = ?",
      taskId,
    );
    const generation = Number(lastGen?.generation ?? 0) + 1;
    const attemptId = AttemptId.generate();
    const leaseToken = crypto.randomUUID() + crypto.randomUUID();
    const leaseHash = await sha256Hex(leaseToken);
    const ttlMs = Math.min(Math.max(Number(body.leaseTtlMs ?? 300_000), 30_000), 3_600_000);
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const leaseId = EventId.generate();

    this.sql.transaction(() => {
      this.sql.exec(
        `INSERT INTO attempts(
           id, task_id, generation, status, lease_token_hash, lease_expires_at,
           machine_id, started_at, finished_at, created_at
         ) VALUES(?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, ?)`,
        attemptId,
        taskId,
        generation,
        leaseHash,
        expiresAt,
        body.machineId ?? null,
        now,
      );
      this.sql.exec(
        `INSERT INTO leases(id, attempt_id, token_hash, generation, expires_at, revoked_at, created_at)
         VALUES(?, ?, ?, ?, ?, NULL, ?)`,
        leaseId,
        attemptId,
        leaseHash,
        generation,
        expiresAt,
        now,
      );
      this.sql.exec(
        "UPDATE tasks SET status = 'assigned', updated_at = ? WHERE id = ?",
        now,
        taskId,
      );
    });

    return json(
      {
        attempt: publicAttempt(this.attempt(attemptId)!),
        lease: leaseToken,
        leaseExpiresAt: expiresAt,
        generation,
      },
      201,
    );
  }

  private async submitAttemptEvents(
    attemptId: AttemptId,
    body: {
      lease?: string;
      generation?: number;
      events?: Array<{ kind?: string; payload?: unknown }>;
    },
  ): Promise<Response> {
    const attempt = await this.requireActiveAttempt(attemptId, body.lease, body.generation);
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0) {
      throw new HostError("invalid", "events required", 400);
    }
    if (events.length > 100) {
      throw new HostError("invalid", "Too many events in batch", 400);
    }

    const now = Date.now();
    const lastSeq = this.sql.one<{ seq: number }>(
      "SELECT MAX(seq) AS seq FROM attempt_events WHERE attempt_id = ?",
      attemptId,
    );
    let seq = Number(lastSeq?.seq ?? 0);

    this.sql.transaction(() => {
      for (const event of events) {
        seq += 1;
        const payload = stableJson(event.payload ?? {});
        if (bytesOf(payload) > LIMITS.resultBytes) {
          throw new HostError("invalid", "Event payload too large", 400);
        }
        this.sql.exec(
          `INSERT INTO attempt_events(id, attempt_id, seq, kind, payload_json, created_at)
           VALUES(?, ?, ?, ?, ?, ?)`,
          EventId.generate(),
          attemptId,
          seq,
          String(event.kind ?? "event").slice(0, 64),
          payload,
          now,
        );
      }

      if (attempt.status === "pending") {
        this.sql.exec(
          "UPDATE attempts SET status = 'running', started_at = ? WHERE id = ?",
          now,
          attemptId,
        );
        this.sql.exec(
          `UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?`,
          now,
          attempt.task_id,
        );
      }
    });

    return json({ accepted: events.length, lastSeq: seq });
  }

  private async toolExec(
    attemptId: AttemptId,
    body: {
      lease?: string;
      generation?: number;
      invocationId?: string;
      name?: string;
      args?: unknown;
      argsHash?: string;
      version?: number;
    },
  ): Promise<Response> {
    const attempt = await this.requireActiveAttempt(attemptId, body.lease, body.generation);
    const name = String(body.name ?? "").trim();
    if (!name) throw new HostError("invalid", "Tool name required", 400);

    const task = this.task(TaskId.parse(attempt.task_id))!;
    if (cancellationShouldAbort(task.cancellation_state)) {
      throw new HostError("cancelled", "Task cancellation in progress", 409);
    }

    // Foundation stub — host tools are wired by the runner via this endpoint.
    return json({
      result: {
        ok: true,
        tool: name,
        invocationId: body.invocationId ?? null,
        argsHash: body.argsHash ?? null,
        version: body.version ?? 1,
        attemptId,
        taskId: task.id,
        note: "tool-exec foundation stub",
      },
    });
  }

  private async uploadArtifactChunk(
    artifactId: ArtifactId,
    body: {
      lease?: string;
      generation?: number;
      attemptId?: string;
      name?: string;
      chunkIndex?: number;
      dataB64?: string;
    },
  ): Promise<Response> {
    let artifact = this.sql.one<{ id: string; attempt_id: string; status: string }>(
      "SELECT id, attempt_id, status FROM artifacts WHERE id = ?",
      artifactId,
    );
    if (!artifact && body.attemptId) {
      const attemptId = AttemptId.parse(body.attemptId);
      await this.requireActiveAttempt(attemptId, body.lease, body.generation);
      const now = Date.now();
      this.sql.exec(
        `INSERT INTO artifacts(id, attempt_id, name, status, content_hash, size_bytes, approved_at, created_at)
         VALUES(?, ?, ?, 'uploading', NULL, 0, NULL, ?)`,
        artifactId,
        attemptId,
        String(body.name ?? "workspace.tar").slice(0, 240),
        now,
      );
      artifact = this.sql.one(
        "SELECT id, attempt_id, status FROM artifacts WHERE id = ?",
        artifactId,
      );
    }
    if (!artifact) throw new HostError("not_found", "Artifact not found", 404);

    const attempt = this.attempt(AttemptId.parse(artifact.attempt_id));
    if (!attempt) throw new HostError("not_found", "Attempt not found", 404);
    await this.requireActiveAttempt(
      AttemptId.parse(artifact.attempt_id),
      body.lease,
      body.generation,
    );

    const chunkIndex = Number(body.chunkIndex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new HostError("invalid", "chunkIndex required", 400);
    }
    const dataB64 = String(body.dataB64 ?? "");
    if (!dataB64 || bytesOf(dataB64) > LIMITS.resultBytes) {
      throw new HostError("invalid", "Invalid chunk data", 400);
    }

    const now = Date.now();
    this.sql.exec(
      `INSERT INTO artifact_chunks(artifact_id, chunk_index, data_b64, created_at)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(artifact_id, chunk_index) DO UPDATE SET data_b64 = excluded.data_b64`,
      artifactId,
      chunkIndex,
      dataB64,
      now,
    );
    this.sql.exec(
      "UPDATE artifacts SET size_bytes = size_bytes + ?, status = 'uploading' WHERE id = ?",
      bytesOf(dataB64),
      artifactId,
    );

    return json({ artifactId, chunkIndex, accepted: true });
  }

  private approveArtifact(
    artifactId: ArtifactId,
    body: { approved?: boolean; contentHash?: string },
  ): Response {
    const artifact = this.sql.one<{
      id: string;
      status: string;
    }>("SELECT id, status FROM artifacts WHERE id = ?", artifactId);
    if (!artifact) throw new HostError("not_found", "Artifact not found", 404);

    const now = Date.now();
    const approved = body.approved !== false;
    const status = approved ? "approved" : "rejected";
    this.sql.exec(
      `UPDATE artifacts SET status = ?, content_hash = ?, approved_at = ? WHERE id = ?`,
      status,
      body.contentHash ?? null,
      now,
      artifactId,
    );
    return json({ artifactId, status, approvedAt: now });
  }

  /** Called by TeamCell when a cancel signal is delivered to a machine. */
  signalCancellation(taskId: TaskId): CancellationState {
    const row = this.task(taskId);
    if (!row) throw new HostError("not_found", "Task not found", 404);
    const current = parseCancellationState(row.cancellation_state);
    if (cancellationIsTerminal(current)) return current;
    const next = transitionCancellation(current, "signalled");
    const now = Date.now();
    this.sql.exec(
      "UPDATE tasks SET cancellation_state = ?, updated_at = ? WHERE id = ?",
      next,
      now,
      taskId,
    );
    return next;
  }

  confirmCancellation(taskId: TaskId): CancellationState {
    const row = this.task(taskId);
    if (!row) throw new HostError("not_found", "Task not found", 404);
    const current = parseCancellationState(row.cancellation_state);
    const next = transitionCancellation(current, "confirmed");
    const now = Date.now();
    this.sql.transaction(() => {
      this.sql.exec(
        "UPDATE tasks SET cancellation_state = ?, status = 'cancelled', updated_at = ? WHERE id = ?",
        next,
        now,
        taskId,
      );
      this.sql.exec(
        `UPDATE attempts SET status = 'cancelled', finished_at = ?
         WHERE task_id = ? AND status IN ('pending', 'running')`,
        now,
        taskId,
      );
    });
    return next;
  }

  private async requireActiveAttempt(
    attemptId: AttemptId,
    leaseToken: unknown,
    generation: unknown,
  ): Promise<AttemptRow> {
    const attempt = this.attempt(attemptId);
    if (!attempt) throw new HostError("not_found", "Attempt not found", 404);
    const token = String(leaseToken ?? "");
    if (!token) throw new HostError("invalid", "lease required", 400);
    const gen = Number(generation);
    if (!Number.isFinite(gen)) throw new HostError("invalid", "generation required", 400);
    if (Number(attempt.generation) !== gen) {
      throw new HostError("fenced", "Stale attempt generation", 409);
    }
    const tokenHash = await sha256Hex(token);
    assertLeaseFence(attempt, token, tokenHash);
    return attempt;
  }

  private task(id: TaskId): TaskRow | null {
    return this.sql.one<TaskRow>("SELECT * FROM tasks WHERE id = ?", id);
  }

  private attempt(id: AttemptId): AttemptRow | null {
    return this.sql.one<AttemptRow>("SELECT * FROM attempts WHERE id = ?", id);
  }
}

function cancellationShouldAbort(state: CancellationState): boolean {
  return state === "signalled" || state === "escalated" || state === "confirmed";
}

function normalizeTitle(value: unknown): string {
  const title = String(value ?? "Task").trim() || "Task";
  if (bytesOf(title) > LIMITS.taskTitleBytes) {
    throw new HostError("invalid", "Task title too large", 400);
  }
  return title;
}

function publicTask(row: TaskRow) {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    conversationId: String(row.conversation_id),
    title: String(row.title),
    status: String(row.status),
    cancellationState: String(row.cancellation_state),
    workspaceKey: String(row.workspace_key),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function publicAttempt(row: AttemptRow) {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    generation: Number(row.generation),
    status: String(row.status),
    machineId: row.machine_id ? String(row.machine_id) : null,
    leaseExpiresAt: row.lease_expires_at ? Number(row.lease_expires_at) : null,
    startedAt: row.started_at ? Number(row.started_at) : null,
    finishedAt: row.finished_at ? Number(row.finished_at) : null,
    createdAt: Number(row.created_at),
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
