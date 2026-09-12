/**
 * Codex harness stub — live UNRUN; validates package import and wiring only.
 */
import type { RunnerAssignment } from "./assignment.js";

export async function runCodexHarness(assignment: RunnerAssignment): Promise<void> {
  console.log(
    JSON.stringify({
      type: "harness-status",
      harness: "codex",
      status: "UNRUN",
      attemptId: assignment.attemptId,
      note: "Codex profile stub — no live credentials",
    }),
  );
  await import("@tanstack/ai-codex");
}
