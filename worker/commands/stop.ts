import type { StopFenceInput, StopFenceResult } from "./types";

/** When explicit run/generation are provided, stale stops must not affect a newer run. */
export function evaluateStopFence(input: StopFenceInput): StopFenceResult {
  const { activeRunId, activeGeneration, expectedRunId, expectedGeneration } = input;

  if (!activeRunId) {
    return { allowed: false, stale: false, reason: "idle" };
  }

  const hasRunFence = typeof expectedRunId === "string" && expectedRunId.length > 0;
  const hasGenerationFence = typeof expectedGeneration === "number";

  if (!hasRunFence && !hasGenerationFence) {
    return { allowed: true, stale: false };
  }

  if (hasRunFence && expectedRunId !== activeRunId) {
    return { allowed: false, stale: true, reason: "run_mismatch" };
  }

  if (hasGenerationFence && activeGeneration != null && expectedGeneration !== activeGeneration) {
    return { allowed: false, stale: true, reason: "generation_mismatch" };
  }

  return { allowed: true, stale: false };
}
