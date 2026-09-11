import {
  EventType,
  convertSchemaToJsonSchema,
  type AnyTextAdapter,
  type AdapterYieldChunk,
} from "@tanstack/ai";

export const ALIBABA_BASE_URL =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

const DEFAULT_MODEL = "qwen3.8-max";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

type IncomingToolCall = {
  id?: string;
  name?: string;
  arguments?: string;
  input?: unknown;
  function?: { name?: string; arguments?: string };
};

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const typed = part as { type?: string; content?: unknown; text?: unknown };
        if (typed.type && typed.type !== "text") return "";
        if (typed.content != null) return String(typed.content);
        if (typed.text != null) return String(typed.text);
        return "";
      })
      .join("");
  }
  return JSON.stringify(content);
}

function normalizeToolCall(call: IncomingToolCall, index: number) {
  const name = String(call.function?.name || call.name || "unknown");
  const raw =
    call.function?.arguments ??
    call.arguments ??
    (call.input == null ? "{}" : JSON.stringify(call.input));
  return {
    id: String(call.id || `call_${index}`),
    type: "function" as const,
    function: {
      name,
      arguments: typeof raw === "string" ? raw : JSON.stringify(raw),
    },
  };
}

function toolCallsFromMessage(message: {
  toolCalls?: IncomingToolCall[];
  content?: unknown;
}): ReturnType<typeof normalizeToolCall>[] {
  if (message.toolCalls?.length) {
    return message.toolCalls.map((call, index) => normalizeToolCall(call, index));
  }
  if (!Array.isArray(message.content)) return [];
  const fromParts = message.content.flatMap((part, index) => {
    if (!part || typeof part !== "object") return [];
    const typed = part as {
      type?: string;
      id?: string;
      name?: string;
      arguments?: string;
      input?: unknown;
    };
    if (typed.type !== "tool-call") return [];
    return [normalizeToolCall(typed, index)];
  });
  return fromParts;
}

export function toOpenAIMessages(
  systemPrompts: unknown[] | undefined,
  messages: Array<{
    role: string;
    content: unknown;
    name?: string;
    toolCalls?: IncomingToolCall[];
    toolCallId?: string;
  }>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const namesByCallId = new Map<string, string>();
  for (const prompt of systemPrompts ?? []) {
    const content =
      typeof prompt === "string" ? prompt : String((prompt as { content?: unknown }).content ?? "");
    if (content) out.push({ role: "system", content });
  }
  for (const message of messages) {
    if (message.role === "tool") {
      const toolCallId = message.toolCallId || "tool";
      out.push({
        role: "tool",
        name: message.name || namesByCallId.get(toolCallId) || "unknown",
        tool_call_id: toolCallId,
        content: asText(message.content),
      });
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = toolCallsFromMessage(message);
      for (const call of toolCalls) namesByCallId.set(call.id, call.function.name);
      out.push({
        role: "assistant",
        content: asText(message.content),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    out.push({ role: "user", content: asText(message.content) });
  }
  return out;
}

function toOpenAITools(
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }> | undefined,
) {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: convertSchemaToJsonSchema(tool.inputSchema as never) || {
        type: "object",
        properties: {},
      },
    },
  }));
}

export function createAlibabaAdapter(options: { apiKey: string; model?: string }): AnyTextAdapter {
  const model = options.model || DEFAULT_MODEL;
  return {
    kind: "text",
    name: "alibaba",
    model,
    "~types": {} as never,
    async *chatStream(request) {
      const threadId = request.threadId ?? "thread";
      const runId = request.runId ?? `run_${Date.now()}`;
      const now = () => Date.now();
      yield {
        type: EventType.RUN_STARTED,
        threadId,
        runId,
        timestamp: now(),
      } as AdapterYieldChunk;

      const body = {
        model,
        messages: toOpenAIMessages(request.systemPrompts as unknown[], request.messages),
        tools: toOpenAITools(request.tools as never),
        stream: false,
        enable_thinking: false,
      };

      let payload: {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string;
        }>;
        error?: { message?: string };
      };
      try {
        const response = await fetch(`${ALIBABA_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: request.abortController?.signal,
        });
        payload = (await response.json()) as typeof payload;
        if (!response.ok) {
          throw new Error(payload.error?.message || `Alibaba HTTP ${response.status}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield {
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          finishReason: "stop",
          timestamp: now(),
        } as AdapterYieldChunk;
        throw new Error(message);
      }

      const choice = payload.choices?.[0]?.message ?? {};
      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length) {
        for (const call of toolCalls) {
          const toolCallId = call.id || `call_${runId}`;
          const name = call.function?.name || "unknown";
          const args = call.function?.arguments || "{}";
          yield {
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: name,
            toolName: name,
            timestamp: now(),
          } as AdapterYieldChunk;
          yield {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: args,
            timestamp: now(),
          } as AdapterYieldChunk;
          yield {
            type: EventType.TOOL_CALL_END,
            toolCallId,
            timestamp: now(),
          } as AdapterYieldChunk;
        }
        yield {
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          finishReason: "tool_calls",
          timestamp: now(),
        } as AdapterYieldChunk;
        return;
      }

      const text = String(choice.content ?? "");
      if (text) {
        const messageId = `msg_${runId}`;
        yield {
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
          timestamp: now(),
        } as AdapterYieldChunk;
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: text,
          timestamp: now(),
        } as AdapterYieldChunk;
        yield {
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: now(),
        } as AdapterYieldChunk;
      }
      yield {
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
        finishReason: "stop",
        timestamp: now(),
      } as AdapterYieldChunk;
    },
    async structuredOutput() {
      return { data: {}, rawText: "{}" };
    },
  };
}
