import { EventType, type AnyTextAdapter, type AdapterYieldChunk } from "@tanstack/ai";
import { createAlibabaAdapter } from "./alibaba";

function lastUserText(messages: Array<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user") {
      return typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    }
  }
  return "";
}

function hasToolResult(messages: Array<{ role: string }>): boolean {
  return messages.some((message) => message.role === "tool");
}

function programFor(text: string): { code: string; speech?: string } | { speech: string } {
  const lower = text.toLowerCase();
  if (lower.includes("remember") && lower.includes("task")) {
    return {
      code: `
const remembered = await external_memory_set({
  key: "project_priority",
  value: "reliability",
});
const tasks = [];
for (const title of [
  "Review error budgets",
  "Audit recovery paths",
  "Tighten schedule backoff",
]) {
  tasks.push(await external_tasks_create({ title }));
}
return { remembered, tasks };
`,
    };
  }
  if (lower.includes("reusable") || (lower.includes("write") && lower.includes("test"))) {
    return {
      code: `
const source = \`
const listed = await external_tasks_list({ status: "open" });
const summary = {
  unfinished: listed.items.length,
  titles: listed.items.map((task) => task.title),
  generatedAt: Date.now(),
};
await external_memory_set({
  key: "maintenance_summary",
  value: JSON.stringify(summary),
});
return summary;
\`;
const saved = await external_snippets_save({
  name: "maintenance_summary",
  description: "List unfinished tasks and save a maintenance summary",
  source,
  requiredCapabilities: ["memory", "tasks"],
  tests: [{ name: "default", input: {} }],
});
const tested = await external_snippets_test({
  name: "maintenance_summary",
  version: saved.version,
});
const activated = tested.passed
  ? await external_snippets_activate({
      name: "maintenance_summary",
      version: saved.version,
    })
  : null;
return { saved, tested, activated };
`,
    };
  }
  if (lower.includes("deliver") || lower.includes("notify") || lower.includes("integration")) {
    return {
      code: `
const summary = await external_memory_get({ key: "maintenance_summary" });
await external_integrations_notify({
  channel: "demo",
  message: String(summary?.value ?? "no summary"),
});
return { requested: true };
`,
    };
  }
  if (lower.includes("revise") || lower.includes("rollback")) {
    return {
      code: `
const broken = await external_snippets_save({
  name: "maintenance_summary",
  description: "Broken revision",
  source: "throw new Error('intentional test failure')",
  requiredCapabilities: ["memory", "tasks"],
});
const failed = await external_snippets_test({
  name: "maintenance_summary",
  version: broken.version,
});
const source = \`
const listed = await external_tasks_list({ status: "open" });
const summary = {
  unfinished: listed.items.length,
  titles: listed.items.map((task) => task.title),
  revision: 2,
  generatedAt: Date.now(),
};
await external_memory_set({
  key: "maintenance_summary",
  value: JSON.stringify(summary),
});
return summary;
\`;
const revised = await external_snippets_save({
  name: "maintenance_summary",
  description: "Revised maintenance summary",
  source,
  requiredCapabilities: ["memory", "tasks"],
});
const tested = await external_snippets_test({
  name: "maintenance_summary",
  version: revised.version,
});
const activated = tested.passed
  ? await external_snippets_activate({
      name: "maintenance_summary",
      version: revised.version,
    })
  : null;
const previous = broken.version - 1;
const rolled = previous > 0
  ? await external_snippets_rollback({ name: "maintenance_summary", toVersion: previous })
  : null;
return { failed, activated, rolled };
`,
    };
  }
  if (lower.includes("nested") && lower.includes("escalat")) {
    return {
      code: `
const child = await external_snippets_save({
  name: "escalator",
  description: "Tries to gain integrations from a narrow parent",
  source: "return await external_integrations_notify({ channel: 'demo', message: 'nope' })",
  requiredCapabilities: ["integrations"],
});
const parent = await external_snippets_save({
  name: "narrow_parent",
  description: "Memory-only parent that invokes escalator",
  source: "return await external_snippets_invoke({ name: 'escalator' })",
  requiredCapabilities: ["memory", "snippets"],
});
let error = null;
try {
  await external_snippets_invoke({ name: "narrow_parent", version: parent.version });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
}
return { child: child.version, parent: parent.version, error };
`,
    };
  }
  if (lower.includes("schedule")) {
    return {
      code: `
return await external_schedules_create({
  name: "maintenance-tick",
  snippetName: "maintenance_summary",
  delaySeconds: 2,
});
`,
    };
  }
  return {
    code: `
const state = await external_inspect({});
const memory = await external_memory_list({});
const tasks = await external_tasks_list({});
return { state, memory, tasks };
`,
    speech: "Inspected current agent state.",
  };
}

async function* emitToolCall(
  threadId: string,
  runId: string,
  code: string,
): AsyncGenerator<AdapterYieldChunk> {
  const toolCallId = `call_${runId}`;
  const args = JSON.stringify({ typescriptCode: code });
  yield {
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName: "execute_typescript",
    toolName: "execute_typescript",
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: args,
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.TOOL_CALL_END,
    toolCallId,
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    finishReason: "tool_calls",
    timestamp: Date.now(),
  } as AdapterYieldChunk;
}

async function* emitSpeech(
  threadId: string,
  runId: string,
  text: string,
): AsyncGenerator<AdapterYieldChunk> {
  const messageId = `msg_${runId}`;
  yield {
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: "assistant",
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: text,
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.TEXT_MESSAGE_END,
    messageId,
    timestamp: Date.now(),
  } as AdapterYieldChunk;
  yield {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    finishReason: "stop",
    timestamp: Date.now(),
  } as AdapterYieldChunk;
}

export function createFixtureAdapter(): AnyTextAdapter {
  return {
    kind: "text",
    name: "fixture",
    model: "celld-fixture",
    "~types": {} as never,
    async *chatStream(options) {
      const threadId = options.threadId ?? "thread";
      const runId = options.runId ?? `run_${Date.now()}`;
      if (hasToolResult(options.messages)) {
        yield* emitSpeech(threadId, runId, "Code Mode finished. I stored the observable results.");
        return;
      }
      const planned = programFor(lastUserText(options.messages));
      if ("code" in planned) {
        yield* emitToolCall(threadId, runId, planned.code);
        return;
      }
      yield* emitSpeech(threadId, runId, planned.speech);
    },
    async structuredOutput() {
      return { data: {}, rawText: "{}" };
    },
  };
}

export async function createLiveAdapter(env: {
  MODEL_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  XAI_API_KEY?: string;
  XAI_MODEL?: string;
  ALIBABA_TOKEN_PLAN_API_KEY?: string;
  ALIBABA_MODEL?: string;
}): Promise<AnyTextAdapter | null> {
  const provider = env.MODEL_PROVIDER ?? "fixture";
  if (provider === "alibaba" && env.ALIBABA_TOKEN_PLAN_API_KEY) {
    return createAlibabaAdapter({
      apiKey: env.ALIBABA_TOKEN_PLAN_API_KEY,
      model: env.ALIBABA_MODEL || "qwen3.8-max",
    });
  }
  if (provider === "openai" && env.OPENAI_API_KEY) {
    const { openaiText } = await import("@tanstack/ai-openai");
    return openaiText(
      (env.OPENAI_MODEL || "gpt-4.1-mini") as never,
      { apiKey: env.OPENAI_API_KEY } as never,
    ) as unknown as AnyTextAdapter;
  }
  if (provider === "grok" && env.XAI_API_KEY) {
    const { grokText } = await import("@tanstack/ai-grok");
    return grokText(
      (env.XAI_MODEL || "grok-4-1-fast-non-reasoning") as never,
      { apiKey: env.XAI_API_KEY } as never,
    ) as unknown as AnyTextAdapter;
  }
  return null;
}
