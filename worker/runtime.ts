import { chat, maxIterations } from "@tanstack/ai";
import { createCodeMode } from "@tanstack/ai-code-mode";
import { LIMITS } from "../shared/limits";
import { newId } from "../shared/ids";
import { redactValue } from "../shared/redact";
import { ApprovalRequiredError, CancelledError, FenceError, HostError } from "../shared/errors";
import { createFuelQuickJSDriver } from "./isolate";
import {
  createCapabilityTools,
  grantedSet,
  narrowCapabilities,
  type HostContext,
  type TestScratch,
} from "./capabilities";
import { createFixtureAdapter, createLiveAdapter } from "./model";
import type { Store } from "./store";
import type { Env } from "./env";

export interface RuntimeOptions {
  store: Store;
  env: Env;
  ownerId: string;
  agentId: string;
  runId: string | null;
  generation: number;
  expectedGeneration: () => number;
  isCancelRequested: () => boolean;
  abortSignal: AbortSignal;
  mode: "live" | "test" | "schedule";
  allowed?: Set<string>;
  modelUsed?: (used: boolean) => void;
  sharedBudget?: { hostCalls: number };
  scratch?: TestScratch;
}

function record(store: Store, runId: string | null, type: string, payload: unknown): void {
  store.addEvent(runId, type, redactValue(payload));
}

export async function executeProgram(
  options: RuntimeOptions,
  code: string,
): Promise<{ success: boolean; result?: unknown; logs?: string[]; error?: unknown }> {
  const executionId = newId("exec");
  const agent = options.store.agent();
  const allowed =
    options.allowed ?? grantedSet(agent ? String(agent.granted_capabilities) : undefined);
  const budget = options.sharedBudget ?? { hostCalls: LIMITS.hostCallsPerExecution };
  const ctx: HostContext = {
    ownerId: options.ownerId,
    agentId: options.agentId,
    runId: options.runId,
    generation: options.generation,
    executionId,
    allowed,
    mode: options.mode,
    scratch: options.scratch,
    abortSignal: options.abortSignal,
    expectedGeneration: options.expectedGeneration,
    isCancelRequested: options.isCancelRequested,
    record: (type, payload) => record(options.store, options.runId, type, payload),
    consumeHostCall: () => {
      budget.hostCalls -= 1;
      if (budget.hostCalls < 0) {
        throw new HostError("limit", "Shared host-call budget exhausted");
      }
    },
    executeSnippet: (name, input, version, mode) =>
      executeSnippet(
        { ...options, sharedBudget: budget, mode: mode ?? options.mode },
        name,
        input,
        version,
      ),
  };

  const tools = createCapabilityTools(options.store, ctx);
  const { tool } = createCodeMode({
    driver: createFuelQuickJSDriver({
      timeout: LIMITS.executionTimeoutMs,
      memoryLimit: LIMITS.isolateMemoryMb,
      budget: { hostCalls: Math.max(1, budget.hostCalls) },
    }),
    tools,
    timeout: LIMITS.executionTimeoutMs,
    memoryLimit: LIMITS.isolateMemoryMb,
    onSecretParameter: "ignore",
  });

  record(options.store, options.runId, "code_mode:execution_started", {
    executionId,
    codeLength: code.length,
  });
  try {
    const output = (await tool.execute!({ typescriptCode: code }, {
      abortSignal: options.abortSignal,
    } as never)) as {
      success: boolean;
      result?: unknown;
      logs?: string[];
      error?: unknown;
    };
    record(options.store, options.runId, "code_mode:execution_finished", {
      executionId,
      success: output.success,
      logs: output.logs,
      error: output.error,
    });
    return output;
  } catch (error) {
    if (error instanceof ApprovalRequiredError) {
      record(options.store, options.runId, "approval.required", {
        operationId: error.operationId,
      });
      throw error;
    }
    throw error;
  }
}

function seedScratch(store: Store): TestScratch {
  const memory = new Map<string, { key: string; value: string; updated_at: number }>();
  for (const row of store.memoryList()) {
    memory.set(String(row.key), {
      key: String(row.key),
      value: String(row.value),
      updated_at: Number(row.updated_at),
    });
  }
  return {
    memory,
    tasks: store.tasks().map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      notes: row.notes == null ? null : String(row.notes),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      completed_at: row.completed_at == null ? null : Number(row.completed_at),
    })),
  };
}

export async function executeSnippet(
  options: RuntimeOptions,
  name: string,
  input: unknown,
  version?: number,
): Promise<unknown> {
  const versions = options.store.snippetVersions(name);
  const active = options.store.activation(name);
  const selected = version
    ? options.store.snippetVersion(name, version)
    : active
      ? options.store.snippetById(String(active.version_id))
      : versions[0];
  if (!selected) throw new HostError("not_found", `Snippet ${name} not found`, 404);
  const required = JSON.parse(String(selected.required_capabilities)) as string[];
  const parent = options.allowed ?? grantedSet(String(options.store.agent()?.granted_capabilities));
  const narrowed = narrowCapabilities(parent, required);
  if (options.mode === "schedule") {
    const granted = grantedSet(String(options.store.agent()?.granted_capabilities));
    for (const cap of required) {
      if (!granted.has(cap)) {
        throw new HostError("revoked", `Capability ${cap} was revoked`, 403);
      }
    }
  }
  const wrapped = `const input = ${JSON.stringify(input ?? {})};\n${String(selected.source)}`;
  const result = await executeProgram(
    {
      ...options,
      allowed: narrowed,
      mode: options.mode,
      scratch:
        options.mode === "test" ? (options.scratch ?? seedScratch(options.store)) : undefined,
    },
    wrapped,
  );
  if (!result.success) {
    throw new HostError(
      "snippet_failed",
      result.error ? JSON.stringify(result.error) : "Snippet failed",
    );
  }
  return result.result;
}

export async function runConversation(options: RuntimeOptions, userText: string): Promise<void> {
  const adapter = (await createLiveAdapter(options.env)) ?? createFixtureAdapter();
  options.modelUsed?.(adapter.name !== "fixture");
  if (options.env.MODEL_PROVIDER === "fixture" || adapter.name === "fixture") {
    options.modelUsed?.(false);
  }

  const executionId = newId("exec");
  const budget = { hostCalls: LIMITS.hostCallsPerExecution };
  const ctx: HostContext = {
    ownerId: options.ownerId,
    agentId: options.agentId,
    runId: options.runId,
    generation: options.generation,
    executionId,
    allowed: grantedSet(String(options.store.agent()?.granted_capabilities)),
    mode: "live",
    abortSignal: options.abortSignal,
    expectedGeneration: options.expectedGeneration,
    isCancelRequested: options.isCancelRequested,
    record: (type, payload) => record(options.store, options.runId, type, payload),
    consumeHostCall: () => {
      budget.hostCalls -= 1;
      if (budget.hostCalls < 0) throw new HostError("limit", "Shared host-call budget exhausted");
    },
    executeSnippet: (name, input, version, mode) =>
      executeSnippet(
        { ...options, sharedBudget: budget, mode: mode ?? options.mode },
        name,
        input,
        version,
      ),
  };
  const capabilityTools = createCapabilityTools(options.store, ctx);
  const { tools, systemPrompt } = createCodeMode({
    driver: createFuelQuickJSDriver({
      timeout: LIMITS.executionTimeoutMs,
      memoryLimit: LIMITS.isolateMemoryMb,
    }),
    tools: capabilityTools,
    timeout: LIMITS.executionTimeoutMs,
    memoryLimit: LIMITS.isolateMemoryMb,
    onSecretParameter: "ignore",
  });

  const history = options.store.messages().map((row) => ({
    role: String(row.role) as "user" | "assistant" | "tool",
    content: JSON.parse(String(row.content)),
  }));
  if (!history.some((message) => message.role === "user" && message.content === userText)) {
    options.store.addMessage("user", userText);
    history.push({ role: "user", content: userText });
  }

  record(options.store, options.runId, "run.started", { userText, adapter: adapter.name });
  try {
    const stream = chat({
      adapter,
      messages: history,
      tools,
      systemPrompts: [
        "You are a Celld application agent. Use execute_typescript for all state changes. Never claim you can raise quotas, read secrets, or approve protected effects.",
        systemPrompt,
      ],
      agentLoopStrategy: maxIterations(6),
      abortController: abortFromSignal(options.abortSignal),
      threadId: options.agentId,
      runId: options.runId ?? undefined,
    });
    let assistant = "";
    for await (const chunk of stream) {
      if (options.isCancelRequested() || options.expectedGeneration() !== options.generation) {
        throw new CancelledError();
      }
      record(options.store, options.runId, String(chunk.type), chunk);
      if (chunk.type === "TEXT_MESSAGE_CONTENT" && "delta" in chunk) {
        assistant += String(chunk.delta ?? "");
      }
    }
    if (assistant) options.store.addMessage("assistant", assistant);
    options.store.updateRun(options.runId!, {
      status: "completed",
      finished_at: Date.now(),
    });
    record(options.store, options.runId, "run.completed", { assistant });
  } catch (error) {
    if (error instanceof ApprovalRequiredError) {
      options.store.updateRun(options.runId!, { status: "waiting_approval" });
      options.store.addMessage("assistant", `Approval required: ${error.operationId}`);
      return;
    }
    if (error instanceof CancelledError || error instanceof FenceError) {
      options.store.confirmTerminated(options.runId!, error.message);
      record(options.store, options.runId, "run.terminated", { reason: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    options.store.updateRun(options.runId!, {
      status: "failed",
      error: message,
      finished_at: Date.now(),
    });
    record(options.store, options.runId, "run.failed", { message });
  }
}

function abortFromSignal(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller;
}
