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
import {
  assertLeaseFence,
  clampLeaseTtlMs,
  decideExpiredLeases,
  renewLease,
  type AttemptFence,
} from "./task/lease";
import { notifyAgentInbox } from "./delegation/client";
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
  source_cell_key: string | null;
  harness: string | null;
  profile_id: string | null;
  prompt: string | null;
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
      await this.armLeaseAlarm();
    });
  }

  async alarm(): Promise<void> {
    this.applyLeaseExpiry(Date.now());
    await this.armLeaseAlarm();
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
      if (request.method === "GET" && url.pathname === "/artifacts") {
        return this.listArtifacts(url);
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
        if (request.method === "POST" && rest === "/signal-cancel") {
          return json({ cancellationState: this.signalCancellation(taskId) });
        }
        if (request.method === "POST" && rest === "/complete") {
          return await this.completeTask(taskId, await request.json());
        }
        if (request.method === "POST" && rest === "/attempts") {
          return await this.createAttempt(taskId, await request.json());
        }
      }

      const artifactRead = url.pathname.match(/^\/artifacts\/([^/]+)\/read$/);
      if (request.method === "GET" && artifactRead) {
        return this.readArtifact(ArtifactId.parse(decodeURIComponent(artifactRead[1])), url);
      }

      const attemptEvents = url.pathname.match(/^\/attempts\/([^/]+)\/events$/);
      if (request.method === "POST" && attemptEvents) {
        return this.submitAttemptEvents(
          AttemptId.parse(decodeURIComponent(attemptEvents[1])),
          await request.json(),
        );
      }

      const attemptLeaseRenew = url.pathname.match(/^\/attempts\/([^/]+)\/lease\/renew$/);
      if (request.method === "POST" && attemptLeaseRenew) {
        return await this.renewAttemptLease(
          AttemptId.parse(decodeURIComponent(attemptLeaseRenew[1])),
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

  private createTask(body: {
    teamId?: string;
    conversationId?: string;
    title?: string;
    sourceCellKey?: string;
    harness?: string;
    profileId?: string;
    prompt?: string;
  }): Response {
    const teamId = TeamId.parse(body.teamId);
    const conversationId = ConversationId.parse(body.conversationId);
    const title = normalizeTitle(body.title);
    const now = Date.now();
    const taskId = TaskId.generate();
    const workspaceKey = taskCellName(teamId, conversationId);
    const sourceCellKey = body.sourceCellKey ? String(body.sourceCellKey).slice(0, 240) : null;
    const harness = body.harness ? String(body.harness).slice(0, 64) : null;
    const profileId = body.profileId ? String(body.profileId).slice(0, 128) : null;
    const prompt = body.prompt ? String(body.prompt).slice(0, LIMITS.taskNotesBytes) : null;

    this.sql.exec(
      `INSERT INTO tasks(
         id, team_id, conversation_id, title, status, cancellation_state,
         workspace_key, source_cell_key, harness, profile_id, prompt, created_at, updated_at
       ) VALUES(?, ?, ?, ?, 'pending', 'none', ?, ?, ?, ?, ?, ?, ?)`,
      taskId,
      teamId,
      conversationId,
      title,
      workspaceKey,
      sourceCellKey,
      harness,
      profileId,
      prompt,
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

    const updated = this.task(taskId)!;
    if (updated.status === "cancelled") {
      this.ctx.waitUntil(this.notifyInboxIfNeeded(updated, "task.cancelled"));
    }
    return json({ task: publicTask(updated), cancellationState: next });
  }

  private async completeTask(
    taskId: TaskId,
    body: { status?: string; result?: unknown },
  ): Promise<Response> {
    const row = this.task(taskId);
    if (!row) throw new HostError("not_found", "Task not found", 404);
    const status = String(body.status ?? "succeeded");
    if (!["succeeded", "failed"].includes(status)) {
      throw new HostError("invalid", "status must be succeeded or failed", 400);
    }
    if (row.status === "cancelled" || row.status === "succeeded" || row.status === "failed") {
      throw new HostError("conflict", "Task is already terminal", 409);
    }

    const now = Date.now();
    this.sql.transaction(() => {
      this.sql.exec(
        "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
        status,
        now,
        taskId,
      );
      this.sql.exec(
        `UPDATE attempts SET status = ?, finished_at = ?
         WHERE task_id = ? AND status IN ('pending', 'running')`,
        status === "succeeded" ? "succeeded" : "failed",
        now,
        taskId,
      );
    });

    const updated = this.task(taskId)!;
    await this.notifyInboxIfNeeded(
      updated,
      status === "succeeded" ? "task.completed" : "task.failed",
      body.result,
    );
    return json({ task: publicTask(updated) });
  }

  private listArtifacts(url: URL): Response {
    const taskId = url.searchParams.get("taskId");
    const attemptId = url.searchParams.get("attemptId");
    let rows: Array<Record<string, unknown>> = [];
    if (attemptId) {
      rows = this.sql.exec(
        "SELECT * FROM artifacts WHERE attempt_id = ? ORDER BY created_at ASC LIMIT ?",
        AttemptId.parse(attemptId),
        LIMITS.delegationFanOutMax,
      ) as Array<Record<string, unknown>>;
    } else if (taskId) {
      rows = this.sql.exec(
        `SELECT a.* FROM artifacts a
         JOIN attempts att ON att.id = a.attempt_id
         WHERE att.task_id = ?
         ORDER BY a.created_at ASC LIMIT ?`,
        TaskId.parse(taskId),
        LIMITS.delegationFanOutMax,
      ) as Array<Record<string, unknown>>;
    } else {
      rows = this.sql.exec(
        "SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?",
        LIMITS.delegationFanOutMax,
      ) as Array<Record<string, unknown>>;
    }
    return json({ items: rows.map(publicArtifact) });
  }

  private readArtifact(artifactId: ArtifactId, url: URL): Response {
    const artifact = this.sql.one<{
      id: string;
      size_bytes: number;
      status: string;
    }>("SELECT id, size_bytes, status FROM artifacts WHERE id = ?", artifactId);
    if (!artifact) throw new HostError("not_found", "Artifact not found", 404);

    const maxBytes = Math.min(
      Number(url.searchParams.get("maxBytes") ?? LIMITS.artifactReadBytes),
      LIMITS.artifactReadBytes,
    );
    const chunks = this.sql.exec(
      "SELECT data_b64 FROM artifact_chunks WHERE artifact_id = ? ORDER BY chunk_index ASC",
      artifactId,
    ) as Array<{ data_b64: string }>;

    let dataB64 = "";
    for (const chunk of chunks) {
      if (bytesOf(dataB64) + bytesOf(chunk.data_b64) > maxBytes) break;
      dataB64 += String(chunk.data_b64);
    }
    const truncated = bytesOf(dataB64) < Number(artifact.size_bytes);
    return json({
      artifactId,
      dataB64,
      truncated,
      sizeBytes: Number(artifact.size_bytes),
      status: artifact.status,
    });
  }

  private async notifyInboxIfNeeded(row: TaskRow, kind: string, result?: unknown): Promise<void> {
    const sourceCellKey = row.source_cell_key ? String(row.source_cell_key) : "";
    if (!sourceCellKey || !this.env.AGENT) return;
    const eventId = `${kind}:${row.id}:${row.updated_at}`;
    await notifyAgentInbox(this.env, sourceCellKey, {
      eventId,
      kind,
      payload: {
        taskId: row.id,
        teamId: row.team_id,
        conversationId: row.conversation_id,
        title: row.title,
        status: row.status,
        harness: row.harness,
        result: result ?? null,
      },
    }).catch(() => undefined);
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
    const ttlMs = clampLeaseTtlMs(body.leaseTtlMs);
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

    await this.armLeaseAlarm();

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

  private async renewAttemptLease(
    attemptId: AttemptId,
    body: { lease?: string; generation?: number; ttlMs?: number },
  ): Promise<Response> {
    const attempt = await this.requireActiveAttempt(attemptId, body.lease, body.generation);
    const now = Date.now();
    const leaseRow = this.sql.one<{
      token_hash: string;
      generation: number;
      expires_at: number;
      revoked_at: number | null;
    }>(
      `SELECT token_hash, generation, expires_at, revoked_at FROM leases
       WHERE attempt_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      attemptId,
    );
    if (!leaseRow) throw new HostError("not_found", "Lease not found", 404);

    const renewed = renewLease(leaseRow, now, body.ttlMs);
    this.sql.transaction(() => {
      this.sql.exec(
        "UPDATE attempts SET lease_expires_at = ? WHERE id = ?",
        renewed.expires_at,
        attemptId,
      );
      this.sql.exec(
        `UPDATE leases SET expires_at = ?
         WHERE attempt_id = ? AND revoked_at IS NULL AND generation = ?`,
        renewed.expires_at,
        attemptId,
        attempt.generation,
      );
    });
    await this.armLeaseAlarm();
    return json({
      ok: true,
      attemptId,
      generation: attempt.generation,
      leaseExpiresAt: renewed.expires_at,
    });
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
        const kind = String(event.kind ?? "event").slice(0, 64);
        this.sql.exec(
          `INSERT INTO attempt_events(id, attempt_id, seq, kind, payload_json, created_at)
           VALUES(?, ?, ?, ?, ?, ?)`,
          EventId.generate(),
          attemptId,
          seq,
          kind,
          payload,
          now,
        );

        if (kind === "attempt.cancelled") {
          const task = this.task(TaskId.parse(attempt.task_id));
          if (task) {
            const current = parseCancellationState(task.cancellation_state);
            if (!cancellationIsTerminal(current)) {
              const signalled = transitionCancellation(current, "signalled");
              const confirmed = transitionCancellation(signalled, "confirmed");
              this.sql.exec(
                "UPDATE tasks SET cancellation_state = ?, status = 'cancelled', updated_at = ? WHERE id = ?",
                confirmed,
                now,
                task.id,
              );
              this.sql.exec(
                `UPDATE attempts SET status = 'cancelled', finished_at = ?
                 WHERE id = ? AND status IN ('pending', 'running')`,
                now,
                attemptId,
              );
            }
          }
        }
      }

      if (attempt.status === "pending") {
        const stillActive = this.attempt(attemptId);
        if (stillActive && (stillActive.status === "pending" || stillActive.status === "running")) {
          this.sql.exec(
            "UPDATE attempts SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'",
            now,
            attemptId,
          );
          this.sql.exec(
            `UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status != 'cancelled'`,
            now,
            attempt.task_id,
          );
        }
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

  private applyLeaseExpiry(now: number): void {
    const active = this.sql.exec(
      `SELECT id, task_id, generation, status, lease_expires_at
       FROM attempts
       WHERE status IN ('pending', 'running')`,
    ) as Array<{
      id: string;
      task_id: string;
      generation: number;
      status: string;
      lease_expires_at: number | null;
    }>;
    const decisions = decideExpiredLeases(active, now);
    if (decisions.length === 0) return;

    this.sql.transaction(() => {
      for (const decision of decisions) {
        this.sql.exec(
          `UPDATE attempts SET status = 'lost', finished_at = ? WHERE id = ? AND status IN ('pending', 'running')`,
          now,
          decision.attemptId,
        );
        this.sql.exec(
          "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
          decision.taskStatus === "pending" ? "pending" : "failed",
          now,
          decision.taskId,
        );
        const lastSeq = this.sql.one<{ seq: number }>(
          "SELECT MAX(seq) AS seq FROM attempt_events WHERE attempt_id = ?",
          decision.attemptId,
        );
        this.sql.exec(
          `INSERT INTO attempt_events(id, attempt_id, seq, kind, payload_json, created_at)
           VALUES(?, ?, ?, 'lease.expired', ?, ?)`,
          EventId.generate(),
          decision.attemptId,
          Number(lastSeq?.seq ?? 0) + 1,
          stableJson({ taskId: decision.taskId, taskStatus: decision.taskStatus }),
          now,
        );
        this.sql.exec(
          `UPDATE leases SET revoked_at = ?
           WHERE attempt_id = ? AND revoked_at IS NULL`,
          now,
          decision.attemptId,
        );
      }
    });
  }

  private async armLeaseAlarm(): Promise<void> {
    const active = this.sql.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM attempts WHERE status IN ('pending', 'running')`,
    );
    if (Number(active?.n ?? 0) === 0) return;
    const next = Date.now() + 30_000;
    await this.ctx.storage.setAlarm(next);
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
    sourceCellKey: row.source_cell_key ? String(row.source_cell_key) : null,
    harness: row.harness ? String(row.harness) : null,
    profileId: row.profile_id ? String(row.profile_id) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function publicArtifact(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    attemptId: String(row.attempt_id),
    name: String(row.name),
    status: String(row.status),
    contentHash: row.content_hash ? String(row.content_hash) : null,
    sizeBytes: Number(row.size_bytes ?? 0),
    approvedAt: row.approved_at ? Number(row.approved_at) : null,
    createdAt: Number(row.created_at),
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
