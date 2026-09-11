import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunnerAssignment } from "./assignment.js";

/** TanStack-like NDJSON chunks for CI fixture runs. */
export function* fixtureNdjsonChunks(prompt: string): Generator<string> {
  yield `${JSON.stringify({ type: "run-start", prompt })}\n`;
  yield `${JSON.stringify({ type: "text-delta", delta: "Fixture harness " })}\n`;
  yield `${JSON.stringify({ type: "text-delta", delta: "acknowledged." })}\n`;
  yield `${JSON.stringify({ type: "tool-call", name: "write_file", args: { path: "fixture.txt" } })}\n`;
  yield `${JSON.stringify({ type: "run-end", status: "ok" })}\n`;
}

export async function runFixtureHarness(assignment: RunnerAssignment): Promise<void> {
  const workspace = process.env.CELLD_WORKSPACE ?? "/workspace";
  mkdirSync(workspace, { recursive: true });
  const outPath = join(workspace, "fixture.txt");
  writeFileSync(outPath, `fixture task ${assignment.taskId}\n`, "utf8");

  const prompt = String(assignment.payload?.prompt ?? "fixture smoke");
  for (const chunk of fixtureNdjsonChunks(prompt)) {
    process.stdout.write(chunk);
  }
}
