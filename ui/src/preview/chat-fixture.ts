import type { UIMessage } from "@tanstack/ai-client";

/**
 * Offline deterministic workbench conversation for UI preview/tests.
 * No model, route, network, or key. Replaces the removed @shadcn/helpers
 * transport with static messages compatible with @tanstack/ai-react useChat.
 */
export const previewInitialMessages: UIMessage[] = [
  {
    id: "preview-user-1",
    role: "user",
    parts: [{ type: "text", content: "Remember that this project's priority is reliability." }],
  },
  {
    id: "preview-assistant-1",
    role: "assistant",
    parts: [
      {
        type: "thinking",
        content: "I should confirm the memory write before summarizing.",
      },
      {
        type: "text",
        content: "Saved. Reliability is now the top priority for this project.",
      },
    ],
  },
  {
    id: "preview-user-2",
    role: "user",
    parts: [{ type: "text", content: "Create three maintenance tasks." }],
  },
  {
    id: "preview-assistant-2",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        id: "preview-tool-1",
        name: "tasks_create",
        arguments: JSON.stringify({ title: "Rotate fixture snapshots" }),
        state: "complete",
        output: { id: "task-1", title: "Rotate fixture snapshots", status: "open" },
      },
      {
        type: "text",
        content:
          "Created 3 maintenance tasks: rotate snapshots, verify containment, and review approvals.",
      },
    ],
  },
  {
    id: "preview-user-3",
    role: "user",
    parts: [{ type: "text", content: "Write a snippet that summarizes open tasks." }],
  },
  {
    id: "preview-assistant-3",
    role: "assistant",
    parts: [
      {
        type: "text",
        content: "Saved `maintenance_summary` v1. Invoke it without a model from the Snippets tab.",
      },
    ],
  },
];

const scriptedUserTexts = [
  "Remember that this project's priority is reliability.",
  "Create three maintenance tasks.",
  "Write a snippet that summarizes open tasks.",
];

export function nextPreviewUserMessage(messages: UIMessage[]): string | null {
  const userCount = messages.filter((message) => message.role === "user").length;
  return scriptedUserTexts[userCount] ?? null;
}

/** Minimal connection that echoes free-form preview input without a network call. */
export const previewConnection = {
  async *connect(messages: UIMessage[]) {
    const last = messages.at(-1);
    const text =
      last?.parts.find((part) => part.type === "text" && "content" in part)?.content ??
      "This preview has no more predefined replies.";
    const messageId = `preview-reply-${Date.now()}`;
    yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
    yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: String(text) };
    yield { type: "TEXT_MESSAGE_END", messageId };
  },
};
