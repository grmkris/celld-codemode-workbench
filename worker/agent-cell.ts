import { LIMITS } from "../shared/limits";
import { bytesOf, sha256Hex, stableJson } from "../shared/crypto";
import { validAgentId } from "../shared/ids";
import { HostError } from "../shared/errors";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { Sql } from "./sql";
import { Store } from "./store";
import { executeSnippet, runConversation } from "./runtime";
import { configureQuickJSWasm } from "./isolate";
import type { Env } from "./env";
import { grantedSet, type HostContext } from "./capabilities";
import { executeApprovedNotification } from "./host/notify";
import { runHost } from "./host/run";
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
      if (request.method !== "GET") this.recoverOrContinue();

      if (request.method === "GET" && url.pathname === "/snapshot") {
        return json(this.snapshot());
      }
      if (request.method === "GET" && url.pathname === "/events") {
        return await this.events(url);
      }
      if (request.method === "POST" && url.pathname === "/archive") {
        return this.markArchived();
      }
      if (request.method === "POST" && url.pathname === "/chat") {
        return await this.chat(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/stop") {
        return this.stop();
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

  private bootstrap(body: { name?: string }): Response {
    if (this.isArchived()) {
      return json({ error: "chat archived", code: "gone" }, 410);
    }
    const name = String(body.name ?? this.agentId);
    this.store.ensureAgent(this.ownerId, this.agentId, name);
    this.pushActivity("idle");
    return json({ ok: true, agentId: this.agentId });
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
      memory: this.store.memoryList(),
      tasks: this.store.tasks(),
      snippets: this.store.snippetVersions(),
      activations: this.store.sql.exec("SELECT * FROM snippet_activation"),
      schedules: this.store.schedules(),
      occurrences: this.store.occurrences(),
      approvals: this.store.pendingApprovals(),
      notifications: this.store.notifications(),
      latestEventId: this.store.latestEventId(),
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
    const text = String(body.text ?? "").trim();
    if (!text || bytesOf(text) > LIMITS.messageBytes) {
      throw new HostError("invalid", "Message empty or too large");
    }
    const active = this.store.activeRun();
    if (active) {
      const queued = this.store.sql.exec("SELECT id FROM run_queue");
      if (queued.length >= LIMITS.queuedMessages) {
        throw new HostError("busy", "Queue is full", 409);
      }
      const id = this.store.enqueue(text);
      this.store.addEvent(String(active.id), "run.queued", { id, text });
      this.pushActivity(String(active.status ?? "running"));
      return json({ queued: true, id, activeRunId: active.id }, 202);
    }
    const admitted = this.store.admitRun(text);
    this.currentGeneration = admitted.generation;
    this.abort = new AbortController();
    this.pushActivity("running");
    this.ctx.waitUntil(this.process(admitted.id, admitted.generation, text));
    return json({ queued: false, runId: admitted.id, generation: admitted.generation }, 202);
  }

  private recoverOrContinue(): void {
    const active = this.store.activeRun();
    if (!active) return;
    if (this.abort) return;
    if (String(active.status) === "running") {
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
    const next = this.store.nextQueued();
    if (next && !this.store.activeRun()) {
      this.store.deleteQueued(next.id);
      const admitted = this.store.admitRun(next.user_text);
      this.currentGeneration = admitted.generation;
      this.abort = new AbortController();
      this.pushActivity("running");
      this.ctx.waitUntil(this.process(admitted.id, admitted.generation, next.user_text));
    }
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
      const next = this.store.nextQueued();
      if (next && !this.store.activeRun()) {
        this.store.deleteQueued(next.id);
        const admitted = this.store.admitRun(next.user_text);
        this.currentGeneration = admitted.generation;
        this.abort = new AbortController();
        this.pushActivity("running");
        this.ctx.waitUntil(this.process(admitted.id, admitted.generation, next.user_text));
      } else if (!this.store.activeRun()) {
        const last = this.store.lastRun();
        this.pushActivity(String(last?.status ?? "idle"));
      }
      await this.armAlarm();
    }
  }

  private stop(): Response {
    const active = this.store.activeRun();
    if (!active) return json({ status: "idle" });
    this.store.requestCancel(String(active.id));
    this.store.addEvent(String(active.id), "run.cancel_requested", {});
    this.abort?.abort("stop");
    this.pushActivity("cancel_requested");
    return json({
      status: "cancel_requested",
      runId: active.id,
      note: "Already-accepted external effects are not undone",
    });
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
