import { createChat } from "@shadcn/helpers/tanstack-ai";

/**
 * Offline deterministic workbench conversation for UI preview/tests.
 * No model, route, network, or key. Replays through TanStack useChat
 * as real AG-UI events via chat.transport().
 */
export const previewChat = createChat()
  .user("Remember that this project's priority is reliability.")
  .assistant(({ writer }) => {
    writer.reasoning("I should confirm the memory write before summarizing.");
    writer.text("Saved. Reliability is now the top priority for this project.");
  })
  .user("Create three maintenance tasks.")
  .assistant(({ writer }) => {
    writer
      .tool("tasks_create", { input: { title: "Rotate fixture snapshots" } })
      .sleep(400)
      .output({ id: "task-1", title: "Rotate fixture snapshots", status: "open" });
    writer.text(
      "Created 3 maintenance tasks: rotate snapshots, verify containment, and review approvals.",
    );
  })
  .user("Write a snippet that summarizes open tasks.")
  .assistant("Saved `maintenance_summary` v1. Invoke it without a model from the Snippets tab.");

export const previewInitialMessages = previewChat.get(0);
export const previewConnection = previewChat.transport({
  delayMs: 30,
  fallback: "This preview has no more predefined replies.",
});
