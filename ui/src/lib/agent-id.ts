import type { ConversationSummary } from "@/lib/state-schema";

/** Resolve the agent id used by /api/agents/:id for a team conversation row. */
export function resolveAgentId(
  conversation: Pick<ConversationSummary, "id" | "cellAddress">,
): string {
  const legacy = conversation.cellAddress.match(/^legacy:[^:]+:(.+)$/);
  if (legacy) return legacy[1];
  return conversation.id;
}
