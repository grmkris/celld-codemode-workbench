/**
 * Grok Build harness stub — live UNRUN; validates package import and wiring only.
 */
import type { RunnerAssignment } from "./assignment.js";

export async function runGrokBuildHarness(assignment: RunnerAssignment): Promise<void> {
  console.log(
    JSON.stringify({
      type: "harness-status",
      harness: "grok-build",
      status: "UNRUN",
      attemptId: assignment.attemptId,
      note: "Grok Build profile stub — no live credentials",
    }),
  );
  await import("@tanstack/ai-grok-build");
}
