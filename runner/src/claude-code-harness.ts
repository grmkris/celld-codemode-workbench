/**
 * Claude Code reference wiring — live UNRUN (no API key extraction).
 * Uses localProcessSandbox + remoteToolStubs → Celld tool-exec.
 */
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import { httpRemoteToolExecutor, remoteToolStubs } from "@tanstack/ai-sandbox";
import type { RunnerAssignment } from "./assignment.js";

export type ClaudeCodeHarnessStatus = "UNRUN" | "SKIP";

export function claudeCodeHarnessStatus(): ClaudeCodeHarnessStatus {
  if (process.env.CELLD_HARNESS_LIVE === "1") {
    return "UNRUN";
  }
  return "UNRUN";
}

export async function runClaudeCodeHarness(assignment: RunnerAssignment): Promise<void> {
  const status = claudeCodeHarnessStatus();
  console.log(
    JSON.stringify({
      type: "harness-status",
      harness: "claude-code",
      status,
      note: "Reference wiring only — live runs disabled by policy",
    }),
  );

  if (status === "UNRUN") {
    // Validate imports/wiring without invoking Claude Code CLI or extracting tokens.
    const sandbox = localProcessSandbox({ dir: process.env.CELLD_WORKSPACE ?? "/workspace" });
    void sandbox;

    const toolExecUrl = `${assignment.baseUrl}/api/teams/${assignment.teamId}/conversations/${assignment.conversationId}/tasks/attempts/${assignment.attemptId}/tool-exec`;
    const executor = httpRemoteToolExecutor(toolExecUrl, assignment.lease ?? "");
    const stubs = remoteToolStubs(
      [
        {
          name: "celld_ping",
          description: "Ping Celld tool-exec endpoint",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      {
        execute: (name, args, options) =>
          executor.execute(name, args, options).catch((error) => ({
            wired: true,
            error: error instanceof Error ? error.message : String(error),
          })),
      },
    );

    console.log(
      JSON.stringify({
        type: "harness-wiring",
        harness: "claude-code",
        sandbox: "localProcessSandbox",
        remoteTools: stubs.map((tool) => tool.name),
        toolExecEnvelope: {
          attemptId: assignment.attemptId,
          lease: "<redacted>",
          name: "celld_ping",
          args: {},
          argsHash: null,
          version: 1,
        },
      }),
    );

    // claudeCodeText import validated at build time; not invoked live.
    await import("@tanstack/ai-claude-code");
    return;
  }
}
