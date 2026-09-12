/**
 * OpenCode harness stub — live UNRUN; validates package import and wiring only.
 */
import type { RunnerAssignment } from "./assignment.js";

export async function runOpenCodeHarness(assignment: RunnerAssignment): Promise<void> {
  console.log(
    JSON.stringify({
      type: "harness-status",
      harness: "opencode",
      status: "UNRUN",
      attemptId: assignment.attemptId,
      note: "OpenCode profile stub — no live credentials",
    }),
  );
  await import("@tanstack/ai-opencode");
}
