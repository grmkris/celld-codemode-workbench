#!/usr/bin/env node
import { loadAssignment } from "./assignment.js";
import { runClaudeCodeHarness } from "./claude-code-harness.js";
import { runFixtureHarness } from "./fixture-harness.js";

async function main() {
  const assignment = loadAssignment();
  const harness = String(
    assignment.harness ?? assignment.payload?.harness ?? process.env.CELLD_HARNESS ?? "fixture",
  );

  console.log(
    JSON.stringify({
      type: "runner-start",
      harness,
      attemptId: assignment.attemptId,
      envKind: assignment.envKind,
    }),
  );

  switch (harness) {
    case "claude-code":
      await runClaudeCodeHarness(assignment);
      break;
    case "fixture":
    default:
      await runFixtureHarness(assignment);
      break;
  }

  console.log(JSON.stringify({ type: "runner-end", status: "ok" }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      type: "runner-error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
