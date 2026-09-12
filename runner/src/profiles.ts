/**
 * Harness profile registry — selects adapter wiring by name without live credentials.
 * All profiles except fixture report UNRUN for live execution.
 */
import type { RunnerAssignment } from "./assignment.js";

export type HarnessProfileName = "fixture" | "claude-code" | "codex" | "grok-build" | "opencode";

export type HarnessLiveStatus = "UNRUN" | "SKIP";

export interface HarnessProfile {
  name: HarnessProfileName;
  packageName: string;
  sandbox: string;
  liveStatus: HarnessLiveStatus;
  run: (assignment: RunnerAssignment) => Promise<void>;
}

export function normalizeHarnessName(raw: unknown): HarnessProfileName {
  const value = String(raw ?? "fixture")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  switch (value) {
    case "claude-code":
    case "claude":
      return "claude-code";
    case "codex":
      return "codex";
    case "grok-build":
    case "grok":
      return "grok-build";
    case "opencode":
      return "opencode";
    case "fixture":
    default:
      return "fixture";
  }
}

export async function createProfileRegistry(): Promise<Map<HarnessProfileName, HarnessProfile>> {
  const [
    { runFixtureHarness },
    { runClaudeCodeHarness },
    { runCodexHarness },
    { runGrokBuildHarness },
    { runOpenCodeHarness },
  ] = await Promise.all([
    import("./fixture-harness.js"),
    import("./claude-code-harness.js"),
    import("./codex-harness.js"),
    import("./grok-build-harness.js"),
    import("./opencode-harness.js"),
  ]);

  const profiles: HarnessProfile[] = [
    {
      name: "fixture",
      packageName: "(built-in)",
      sandbox: "n/a",
      liveStatus: "UNRUN",
      run: runFixtureHarness,
    },
    {
      name: "claude-code",
      packageName: "@tanstack/ai-claude-code",
      sandbox: "localProcessSandbox",
      liveStatus: "UNRUN",
      run: runClaudeCodeHarness,
    },
    {
      name: "codex",
      packageName: "@tanstack/ai-codex",
      sandbox: "docker (planned)",
      liveStatus: "UNRUN",
      run: runCodexHarness,
    },
    {
      name: "grok-build",
      packageName: "@tanstack/ai-grok-build",
      sandbox: "docker (planned)",
      liveStatus: "UNRUN",
      run: runGrokBuildHarness,
    },
    {
      name: "opencode",
      packageName: "@tanstack/ai-opencode",
      sandbox: "docker (planned)",
      liveStatus: "UNRUN",
      run: runOpenCodeHarness,
    },
  ];

  return new Map(profiles.map((profile) => [profile.name, profile]));
}

export async function resolveHarnessProfile(
  assignment: RunnerAssignment,
): Promise<{ profile: HarnessProfile; name: HarnessProfileName }> {
  const name = normalizeHarnessName(
    assignment.harness ?? assignment.payload?.harness ?? process.env.CELLD_HARNESS,
  );
  const registry = await createProfileRegistry();
  const profile = registry.get(name) ?? registry.get("fixture")!;
  return { profile, name };
}
