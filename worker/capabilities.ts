import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { LIMITS, ALL_CAPABILITIES, type CapabilityName } from "../shared/limits";
import { bytesOf, sha256Hex } from "../shared/crypto";
import { CancelledError, FenceError, HostError } from "../shared/errors";
import type { Store } from "./store";
import { proposeNotification } from "./host/notify";
import { runHost } from "./host/run";

export interface TestScratch {
  memory: Map<string, { key: string; value: string; updated_at: number }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    notes: string | null;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
  }>;
}

export interface HostContext {
  ownerId: string;
  agentId: string;
  runId: string | null;
  generation: number;
  executionId: string;
  allowed: Set<string>;
  mode: "live" | "test" | "schedule";
  scratch?: TestScratch;
  abortSignal: AbortSignal;
  expectedGeneration: () => number;
  isCancelRequested: () => boolean;
  record: (type: string, payload: unknown) => void;
  consumeHostCall: () => void;
  executeSnippet: (
    name: string,
    input: unknown,
    version?: number,
    mode?: "live" | "test" | "schedule",
  ) => Promise<unknown>;
}

function requireCap(ctx: HostContext, name: CapabilityName): void {
  if (ctx.abortSignal.aborted || ctx.isCancelRequested()) {
    throw new CancelledError();
  }
  if (ctx.expectedGeneration() !== ctx.generation) {
    throw new FenceError();
  }
  if (!ctx.allowed.has(name)) {
    throw new HostError(
      "unauthorized_capability",
      `Capability ${name} is not granted in this execution`,
      403,
    );
  }
  ctx.consumeHostCall();
}

function boundString(value: string, max: number, label: string): string {
  if (bytesOf(value) > max) {
    throw new HostError("limit", `${label} exceeds ${max} bytes`);
  }
  return value;
}

const jsonValue = z.unknown();

export function createCapabilityTools(store: Store, ctx: HostContext) {
  const inspect = toolDefinition({
    name: "inspect",
    description: "Inspect agent profile, limits, capabilities, and recent outcomes",
    inputSchema: z.object({}).optional(),
    outputSchema: z.object({
      profile: z.object({
        ownerId: z.string(),
        agentId: z.string(),
        name: z.string(),
        preferences: z.record(z.string(), z.unknown()),
      }),
      limits: z.record(z.string(), z.number()),
      capabilities: z.array(z.string()),
      run: z.unknown(),
      recentEvents: z.array(z.unknown()),
    }),
  }).server(async () => {
    requireCap(ctx, "inspect");
    const agent = store.agent();
    const run = store.activeRun();
    return {
      profile: {
        ownerId: ctx.ownerId,
        agentId: ctx.agentId,
        name: String(agent?.name ?? ctx.agentId),
        preferences: JSON.parse(String(agent?.preferences ?? "{}")),
      },
      limits: LIMITS,
      capabilities: [...ctx.allowed],
      run,
      recentEvents: store.eventsAfter(Math.max(0, store.latestEventId() - 12)).map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.created_at,
      })),
    };
  });

  const memoryGet = toolDefinition({
    name: "memory_get",
    description: "Get one memory value from the agent namespace",
    inputSchema: z.object({ key: z.string() }),
  }).server(async ({ key }) => {
    requireCap(ctx, "memory");
    const safe = boundString(key, LIMITS.memoryKeyBytes, "key");
    if (ctx.mode === "test" && ctx.scratch) {
      return ctx.scratch.memory.get(safe) ?? null;
    }
    return store.memoryGet(safe);
  });

  const memoryList = toolDefinition({
    name: "memory_list",
    description: "List or search memory entries",
    inputSchema: z.object({ query: z.string().optional() }),
  }).server(async ({ query }) => {
    requireCap(ctx, "memory");
    if (ctx.mode === "test" && ctx.scratch) {
      const items = [...ctx.scratch.memory.values()];
      return {
        items: query
          ? items.filter((row) => row.key.includes(query) || row.value.includes(query))
          : items,
      };
    }
    return { items: store.memoryList(query) };
  });

  const memorySet = toolDefinition({
    name: "memory_set",
    description: "Set a memory value in the agent namespace",
    inputSchema: z.object({ key: z.string(), value: z.string() }),
  }).server(async ({ key, value }) => {
    requireCap(ctx, "memory");
    const safeKey = boundString(key, LIMITS.memoryKeyBytes, "key");
    const safeValue = boundString(value, LIMITS.memoryValueBytes, "value");
    if (ctx.mode === "test" && ctx.scratch) {
      ctx.scratch.memory.set(safeKey, {
        key: safeKey,
        value: safeValue,
        updated_at: Date.now(),
      });
      return ctx.scratch.memory.get(safeKey);
    }
    if (store.memoryCount() >= LIMITS.memoryEntries && !store.memoryGet(key)) {
      throw new HostError("limit", "Memory entry limit reached");
    }
    store.memorySet(safeKey, safeValue);
    ctx.record("memory.set", { key });
    return store.memoryGet(key);
  });

  const memoryDelete = toolDefinition({
    name: "memory_delete",
    description: "Delete a memory key",
    inputSchema: z.object({ key: z.string() }),
  }).server(async ({ key }) => {
    requireCap(ctx, "memory");
    if (ctx.mode === "test" && ctx.scratch) {
      ctx.scratch.memory.delete(key);
      return { deleted: key };
    }
    store.memoryDelete(key);
    return { deleted: key };
  });

  const tasksCreate = toolDefinition({
    name: "tasks_create",
    description: "Create an application task",
    inputSchema: z.object({ title: z.string(), notes: z.string().optional() }),
  }).server(async ({ title, notes }) => {
    requireCap(ctx, "tasks");
    if (ctx.mode === "test" && ctx.scratch) {
      const id = `test-task-${ctx.scratch.tasks.length + 1}`;
      const now = Date.now();
      const row = {
        id,
        title: boundString(title, LIMITS.taskTitleBytes, "title"),
        status: "open",
        notes: notes ? boundString(notes, LIMITS.taskNotesBytes, "notes") : null,
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
      ctx.scratch.tasks.push(row);
      return row;
    }
    const open = store.tasks("open");
    if (open.length >= LIMITS.openTasks) {
      throw new HostError("limit", "Open task limit reached");
    }
    const id = store.createTask(
      boundString(title, LIMITS.taskTitleBytes, "title"),
      notes ? boundString(notes, LIMITS.taskNotesBytes, "notes") : undefined,
    );
    ctx.record("tasks.create", { id, title });
    return store.task(id);
  });

  const tasksList = toolDefinition({
    name: "tasks_list",
    description: "List application tasks",
    inputSchema: z.object({ status: z.string().optional() }),
  }).server(async ({ status }) => {
    requireCap(ctx, "tasks");
    if (ctx.mode === "test" && ctx.scratch) {
      return {
        items: status
          ? ctx.scratch.tasks.filter((row) => row.status === status)
          : ctx.scratch.tasks,
      };
    }
    return { items: store.tasks(status) };
  });

  const tasksUpdate = toolDefinition({
    name: "tasks_update",
    description: "Update a task",
    inputSchema: z.object({
      id: z.string(),
      title: z.string().optional(),
      notes: z.string().optional(),
      status: z.string().optional(),
    }),
  }).server(async (input) => {
    requireCap(ctx, "tasks");
    if (ctx.mode === "test" && ctx.scratch) {
      const row = ctx.scratch.tasks.find((item) => item.id === input.id);
      if (!row) throw new HostError("not_found", "Task not found", 404);
      if (input.title) row.title = input.title;
      if (input.notes) row.notes = input.notes;
      if (input.status) row.status = input.status;
      row.updated_at = Date.now();
      return row;
    }
    if (!store.task(input.id)) throw new HostError("not_found", "Task not found", 404);
    store.updateTask(input.id, input);
    return store.task(input.id);
  });

  const tasksComplete = toolDefinition({
    name: "tasks_complete",
    description: "Mark a task complete",
    inputSchema: z.object({ id: z.string() }),
  }).server(async ({ id }) => {
    requireCap(ctx, "tasks");
    store.updateTask(id, { status: "done" });
    return store.task(id);
  });

  const snippetsSearch = toolDefinition({
    name: "snippets_search",
    description: "Search saved snippet versions",
    inputSchema: z.object({ query: z.string().optional() }),
  }).server(async ({ query }) => {
    requireCap(ctx, "snippets");
    const rows = store.snippetVersions();
    const items = query
      ? rows.filter(
          (row) => String(row.name).includes(query) || String(row.description).includes(query),
        )
      : rows;
    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        description: row.description,
        requiredCapabilities: JSON.parse(String(row.required_capabilities)),
        testResults: row.test_results ? JSON.parse(String(row.test_results)) : null,
      })),
    };
  });

  const snippetsInspect = toolDefinition({
    name: "snippets_inspect",
    description: "Inspect a snippet version and activation pointer",
    inputSchema: z.object({ name: z.string(), version: z.number().optional() }),
  }).server(async ({ name, version }) => {
    requireCap(ctx, "snippets");
    const versions = store.snippetVersions(name);
    const active = store.activation(name);
    const selected = version
      ? store.snippetVersion(name, version)
      : active
        ? store.snippetById(String(active.version_id))
        : versions[0];
    return { selected, versions, active };
  });

  const snippetsSave = toolDefinition({
    name: "snippets_save",
    description: "Save an immutable snippet version. Does not activate it.",
    inputSchema: z.object({
      name: z.string(),
      source: z.string(),
      description: z.string(),
      requiredCapabilities: z.array(z.string()).optional(),
      inputSchema: jsonValue.optional(),
      outputSchema: jsonValue.optional(),
      tests: z.array(z.object({ name: z.string(), input: jsonValue.optional() })).optional(),
    }),
  }).server(async (input) => {
    requireCap(ctx, "snippets");
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(input.name)) {
      throw new HostError("invalid", "Snippet name must be snake_case");
    }
    boundString(input.source, LIMITS.snippetSourceBytes, "source");
    const names = new Set(store.snippetVersions().map((row) => String(row.name)));
    if (!names.has(input.name) && names.size >= LIMITS.snippetNames) {
      throw new HostError("limit", "Snippet name limit reached");
    }
    const required = (input.requiredCapabilities ?? ["memory", "tasks"]).filter((cap) =>
      (ALL_CAPABILITIES as readonly string[]).includes(cap),
    );
    const extra = required.filter((cap) => !ctx.allowed.has(cap));
    if (extra.length && ctx.mode !== "live") {
      throw new HostError("unauthorized_capability", `Cannot request ${extra.join(",")}`);
    }
    const version = store.nextSnippetVersion(input.name);
    const contentHash = await sha256Hex(input.source);
    const id = store.saveSnippet({
      name: input.name,
      version,
      source: input.source,
      contentHash,
      description: input.description,
      inputSchema: JSON.stringify(input.inputSchema ?? { type: "object" }),
      outputSchema: JSON.stringify(input.outputSchema ?? { type: "object" }),
      requiredCapabilities: JSON.stringify(required),
      dependencyVersions: "[]",
      testResults: null,
    });
    ctx.record("snippets.save", { id, name: input.name, version, contentHash });
    return { id, name: input.name, version, contentHash, requiredCapabilities: required };
  });

  const snippetsTest = toolDefinition({
    name: "snippets_test",
    description: "Run snippet tests in a fixture context with no live external effects",
    inputSchema: z.object({ name: z.string(), version: z.number() }),
  }).server(async ({ name, version }) => {
    requireCap(ctx, "snippets");
    const row = store.snippetVersion(name, version);
    if (!row) throw new HostError("not_found", "Snippet version not found", 404);
    const required = JSON.parse(String(row.required_capabilities)) as string[];
    if (required.includes("integrations")) {
      const results = {
        passed: false,
        results: [
          {
            name: "no-live-effects",
            passed: false,
            error: "Protected capabilities cannot run in snippet tests",
          },
        ],
      };
      store.setSnippetTests(String(row.id), JSON.stringify(results));
      return results;
    }
    try {
      const value = await ctx.executeSnippet(name, {}, version, "test");
      const results = { passed: true, results: [{ name: "default", passed: true, value }] };
      store.setSnippetTests(String(row.id), JSON.stringify(results));
      ctx.record("snippets.test", { name, version, passed: true });
      return results;
    } catch (error) {
      const results = {
        passed: false,
        results: [
          {
            name: "default",
            passed: false,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      };
      store.setSnippetTests(String(row.id), JSON.stringify(results));
      ctx.record("snippets.test", { name, version, passed: false });
      return results;
    }
  });

  const snippetsActivate = toolDefinition({
    name: "snippets_activate",
    description: "Activate a tested snippet version",
    inputSchema: z.object({ name: z.string(), version: z.number() }),
  }).server(async ({ name, version }) => {
    requireCap(ctx, "snippets");
    const row = store.snippetVersion(name, version);
    if (!row) throw new HostError("not_found", "Snippet version not found", 404);
    const tests = row.test_results ? JSON.parse(String(row.test_results)) : null;
    if (!tests?.passed) {
      throw new HostError("not_ready", "Snippet must pass tests before activation");
    }
    const required = JSON.parse(String(row.required_capabilities)) as string[];
    if (required.includes("integrations")) {
      throw new HostError(
        "approval_required",
        "Protected capability expansion cannot auto-activate",
      );
    }
    store.activate(name, String(row.id));
    ctx.record("snippets.activate", { name, version, id: row.id });
    return { name, version, id: row.id };
  });

  const snippetsInvoke = toolDefinition({
    name: "snippets_invoke",
    description: "Invoke the pinned or specified snippet version",
    inputSchema: z.object({
      name: z.string(),
      input: jsonValue.optional(),
      version: z.number().optional(),
    }),
  }).server(async ({ name, input, version }) => {
    requireCap(ctx, "snippets");
    return ctx.executeSnippet(name, input ?? {}, version);
  });

  const snippetsRollback = toolDefinition({
    name: "snippets_rollback",
    description: "Point activation at a previous version",
    inputSchema: z.object({ name: z.string(), toVersion: z.number() }),
  }).server(async ({ name, toVersion }) => {
    requireCap(ctx, "snippets");
    const row = store.snippetVersion(name, toVersion);
    if (!row) throw new HostError("not_found", "Snippet version not found", 404);
    store.activate(name, String(row.id));
    ctx.record("snippets.rollback", { name, toVersion });
    return { name, version: toVersion, id: row.id };
  });

  const schedulesCreate = toolDefinition({
    name: "schedules_create",
    description: "Create a one-shot or recurring snippet schedule",
    inputSchema: z.object({
      name: z.string(),
      snippetName: z.string(),
      version: z.number().optional(),
      input: jsonValue.optional(),
      delaySeconds: z.number().int().positive().optional(),
      recurSeconds: z.number().int().positive().optional(),
      timezone: z.string().optional(),
    }),
  }).server(async (input) => {
    requireCap(ctx, "schedules");
    const versions = store.snippetVersions(input.snippetName);
    const active = store.activation(input.snippetName);
    const selected = input.version
      ? store.snippetVersion(input.snippetName, input.version)
      : active
        ? store.snippetById(String(active.version_id))
        : versions[0];
    if (!selected) throw new HostError("not_found", "No snippet version to schedule", 404);
    const delay = (input.delaySeconds ?? 3) * 1000;
    const id = store.createSchedule({
      name: input.name,
      snippetName: input.snippetName,
      snippetVersionId: String(selected.id),
      input: JSON.stringify(input.input ?? {}),
      timezone: input.timezone ?? "UTC",
      recurSeconds: input.recurSeconds ?? null,
      nextDueAt: Date.now() + delay,
      pinnedCapabilities: String(selected.required_capabilities),
    });
    ctx.record("schedules.create", { id, snippet: input.snippetName });
    return store.schedule(id);
  });

  const schedulesInspect = toolDefinition({
    name: "schedules_inspect",
    description: "Inspect schedules and occurrences",
    inputSchema: z.object({ id: z.string().optional() }),
  }).server(async ({ id }) => {
    requireCap(ctx, "schedules");
    if (id) {
      return { schedule: store.schedule(id), occurrences: store.occurrences(id) };
    }
    return { schedules: store.schedules(), occurrences: store.occurrences() };
  });

  const schedulesPause = toolDefinition({
    name: "schedules_pause",
    description: "Pause or resume a schedule",
    inputSchema: z.object({ id: z.string(), paused: z.boolean() }),
  }).server(async ({ id, paused }) => {
    requireCap(ctx, "schedules");
    store.updateSchedule(id, { status: paused ? "paused" : "active" });
    return store.schedule(id);
  });

  const schedulesCancel = toolDefinition({
    name: "schedules_cancel",
    description: "Cancel a schedule",
    inputSchema: z.object({ id: z.string() }),
  }).server(async ({ id }) => {
    requireCap(ctx, "schedules");
    store.updateSchedule(id, { status: "cancelled" });
    return store.schedule(id);
  });

  const configGet = toolDefinition({
    name: "config_get",
    description: "Read allowed behavioral preferences",
    inputSchema: z.object({}).optional(),
  }).server(async () => {
    requireCap(ctx, "config");
    const agent = store.agent();
    return {
      preferences: JSON.parse(String(agent?.preferences ?? "{}")),
      immutable: {
        ownerId: ctx.ownerId,
        capabilities: [...ctx.allowed],
        limits: LIMITS,
      },
    };
  });

  const configUpdate = toolDefinition({
    name: "config_update",
    description: "Update allowed behavioral preferences. Cannot raise privileges.",
    inputSchema: z.object({
      tone: z.string().optional(),
      timezone: z.string().optional(),
      summaryStyle: z.string().optional(),
    }),
  }).server(async (input) => {
    requireCap(ctx, "config");
    const current = JSON.parse(String(store.agent()?.preferences ?? "{}"));
    const next = {
      tone: input.tone ?? current.tone ?? "concise",
      timezone: input.timezone ?? current.timezone ?? "UTC",
      summaryStyle: input.summaryStyle ?? current.summaryStyle ?? "short",
    };
    const encoded = JSON.stringify(next);
    if (bytesOf(encoded) > LIMITS.preferencesBytes) {
      throw new HostError("limit", "Preferences too large");
    }
    store.setPreferences(encoded);
    return { preferences: next };
  });

  const integrationsNotify = toolDefinition({
    name: "integrations_notify",
    description: "Request a protected demo notification. Requires host approval.",
    inputSchema: z.object({
      channel: z.string(),
      message: z.string(),
    }),
  }).server(async ({ channel, message }) => {
    return runHost(proposeNotification({ channel, message }), store, ctx);
  });

  return [
    inspect,
    memoryGet,
    memoryList,
    memorySet,
    memoryDelete,
    tasksCreate,
    tasksList,
    tasksUpdate,
    tasksComplete,
    snippetsSearch,
    snippetsInspect,
    snippetsSave,
    snippetsTest,
    snippetsActivate,
    snippetsInvoke,
    snippetsRollback,
    schedulesCreate,
    schedulesInspect,
    schedulesPause,
    schedulesCancel,
    configGet,
    configUpdate,
    integrationsNotify,
  ];
}

export function grantedSet(raw: string | null | undefined): Set<string> {
  try {
    return new Set(JSON.parse(raw ?? "[]") as string[]);
  } catch {
    return new Set([
      "inspect",
      "memory",
      "tasks",
      "snippets",
      "schedules",
      "config",
      "integrations",
    ]);
  }
}

export function narrowCapabilities(parent: Set<string>, required: string[]): Set<string> {
  const next = new Set<string>();
  for (const cap of required) {
    if (parent.has(cap)) next.add(cap);
    else {
      throw new HostError(
        "policy_escalation",
        `Snippet requested ${cap}, which is outside the parent capability set`,
        403,
      );
    }
  }
  return next;
}
