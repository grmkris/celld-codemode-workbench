import { LIMITS } from "../shared/limits";
import { bytesOf, sha256Hex, stableJson } from "../shared/crypto";
import { newId, validAgentId } from "../shared/ids";
import { HostError } from "../shared/errors";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { Sql } from "./sql";
import { Store } from "./store";
import { executeSnippet, runConversation } from "./runtime";
import { configureQuickJSWasm } from "./isolate";
import type { Env } from "./env";
import { grantedSet, type HostContext } from "./capabilities";
import { cancelDelegation, readDelegationContext } from "./delegation/client";
import { executeApprovedNotification } from "./host/notify";
import { runHost } from "./host/run";
import { assertApprovalCas } from "./commands/approvals";
import { resolveCommandDedup } from "./commands/dedup";
import { shouldAdvanceQueue } from "./commands/queue";
import { evaluateStopFence } from "./commands/stop";
import { COMMAND_KINDS, type CommandEnvelope, type CommandKind } from "./commands/types";
import { chatStreamUrl, readStreamsConfig } from "./streams/config";
import { OutboxPublisher } from "./streams/publisher";
import { proxyStreamRead } from "./streams/proxy";
import wasmModule from "./vendor/emscripten-module.wasm";

configureQuickJSWasm(wasmModule);

export class AgentCell {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly store: Store;
  private abort: AbortController | null = null;
  private currentGeneration = 0;
  private ownerId = "";
  private agentId = "default";

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.store = new Store(new Sql(ctx.storage));
    void this.ctx.blockConcurrencyWhile(async () => {
      this.store.sql.migrate(SCHEMA_SQL, SCHEMA_VERSION);
      await this.armAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ownerId = request.headers.get("x-celld-owner") ?? "";
    const agentId = request.headers.get("x-celld-agent") ?? "default";
    if (!validAgentId(agentId)) {
      return json({ error: "invalid agent id" }, 400);
    }
    this.ownerId = ownerId;
    this.agentId = agentId;

    try {
      if (request.method === "POST" && url.pathname === "/bootstrap") {
        const body = (await request.json().catch(() => ({}))) as { name?: string };
        return this.bootstrap(body);
      }

      if (!this.store.agent()) {
        return json({ error: "chat not found", code: "not_found" }, 404);
      }
      if (this.isArchived() && url.pathname !== "/snapshot" && url.pathname !== "/events") {
        return json({ error: "chat archived", code: "gone" }, 410);
      }

      if (request.method === "GET" && url.pathname === "/snapshot") {
        return json(this.snapshot());
      }
      if (request.method === "GET" && url.pathname === "/events") {
        return await this.events(url);
      }
      if (request.method === "GET" && url.pathname === "/stream") {
        return await this.streamProxy(request);
      }
      if (request.method === "POST" && url.pathname === "/commands") {
        return await this.handleCommand(request, (await request.json()) as CommandEnvelope);
      }
      if (request.method === "POST" && url.pathname === "/archive") {
        return this.markArchived();
      }
      if (request.method === "POST" && url.pathname === "/chat") {
        this.recoverOrContinue();
        return await this.chat(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/stop") {
        this.recoverOrContinue();
        return this.stop(
          (await request.json().catch(() => ({}))) as {
            runId?: string;
            expectedGeneration?: number;
          },
        );
      }
      if (request.method === "POST" && url.pathname === "/reset") {
        return await this.resetWorkspace(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/approvals") {
        return await this.decideApproval(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/snippets/invoke") {
        return await this.invokeSnippet(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/snippets/activate") {
        return this.activateSnippet(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/snippets/rollback") {
        return this.rollbackSnippet(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/schedules") {
        return await this.createSchedule(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/schedules/pause") {
        return await this.pauseSchedule(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/capabilities") {
        return this.setCapabilities(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/delegation/link") {
        return this.linkDelegation(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/inbox") {
        return this.receiveInbox(await request.json());
      }
      if (
        this.env.ALLOW_TEST_HOOKS === "1" &&
        request.method === "POST" &&
        url.pathname === "/test/crash"
      ) {
        return await this.testCrash(await request.json());
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

  async alarm(): Promise<void> {
    this.recoverOrContinue();
    this.flushOutboxAsync();
    await this.processInboxCoordinatorTurns();
    const now = Date.now();
    const due = this.store.dueSchedules(now);
    for (const schedule of due) {
      const dueAt = Number(schedule.next_due_at);
      const existing = this.store.occurrence(String(schedule.id), dueAt);
      if (existing && String(existing.status) !== "dispatched") continue;
      const occurrenceId = this.store.createOccurrence(String(schedule.id), dueAt);
      const again = this.store.occurrence(String(schedule.id), dueAt);
      if (again && String(again.status) !== "dispatched") continue;
      try {
        const snippet = this.store.snippetById(String(schedule.snippet_version_id));
        if (!snippet) throw new Error("pinned snippet missing");
        const granted = JSON.parse(String(this.store.agent()?.granted_capabilities ?? "[]"));
        const required = JSON.parse(String(schedule.pinned_capabilities)) as string[];
        if (required.some((cap) => !granted.includes(cap))) {
          this.store.finishOccurrence(
            occurrenceId,
            "skipped",
            JSON.stringify({ reason: "revoked" }),
          );
        } else {
          const result = await executeSnippet(
            this.runtimeOptions({
              runId: null,
              generation: this.currentGeneration,
              mode: "schedule",
            }),
            String(snippet.name),
            JSON.parse(String(schedule.input)),
            Number(snippet.version),
          );
          this.store.finishOccurrence(occurrenceId, "succeeded", JSON.stringify(result));
          this.store.addEvent(null, "schedule.fired", {
            scheduleId: schedule.id,
            occurrenceId,
            dueAt,
          });
        }
        const recur = schedule.recur_seconds ? Number(schedule.recur_seconds) : null;
        if (recur && String(schedule.status) === "active") {
          this.store.updateSchedule(String(schedule.id), {
            nextDueAt: now + recur * 1000,
            failureCount: 0,
          });
        } else {
          this.store.updateSchedule(String(schedule.id), { status: "cancelled" });
        }
      } catch (error) {
        this.store.finishOccurrence(
          occurrenceId,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
        this.store.updateSchedule(String(schedule.id), {
          failureCount: Number(schedule.failure_count) + 1,
          nextDueAt: now + 60_000,
        });
      }
    }
    await this.armAlarm();
  }

  private bootstrap(body: { name?: string; teamId?: string; conversationId?: string }): Response {
    if (this.isArchived()) {
      return json({ error: "chat archived", code: "gone" }, 410);
    }
    const name = String(body.name ?? this.agentId);
    this.store.ensureAgent(this.ownerId, this.agentId, name);
    if (body.teamId && body.conversationId) {
      this.store.setDelegationContext(String(body.teamId), String(body.conversationId));
    }
    this.pushActivity("idle");
    return json({ ok: true, agentId: this.agentId });
  }

  private linkDelegation(body: { teamId?: string; conversationId?: string }): Response {
    const teamId = String(body.teamId ?? "").trim();
    const conversationId = String(body.conversationId ?? "").trim();
    if (!teamId || !conversationId) {
      throw new HostError("invalid", "teamId and conversationId required", 400);
    }
    this.store.setDelegationContext(teamId, conversationId);
    return json({ ok: true, teamId, conversationId });
  }

  private receiveInbox(body: { eventId?: string; kind?: string; payload?: unknown }): Response {
    const eventId = String(body.eventId ?? "").trim();
    const kind = String(body.kind ?? "").trim();
    if (!eventId || !kind) throw new HostError("invalid", "eventId and kind required", 400);
    const accepted = this.store.enqueueInbox(eventId, kind, body.payload ?? {});
    if (accepted) {
      this.store.addEvent(null, "inbox.enqueued", { eventId, kind });
      this.ctx.waitUntil(this.armAlarm());
    }
    return json({ accepted, eventId, deduped: !accepted });
  }

  private async processInboxCoordinatorTurns(): Promise<void> {
    const pending = this.store.pendingInbox(LIMITS.inboxCoordinatorTurns);
    if (pending.length === 0) return;
    if (this.store.activeRun()) return;

    for (const row of pending) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      const summary = `[system:${row.kind}] task ${String(payload.taskId ?? "unknown")} status=${String(payload.status ?? "unknown")}`;
      this.store.addMessage("system", summary);
      this.store.markInboxProcessed(String(row.event_id));
      this.store.addEvent(null, "inbox.processed", {
        eventId: row.event_id,
        kind: row.kind,
      });
    }
    this.pushActivity("idle");
  }

  private markArchived(): Response {
    this.store.sql.exec(
      "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      "archived",
      "1",
    );
    this.abort?.abort("archived");
    return json({ ok: true, archived: true });
  }

  private isArchived(): boolean {
    const row = this.store.sql.one<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      "archived",
    );
    return row?.value === "1";
  }

  private snapshot() {
    const agent = this.store.agent();
    return {
      agent,
      archived: this.isArchived(),
      activeRun: this.store.activeRun(),
      run: this.store.activeRun() ?? this.store.lastRun(),
      messages: this.store.messages(),
      messageParts: this.store.messageParts(),
      memory: this.store.memoryList(),
      tasks: this.store.tasks(),
      snippets: this.store.snippetVersions(),
      activations: this.store.sql.exec("SELECT * FROM snippet_activation"),
      schedules: this.store.schedules(),
      occurrences: this.store.occurrences(),
      approvals: this.store.pendingApprovals(),
      notifications: this.store.notifications(),
      queue: this.store.queuedItems(),
      queuePaused: this.store.isQueuePaused(),
      latestEventId: this.store.latestEventId(),
      streamOffset: this.store.publisherOffset("chat"),
    };
  }

  private async events(url: URL): Promise<Response> {
    const after = Number(url.searchParams.get("after") ?? "0");
    const wait = url.searchParams.get("wait") === "1";
    let rows = this.store.eventsAfter(after);
    if (wait && rows.length === 0) {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && rows.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        rows = this.store.eventsAfter(after);
      }
    }
    return json({ events: rows, latestEventId: this.store.latestEventId() });
  }

  private async chat(body: { text?: string }): Promise<Response> {
    const commandId = newId("cmd");
    const outcome = await this.admitSend(
      String(body.text ?? "").trim(),
      undefined,
      this.ownerId,
      commandId,
    );
    if (outcome.waitUntil) {
      this.ctx.waitUntil(outcome.waitUntil);
    }
    return json(outcome.body, outcome.status);
  }

  private principalFromRequest(request: Request): string {
    return request.headers.get("x-celld-user") ?? request.headers.get("x-celld-owner") ?? "";
  }

  private async handleCommand(request: Request, body: CommandEnvelope): Promise<Response> {
    this.recoverOrContinue();
    const principal = this.principalFromRequest(request);
    if (!principal) {
      throw new HostError("unauthenticated", "Missing principal", 401);
    }

    const commandId = String(body.commandId ?? "").trim();
    if (!commandId) throw new HostError("invalid", "commandId required");

    const kind = String(body.kind ?? "") as CommandKind;
    if (!COMMAND_KINDS.includes(kind)) {
      throw new HostError("invalid", "Unknown command kind");
    }

    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const payloadHash = await sha256Hex(stableJson({ kind, payload }));
    const existing = this.store.getCommand(principal, commandId);
    const dedup = resolveCommandDedup(
      existing
        ? {
            ...existing,
            outcome_json: existing.outcome_json,
          }
        : null,
      payloadHash,
    );
    if (dedup) return json(dedup.outcome);

    this.store.insertCommand({
      principal,
      commandId,
      kind,
      payloadHash,
      payload: stableJson(payload),
    });

    try {
      const outcome = await this.executeCommand(kind, payload, body, principal);
      this.store.finishCommand(principal, commandId, outcome.body, {
        messageId: outcome.messageId ?? null,
        runId: outcome.runId ?? null,
      });
      if (outcome.waitUntil) {
        this.ctx.waitUntil(outcome.waitUntil);
      }
      return json(outcome.body, outcome.status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof HostError ? error.code : "error";
      const status = error instanceof HostError ? error.status : 500;
      this.store.finishCommand(principal, commandId, { ok: false, code, error: message });
      throw error;
    }
  }

  private async executeCommand(
    kind: CommandKind,
    payload: Record<string, unknown>,
    envelope: CommandEnvelope,
    principal: string,
  ): Promise<{
    body: Record<string, unknown>;
    status: number;
    messageId?: string;
    runId?: string;
    waitUntil?: Promise<void>;
  }> {
    switch (kind) {
      case "send": {
        const admitted = await this.admitSend(
          String(payload.text ?? "").trim(),
          typeof payload.messageId === "string" ? payload.messageId : undefined,
          principal,
          envelope.commandId,
        );
        return admitted;
      }
      case "stop":
        return this.stopCommand(envelope, payload);
      case "cancel_task":
        return await this.cancelTaskCommand(payload);
      case "stop_all":
        return await this.stopAllCommand(envelope, payload);
      case "approve":
        return this.approvalCommand(payload, "approve", principal);
      case "deny":
        return this.approvalCommand(payload, "deny", principal);
      case "resume_queue":
        return this.resumeQueueCommand();
      case "remove_queued":
        return this.removeQueuedCommand(payload);
      case "rename":
        return this.renameCommand(payload);
      case "archive":
        return this.archiveCommand();
      default:
        throw new HostError("invalid", "Unknown command kind");
    }
  }

  private async admitSend(
    text: string,
    messageId: string | undefined,
    author: string,
    commandId: string,
  ): Promise<{
    body: Record<string, unknown>;
    status: number;
    messageId?: string;
    runId?: string;
    waitUntil?: Promise<void>;
  }> {
    if (!text || bytesOf(text) > LIMITS.messageBytes) {
      throw new HostError("invalid", "Message empty or too large");
    }

    const userMessageId = this.store.addMessage("user", text, messageId);
    const active = this.store.activeRun();
    if (active) {
      const queued = this.store.queuedItems();
      if (queued.length >= LIMITS.queuedMessages) {
        throw new HostError("busy", "Queue is full", 409);
      }
      const queueId = this.store.enqueue(text, author, userMessageId);
      this.store.addEvent(String(active.id), "run.queued", {
        id: queueId,
        text,
        author,
        messageId: userMessageId,
        commandId,
      });
      this.pushActivity(String(active.status ?? "running"));
      return {
        status: 202,
        messageId: userMessageId,
        body: {
          ok: true,
          commandId,
          queued: true,
          id: queueId,
          messageId: userMessageId,
          activeRunId: active.id,
          author,
        },
      };
    }

    const admitted = this.store.admitRun(text);
    this.currentGeneration = admitted.generation;
    this.abort = new AbortController();
    this.pushActivity("running");
    return {
      status: 202,
      messageId: userMessageId,
      runId: admitted.id,
      body: {
        ok: true,
        commandId,
        queued: false,
        runId: admitted.id,
        generation: admitted.generation,
        messageId: userMessageId,
      },
      waitUntil: this.process(admitted.id, admitted.generation, text),
    };
  }

  private async cancelTaskCommand(payload: Record<string, unknown>): Promise<{
    body: Record<string, unknown>;
    status: number;
  }> {
    const taskId = String(payload.taskId ?? payload.id ?? "").trim();
    if (!taskId) throw new HostError("invalid", "taskId required", 400);
    const delegation = readDelegationContext(
      this.store,
      String(this.store.agent()?.owner_id ?? this.ownerId),
      String(this.store.agent()?.id ?? this.agentId),
    );
    if (!delegation) {
      throw new HostError(
        "not_configured",
        "Conversation is not linked for task cancellation",
        409,
      );
    }
    const result = await cancelDelegation(this.env, delegation, taskId);
    return { status: 200, body: { ok: true, taskId, result } };
  }

  private async stopAllCommand(
    envelope: CommandEnvelope,
    payload: Record<string, unknown>,
  ): Promise<{ body: Record<string, unknown>; status: number; runId?: string }> {
    const stop = this.stopCommand(envelope, payload);
    const delegation = readDelegationContext(
      this.store,
      String(this.store.agent()?.owner_id ?? this.ownerId),
      String(this.store.agent()?.id ?? this.agentId),
    );
    const cancelled: string[] = [];
    if (delegation) {
      const listResponse = await this.env.TASK.get(
        this.env.TASK.idFromName(
          `team:${delegation.teamId}:conv:${delegation.conversationId}:tasks`,
        ),
      ).fetch(new Request("https://task.internal/tasks", { method: "GET" }));
      if (listResponse.ok) {
        const body = (await listResponse.json()) as {
          tasks?: Array<{ id: string; status: string }>;
        };
        for (const task of body.tasks ?? []) {
          if (["pending", "assigned", "running"].includes(String(task.status))) {
            await cancelDelegation(this.env, delegation, String(task.id)).catch(() => undefined);
            cancelled.push(String(task.id));
            if (cancelled.length >= LIMITS.delegationFanOutMax) break;
          }
        }
      }
    }
    return {
      ...stop,
      body: {
        ...stop.body,
        cancelledTasks: cancelled,
        scope: "conversation",
      },
    };
  }

  private stopCommand(
    envelope: CommandEnvelope,
    payload: Record<string, unknown>,
  ): { body: Record<string, unknown>; status: number; runId?: string } {
    const active = this.store.activeRun();
    const expectedRunId =
      envelope.expectedRunId ?? (typeof payload.runId === "string" ? payload.runId : undefined);
    const expectedGeneration =
      envelope.expectedGeneration ??
      (typeof payload.expectedGeneration === "number" ? payload.expectedGeneration : undefined);

    const fence = evaluateStopFence({
      activeRunId: active ? String(active.id) : null,
      activeGeneration: active ? Number(active.generation) : null,
      expectedRunId,
      expectedGeneration,
    });

    if (!fence.allowed) {
      return {
        status: fence.stale ? 409 : 200,
        body: {
          ok: true,
          status: fence.stale ? "stale" : "idle",
          reason: fence.reason ?? "idle",
        },
      };
    }

    this.store.setQueuePaused(true);
    this.store.requestCancel(String(active!.id));
    this.store.addEvent(String(active!.id), "run.cancel_requested", { queuePaused: true });
    this.abort?.abort("stop");
    this.pushActivity("cancel_requested");
    return {
      status: 200,
      runId: String(active!.id),
      body: {
        ok: true,
        status: "cancel_requested",
        runId: active!.id,
        generation: active!.generation,
        queuePaused: true,
        note: "Already-accepted external effects are not undone",
      },
    };
  }

  private async approvalCommand(
    payload: Record<string, unknown>,
    decision: "approve" | "deny",
    principal: string,
  ): Promise<{ body: Record<string, unknown>; status: number }> {
    const id = String(payload.id ?? "");
    if (!id) throw new HostError("invalid", "Approval id required");
    const operation = this.store.operation(id);
    if (!operation) throw new HostError("not_found", "Approval not found", 404);
    assertApprovalCas(
      String(operation.status),
      typeof payload.expectedStatus === "string" ? payload.expectedStatus : "proposed",
      decision,
    );
    const result = await runHost(
      executeApprovedNotification({
        id,
        decision,
        actorOwnerId: String(this.store.agent()?.owner_id ?? principal),
      }),
      this.store,
      this.approvalContext(),
    );
    if (result.status === "denied") {
      const op = this.store.operation(id);
      if (op && this.store.activeRun()?.status === "waiting_approval") {
        this.store.updateRun(String(op.run_id), {
          status: "completed",
          finished_at: Date.now(),
        });
      }
    }
    if (result.status === "succeeded") {
      const op = this.store.operation(id);
      if (op && this.store.activeRun()?.id === op.run_id) {
        this.store.updateRun(String(op.run_id), {
          status: "completed",
          finished_at: Date.now(),
        });
      }
    }
    const active = this.store.activeRun();
    this.pushActivity(String(active?.status ?? this.store.lastRun()?.status ?? "idle"));
    return { status: 200, body: { ok: true, ...result } };
  }

  private resumeQueueCommand(): {
    body: Record<string, unknown>;
    status: number;
    waitUntil?: Promise<void>;
  } {
    this.store.setQueuePaused(false);
    const started = this.advanceQueueIfReady();
    return {
      status: 200,
      body: { ok: true, queuePaused: false, started: Boolean(started) },
      waitUntil: started?.waitUntil,
    };
  }

  private removeQueuedCommand(payload: Record<string, unknown>): {
    body: Record<string, unknown>;
    status: number;
  } {
    const queueId = String(payload.queueId ?? payload.id ?? "");
    if (!queueId) throw new HostError("invalid", "queueId required");
    const removed = this.store.removeQueued(queueId);
    if (!removed) throw new HostError("not_found", "Queued message not found", 404);
    return { status: 200, body: { ok: true, removed: queueId } };
  }

  private renameCommand(payload: Record<string, unknown>): {
    body: Record<string, unknown>;
    status: number;
  } {
    const name = String(payload.name ?? payload.title ?? "").trim();
    if (!name || bytesOf(name) > LIMITS.chatTitleBytes) {
      throw new HostError("invalid", "Invalid name");
    }
    this.store.renameAgent(name);
    return { status: 200, body: { ok: true, name } };
  }

  private archiveCommand(): { body: Record<string, unknown>; status: number } {
    const result = this.markArchived();
    return { status: result.status, body: { ok: true, archived: true } };
  }

  private async streamProxy(request: Request): Promise<Response> {
    const config = readStreamsConfig(this.env);
    const upstream = chatStreamUrl(this.agentId, config);
    return proxyStreamRead(request, upstream, config.writeToken);
  }

  private outboxPublisher(): OutboxPublisher {
    return new OutboxPublisher(this.store.sql, {
      publisherKey: "chat",
      config: readStreamsConfig(this.env),
    });
  }

  private flushOutboxAsync(): void {
    const publisher = this.outboxPublisher();
    const streamUrl = chatStreamUrl(this.agentId, readStreamsConfig(this.env));
    this.ctx.waitUntil(publisher.flush(streamUrl).catch(() => undefined));
  }

  private recoverOrContinue(): void {
    const active = this.store.activeRun();
    if (active && !this.abort && String(active.status) === "running") {
      this.store.updateRun(String(active.id), {
        status: "failed",
        error: "recovered after isolate loss; journal was not replayed",
        finished_at: Date.now(),
      });
      this.store.addEvent(String(active.id), "run.recovered", {
        reason: "unowned running work was not replayed",
      });
      this.pushActivity("failed");
    }
    this.advanceQueueIfReady();
  }

  private advanceQueueIfReady(): { waitUntil?: Promise<void> } | null {
    const next = this.store.nextQueued();
    const ready = shouldAdvanceQueue({
      queuePaused: this.store.isQueuePaused(),
      hasActiveRun: Boolean(this.store.activeRun()),
      hasQueued: Boolean(next),
    });
    if (!ready || !next) return null;
    this.store.deleteQueued(String(next.id));
    const admitted = this.store.admitRun(String(next.user_text));
    this.currentGeneration = admitted.generation;
    this.abort = new AbortController();
    this.pushActivity("running");
    const waitUntil = this.process(admitted.id, admitted.generation, String(next.user_text));
    this.ctx.waitUntil(waitUntil);
    return { waitUntil };
  }

  private async process(runId: string, generation: number, text: string): Promise<void> {
    try {
      const current = this.store.run(runId);
      if (current && Number(current.cancel_requested)) {
        this.store.confirmTerminated(runId, "cancelled before start");
        this.store.addEvent(runId, "run.terminated", { reason: "cancelled before start" });
        this.pushActivity("terminated");
        return;
      }
      await runConversation(this.runtimeOptions({ runId, generation, mode: "live" }), text);
      const finished = this.store.run(runId);
      this.pushActivity(String(finished?.status ?? "completed"));
    } finally {
      this.abort = null;
      this.flushOutboxAsync();
      const advanced = this.advanceQueueIfReady();
      if (!advanced && !this.store.activeRun()) {
        const last = this.store.lastRun();
        this.pushActivity(String(last?.status ?? "idle"));
      }
      await this.armAlarm();
    }
  }

  private stop(body: { runId?: string; expectedGeneration?: number } = {}): Response {
    const outcome = this.stopCommand(
      {
        commandId: newId("cmd"),
        kind: "stop",
        expectedRunId: body.runId,
        expectedGeneration: body.expectedGeneration,
      },
      body,
    );
    return json(outcome.body, outcome.status);
  }

  private pushActivity(runStatus: string): void {
    const ownerId = String(this.store.agent()?.owner_id ?? this.ownerId);
    const agentId = String(this.store.agent()?.id ?? this.agentId);
    if (!ownerId || !this.env.DIRECTORY) return;
    const last = this.store.sql.one<{ content: string; seq: number; role: string }>(
      "SELECT content, seq, role FROM messages ORDER BY seq DESC LIMIT 1",
    );
    let lastMessage = "";
    if (last) {
      try {
        const parsed = JSON.parse(String(last.content));
        lastMessage =
          typeof parsed === "string"
            ? parsed
            : JSON.stringify(parsed).slice(0, LIMITS.chatPreviewBytes);
      } catch {
        lastMessage = String(last.content).slice(0, LIMITS.chatPreviewBytes);
      }
    }
    const lastSeq = Number(last?.seq ?? 0);
    const payload = {
      chatId: agentId,
      lastMessage,
      lastSeq,
      runStatus,
    };
    this.ctx.waitUntil(
      (async () => {
        try {
          const id = this.env.DIRECTORY.idFromName(ownerId);
          await this.env.DIRECTORY.get(id).fetch(
            new Request("https://directory.internal/activity", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-celld-owner": ownerId,
              },
              body: JSON.stringify(payload),
            }),
          );
        } catch {
          // Index can stay stale until the next chat event.
        }
      })(),
    );
  }

  private approvalContext(): HostContext {
    const ownerId = String(this.store.agent()?.owner_id ?? "");
    return {
      ownerId,
      agentId: String(this.store.agent()?.id ?? "default"),
      runId: this.store.activeRun() ? String(this.store.activeRun()?.id) : null,
      generation: this.currentGeneration,
      executionId: "approval",
      allowed: grantedSet(String(this.store.agent()?.granted_capabilities)),
      mode: "live",
      env: this.env,
      abortSignal: this.abort?.signal ?? new AbortController().signal,
      expectedGeneration: () => this.currentGeneration,
      isCancelRequested: () => false,
      record: (type, payload) => {
        const runId = this.store.activeRun() ? String(this.store.activeRun()?.id) : null;
        this.store.addEvent(runId, type, payload);
      },
      consumeHostCall: () => undefined,
      executeSnippet: async () => {
        throw new HostError("forbidden", "Snippet execution is not available here", 403);
      },
    };
  }

  private async decideApproval(body: { id?: string; decision?: string }): Promise<Response> {
    const result = await runHost(
      executeApprovedNotification({
        id: String(body.id ?? ""),
        decision: String(body.decision ?? ""),
        actorOwnerId: String(this.store.agent()?.owner_id ?? ""),
      }),
      this.store,
      this.approvalContext(),
    );
    if (result.status === "denied") {
      const operation = this.store.operation(String(body.id ?? ""));
      if (operation && this.store.activeRun()?.status === "waiting_approval") {
        this.store.updateRun(String(operation.run_id), {
          status: "completed",
          finished_at: Date.now(),
        });
      }
    }
    if (result.status === "succeeded") {
      const operation = this.store.operation(String(result.id ?? body.id ?? ""));
      if (operation && this.store.activeRun()?.id === operation.run_id) {
        this.store.updateRun(String(operation.run_id), {
          status: "completed",
          finished_at: Date.now(),
        });
      }
    }
    const active = this.store.activeRun();
    this.pushActivity(String(active?.status ?? this.store.lastRun()?.status ?? "idle"));
    return json(result);
  }

  private async invokeSnippet(body: {
    name?: string;
    input?: unknown;
    version?: number;
  }): Promise<Response> {
    const result = await executeSnippet(
      this.runtimeOptions({
        runId: null,
        generation: this.currentGeneration,
        mode: "live",
      }),
      String(body.name),
      body.input ?? {},
      body.version,
    );
    this.store.addEvent(null, "snippet.invoked", { name: body.name, modelUsed: false });
    return json({ result, modelUsed: false });
  }

  private activateSnippet(body: { name?: string; version?: number }): Response {
    const row = this.store.snippetVersion(String(body.name), Number(body.version));
    if (!row) throw new HostError("not_found", "Snippet version not found", 404);
    const tests = row.test_results ? JSON.parse(String(row.test_results)) : null;
    if (!tests?.passed) throw new HostError("not_ready", "Tests have not passed");
    this.store.activate(String(body.name), String(row.id));
    return json({ name: body.name, version: body.version, id: row.id });
  }

  private rollbackSnippet(body: { name?: string; toVersion?: number }): Response {
    const row = this.store.snippetVersion(String(body.name), Number(body.toVersion));
    if (!row) throw new HostError("not_found", "Snippet version not found", 404);
    this.store.activate(String(body.name), String(row.id));
    return json({ name: body.name, version: body.toVersion, id: row.id });
  }

  private async createSchedule(body: {
    name?: string;
    snippetName?: string;
    delaySeconds?: number;
    recurSeconds?: number;
    input?: unknown;
  }): Promise<Response> {
    const versions = this.store.snippetVersions(String(body.snippetName));
    const active = this.store.activation(String(body.snippetName));
    const selected = active ? this.store.snippetById(String(active.version_id)) : versions[0];
    if (!selected) throw new HostError("not_found", "Snippet not found", 404);
    const id = this.store.createSchedule({
      name: String(body.name ?? body.snippetName),
      snippetName: String(body.snippetName),
      snippetVersionId: String(selected.id),
      input: JSON.stringify(body.input ?? {}),
      timezone: "UTC",
      recurSeconds: body.recurSeconds ?? null,
      nextDueAt: Date.now() + (body.delaySeconds ?? 2) * 1000,
      pinnedCapabilities: String(selected.required_capabilities),
    });
    await this.armAlarm();
    return json(this.store.schedule(id));
  }

  private async pauseSchedule(body: { id?: string; paused?: boolean }): Promise<Response> {
    this.store.updateSchedule(String(body.id), {
      status: body.paused === false ? "active" : "paused",
    });
    await this.armAlarm();
    return json(this.store.schedule(String(body.id)));
  }

  private async resetWorkspace(body: { confirm?: boolean }): Promise<Response> {
    if (body.confirm !== true) {
      throw new HostError("invalid", "reset requires confirm=true", 400);
    }
    if (this.store.activeRun()) {
      throw new HostError("conflict", "Stop the run before clearing application state", 409);
    }
    const result = this.store.clearApplicationState();
    this.store.addEvent(null, "workspace.reset", result);
    await this.armAlarm();
    return json(result);
  }

  private setCapabilities(body: { capabilities?: string[] }): Response {
    if (!Array.isArray(body.capabilities)) {
      throw new HostError("invalid", "capabilities must be an array");
    }
    this.store.grantCapabilities(body.capabilities);
    return json({ capabilities: body.capabilities });
  }

  private async testCrash(body: { mode?: string }): Promise<Response> {
    if (body.mode === "before-dispatch") {
      this.store.addEvent(null, "test.crash_before_dispatch", {});
      throw new Error("crash-before-dispatch");
    }
    if (body.mode === "after-effect") {
      const id = `test:${Date.now()}`;
      this.store.insertNotification(id, "demo", "uncertain-before-record");
      this.store.createOperation({
        id,
        ownerId: String(this.store.agent()?.owner_id),
        runId: null,
        executionId: "test",
        capability: "integrations.notify",
        argsJson: stableJson({ channel: "demo", message: "uncertain-before-record" }),
        argsHash: await sha256Hex("uncertain-before-record"),
        snippetVersionId: null,
        expiry: Date.now() + 60_000,
      });
      this.store.updateOperation(id, "uncertain", "crashed after effect");
      throw new Error("crash-after-effect");
    }
    return json({ ok: true });
  }

  private runtimeOptions(input: {
    runId: string | null;
    generation: number;
    mode: "live" | "test" | "schedule";
  }) {
    return {
      store: this.store,
      env: this.env,
      ownerId: String(this.store.agent()?.owner_id ?? ""),
      agentId: String(this.store.agent()?.id ?? "default"),
      runId: input.runId,
      generation: input.generation,
      expectedGeneration: () => this.currentGeneration,
      isCancelRequested: () => {
        if (!input.runId) return false;
        const run = this.store.run(input.runId);
        return Boolean(run && Number(run.cancel_requested));
      },
      abortSignal: this.abort?.signal ?? new AbortController().signal,
      mode: input.mode,
      outbox: this.outboxPublisher(),
    };
  }

  private async armAlarm(): Promise<void> {
    const next = this.store.nextAlarmTime();
    if (next) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
