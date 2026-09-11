import { LIMITS } from "../shared/limits";
import { newId } from "../shared/ids";
import { Sql } from "./sql";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "terminated";

export class Store {
  constructor(readonly sql: Sql) {}

  ensureAgent(ownerId: string, agentId: string, name: string): void {
    const existing = this.sql.one("SELECT id FROM agent WHERE id = ?", agentId);
    const now = Date.now();
    const defaultCaps = [
      "inspect",
      "memory",
      "tasks",
      "snippets",
      "schedules",
      "config",
      "integrations",
    ];
    if (existing) {
      const agent = this.agent();
      if (agent) {
        try {
          const caps = JSON.parse(String(agent.granted_capabilities)) as string[];
          if (!caps.includes("integrations")) {
            this.grantCapabilities([...caps, "integrations"]);
          }
        } catch {
          this.grantCapabilities(defaultCaps);
        }
      }
      return;
    }
    this.sql.exec(
      `INSERT INTO agent(id, owner_id, name, preferences, granted_capabilities, created_at, updated_at)
       VALUES(?, ?, ?, '{}', ?, ?, ?)`,
      agentId,
      ownerId,
      name,
      JSON.stringify(defaultCaps),
      now,
      now,
    );
  }

  agent() {
    return this.sql.one<{
      id: string;
      owner_id: string;
      name: string;
      preferences: string;
      granted_capabilities: string;
    }>("SELECT * FROM agent LIMIT 1");
  }

  setPreferences(preferences: string): void {
    this.sql.exec("UPDATE agent SET preferences = ?, updated_at = ?", preferences, Date.now());
  }

  grantCapabilities(capabilities: string[]): void {
    this.sql.exec(
      "UPDATE agent SET granted_capabilities = ?, updated_at = ?",
      JSON.stringify(capabilities),
      Date.now(),
    );
  }

  nextMessageSeq(): number {
    const row = this.sql.one<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM messages");
    return Number(row?.seq ?? 0) + 1;
  }

  addMessage(role: string, content: unknown): string {
    const id = newId("msg");
    this.sql.exec(
      "INSERT INTO messages(id, role, content, created_at, seq) VALUES(?, ?, ?, ?, ?)",
      id,
      role,
      JSON.stringify(content),
      Date.now(),
      this.nextMessageSeq(),
    );
    return id;
  }

  messages() {
    return this.sql.exec(
      "SELECT id, role, content, created_at, seq FROM messages ORDER BY seq ASC",
    );
  }

  lastRun() {
    return this.sql.one<{
      id: string;
      generation: number;
      status: string;
      cancel_requested: number;
      model_used: number;
    }>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1");
  }

  activeRun() {
    return this.sql.one<{
      id: string;
      generation: number;
      status: string;
      cancel_requested: number;
      model_used: number;
    }>(
      "SELECT * FROM runs WHERE status IN ('queued', 'running', 'waiting_approval', 'cancel_requested') ORDER BY created_at DESC LIMIT 1",
    );
  }

  run(id: string) {
    return this.sql.one<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", id);
  }

  enqueue(userText: string): string {
    const id = newId("q");
    this.sql.exec(
      "INSERT INTO run_queue(id, user_text, created_at) VALUES(?, ?, ?)",
      id,
      userText,
      Date.now(),
    );
    return id;
  }

  nextQueued() {
    return this.sql.one<{ id: string; user_text: string }>(
      "SELECT * FROM run_queue ORDER BY created_at ASC LIMIT 1",
    );
  }

  deleteQueued(id: string): void {
    this.sql.exec("DELETE FROM run_queue WHERE id = ?", id);
  }

  admitRun(userText: string): { id: string; generation: number } {
    const last = this.sql.one<{ generation: number }>(
      "SELECT generation FROM runs ORDER BY generation DESC LIMIT 1",
    );
    const generation = Number(last?.generation ?? 0) + 1;
    const id = newId("run");
    this.sql.exec(
      `INSERT INTO runs(id, generation, status, user_text, model_used, cancel_requested, created_at, started_at)
       VALUES(?, ?, 'running', ?, 0, 0, ?, ?)`,
      id,
      generation,
      userText,
      Date.now(),
      Date.now(),
    );
    return { id, generation };
  }

  updateRun(
    id: string,
    patch: Partial<{
      status: RunStatus;
      model_used: number;
      cancel_requested: number;
      error: string | null;
      finished_at: number | null;
    }>,
  ): void {
    const current = this.run(id);
    if (!current) return;
    this.sql.exec(
      `UPDATE runs SET status = ?, model_used = ?, cancel_requested = ?, error = ?, finished_at = ? WHERE id = ?`,
      patch.status ?? current.status,
      patch.model_used ?? current.model_used,
      patch.cancel_requested ?? current.cancel_requested,
      patch.error === undefined ? current.error : patch.error,
      patch.finished_at === undefined ? current.finished_at : patch.finished_at,
      id,
    );
  }

  requestCancel(id: string): void {
    this.sql.exec(
      "UPDATE runs SET status = 'cancel_requested', cancel_requested = 1 WHERE id = ?",
      id,
    );
  }

  confirmTerminated(id: string, error?: string): void {
    this.sql.exec(
      "UPDATE runs SET status = 'terminated', error = ?, finished_at = ? WHERE id = ?",
      error ?? "cancelled",
      Date.now(),
      id,
    );
  }

  memoryGet(key: string) {
    return this.sql.one<{ key: string; value: string; updated_at: number }>(
      "SELECT * FROM memory WHERE key = ?",
      key,
    );
  }

  memoryList(query?: string) {
    if (query) {
      return this.sql.exec(
        "SELECT * FROM memory WHERE key LIKE ? OR value LIKE ? ORDER BY key LIMIT 50",
        `%${query}%`,
        `%${query}%`,
      );
    }
    return this.sql.exec("SELECT * FROM memory ORDER BY key LIMIT 50");
  }

  memoryCount(): number {
    return Number(this.sql.one<{ n: number }>("SELECT COUNT(*) AS n FROM memory")?.n ?? 0);
  }

  memorySet(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO memory(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      key,
      value,
      Date.now(),
    );
  }

  memoryDelete(key: string): void {
    this.sql.exec("DELETE FROM memory WHERE key = ?", key);
  }

  tasks(status?: string) {
    if (status) {
      return this.sql.exec(
        "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT 100",
        status,
      );
    }
    return this.sql.exec("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100");
  }

  task(id: string) {
    return this.sql.one("SELECT * FROM tasks WHERE id = ?", id);
  }

  createTask(title: string, notes?: string): string {
    const id = newId("task");
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO tasks(id, title, status, notes, created_at, updated_at) VALUES(?, ?, 'open', ?, ?, ?)",
      id,
      title,
      notes ?? null,
      now,
      now,
    );
    return id;
  }

  updateTask(id: string, patch: { title?: string; status?: string; notes?: string }): void {
    const current = this.task(id);
    if (!current) return;
    const status = patch.status ?? String(current.status);
    this.sql.exec(
      "UPDATE tasks SET title = ?, status = ?, notes = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      patch.title ?? current.title,
      status,
      patch.notes ?? current.notes,
      Date.now(),
      status === "done" ? Date.now() : null,
      id,
    );
  }

  snippetVersions(name?: string) {
    if (name) {
      return this.sql.exec(
        "SELECT * FROM snippet_versions WHERE name = ? ORDER BY version DESC",
        name,
      );
    }
    return this.sql.exec("SELECT * FROM snippet_versions ORDER BY name, version DESC");
  }

  snippetVersion(name: string, version: number) {
    return this.sql.one(
      "SELECT * FROM snippet_versions WHERE name = ? AND version = ?",
      name,
      version,
    );
  }

  snippetById(id: string) {
    return this.sql.one("SELECT * FROM snippet_versions WHERE id = ?", id);
  }

  nextSnippetVersion(name: string): number {
    const row = this.sql.one<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) AS version FROM snippet_versions WHERE name = ?",
      name,
    );
    return Number(row?.version ?? 0) + 1;
  }

  saveSnippet(row: {
    name: string;
    version: number;
    source: string;
    contentHash: string;
    description: string;
    inputSchema: string;
    outputSchema: string;
    requiredCapabilities: string;
    dependencyVersions: string;
    testResults: string | null;
  }): string {
    const id = newId("snip");
    this.sql.exec(
      `INSERT INTO snippet_versions(id, name, version, source, content_hash, description, input_schema, output_schema, required_capabilities, dependency_versions, test_results, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      row.name,
      row.version,
      row.source,
      row.contentHash,
      row.description,
      row.inputSchema,
      row.outputSchema,
      row.requiredCapabilities,
      row.dependencyVersions,
      row.testResults,
      Date.now(),
    );
    return id;
  }

  setSnippetTests(id: string, testResults: string): void {
    this.sql.exec("UPDATE snippet_versions SET test_results = ? WHERE id = ?", testResults, id);
  }

  activation(name: string) {
    return this.sql.one<{ name: string; version_id: string }>(
      "SELECT * FROM snippet_activation WHERE name = ?",
      name,
    );
  }

  activate(name: string, versionId: string): void {
    this.sql.exec(
      "INSERT INTO snippet_activation(name, version_id, activated_at) VALUES(?, ?, ?) ON CONFLICT(name) DO UPDATE SET version_id = excluded.version_id, activated_at = excluded.activated_at",
      name,
      versionId,
      Date.now(),
    );
  }

  createSchedule(row: {
    name: string;
    snippetName: string;
    snippetVersionId: string;
    input: string;
    timezone: string;
    recurSeconds: number | null;
    nextDueAt: number;
    pinnedCapabilities: string;
  }): string {
    const id = newId("sch");
    this.sql.exec(
      `INSERT INTO schedules(id, name, snippet_name, snippet_version_id, input, timezone, recur_seconds, next_due_at, status, failure_count, pinned_capabilities, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
      id,
      row.name,
      row.snippetName,
      row.snippetVersionId,
      row.input,
      row.timezone,
      row.recurSeconds,
      row.nextDueAt,
      row.pinnedCapabilities,
      Date.now(),
    );
    return id;
  }

  schedules() {
    return this.sql.exec("SELECT * FROM schedules ORDER BY created_at DESC");
  }

  schedule(id: string) {
    return this.sql.one("SELECT * FROM schedules WHERE id = ?", id);
  }

  updateSchedule(
    id: string,
    patch: { status?: string; nextDueAt?: number; failureCount?: number },
  ): void {
    const current = this.schedule(id);
    if (!current) return;
    this.sql.exec(
      "UPDATE schedules SET status = ?, next_due_at = ?, failure_count = ? WHERE id = ?",
      patch.status ?? current.status,
      patch.nextDueAt ?? current.next_due_at,
      patch.failureCount ?? current.failure_count,
      id,
    );
  }

  nextAlarmTime(): number | null {
    const row = this.sql.one<{ next_due_at: number }>(
      "SELECT next_due_at FROM schedules WHERE status = 'active' ORDER BY next_due_at ASC LIMIT 1",
    );
    return row ? Number(row.next_due_at) : null;
  }

  dueSchedules(now: number) {
    return this.sql.exec(
      "SELECT * FROM schedules WHERE status = 'active' AND next_due_at <= ? ORDER BY next_due_at ASC",
      now,
    );
  }

  occurrence(scheduleId: string, dueAt: number) {
    return this.sql.one(
      "SELECT * FROM schedule_occurrences WHERE schedule_id = ? AND due_at = ?",
      scheduleId,
      dueAt,
    );
  }

  createOccurrence(scheduleId: string, dueAt: number): string {
    const id = `${scheduleId}:${dueAt}`;
    this.sql.exec(
      `INSERT OR IGNORE INTO schedule_occurrences(id, schedule_id, due_at, status, started_at)
       VALUES(?, ?, ?, 'dispatched', ?)`,
      id,
      scheduleId,
      dueAt,
      Date.now(),
    );
    return id;
  }

  finishOccurrence(id: string, status: string, result: string): void {
    this.sql.exec(
      "UPDATE schedule_occurrences SET status = ?, finished_at = ?, result = ? WHERE id = ?",
      status,
      Date.now(),
      result,
      id,
    );
  }

  occurrences(scheduleId?: string) {
    if (scheduleId) {
      return this.sql.exec(
        "SELECT * FROM schedule_occurrences WHERE schedule_id = ? ORDER BY due_at DESC LIMIT 50",
        scheduleId,
      );
    }
    return this.sql.exec("SELECT * FROM schedule_occurrences ORDER BY due_at DESC LIMIT 50");
  }

  createOperation(row: {
    id: string;
    ownerId: string;
    runId: string | null;
    executionId: string;
    capability: string;
    argsJson: string;
    argsHash: string;
    snippetVersionId: string | null;
    expiry: number;
  }): void {
    this.sql.exec(
      `INSERT INTO operations(id, owner_id, run_id, execution_id, capability, args_json, args_hash, snippet_version_id, status, expiry, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
      row.id,
      row.ownerId,
      row.runId,
      row.executionId,
      row.capability,
      row.argsJson,
      row.argsHash,
      row.snippetVersionId,
      row.expiry,
      Date.now(),
    );
  }

  operation(id: string) {
    return this.sql.one("SELECT * FROM operations WHERE id = ?", id);
  }

  operationByScope(executionId: string, capability: string, argsHash: string) {
    return this.sql.one(
      "SELECT * FROM operations WHERE execution_id = ? AND capability = ? AND args_hash = ?",
      executionId,
      capability,
      argsHash,
    );
  }

  updateOperation(id: string, status: string, result?: string | null): void {
    this.sql.exec(
      "UPDATE operations SET status = ?, result = ? WHERE id = ?",
      status,
      result ?? null,
      id,
    );
  }

  pendingApprovals() {
    return this.sql.exec(
      "SELECT * FROM operations WHERE status = 'proposed' ORDER BY created_at DESC",
    );
  }

  addEvent(runId: string | null, type: string, payload: unknown): string {
    const eventId = newId("evt");
    this.sql.exec(
      "INSERT INTO events(event_id, run_id, type, payload, created_at) VALUES(?, ?, ?, ?, ?)",
      eventId,
      runId,
      type,
      JSON.stringify(payload),
      Date.now(),
    );
    const count = Number(this.sql.one<{ n: number }>("SELECT COUNT(*) AS n FROM events")?.n ?? 0);
    if (count > LIMITS.eventsRetained) {
      this.sql.exec(
        "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)",
        count - LIMITS.eventsRetained,
      );
    }
    return eventId;
  }

  eventsAfter(after: number, limit = 200) {
    return this.sql.exec("SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?", after, limit);
  }

  latestEventId(): number {
    return Number(
      this.sql.one<{ id: number }>("SELECT COALESCE(MAX(id), 0) AS id FROM events")?.id ?? 0,
    );
  }

  insertNotification(operationId: string, channel: string, message: string): string {
    const existing = this.sql.one<{ id: string }>(
      "SELECT id FROM notifications WHERE operation_id = ?",
      operationId,
    );
    if (existing) return String(existing.id);
    const id = newId("note");
    this.sql.exec(
      "INSERT INTO notifications(id, operation_id, channel, message, created_at) VALUES(?, ?, ?, ?, ?)",
      id,
      operationId,
      channel,
      message,
      Date.now(),
    );
    return id;
  }

  notifications() {
    return this.sql.exec("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50");
  }
}
