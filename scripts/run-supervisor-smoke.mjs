#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Dockerode from "dockerode";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

async function dockerAvailable() {
  try {
    const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

const runnerBuilt = existsSync(join(repoRoot, "dist/runner/runner.mjs"));
const supervisorBuilt = existsSync(join(repoRoot, "dist/supervisor/index.mjs"));

if (!runnerBuilt || !supervisorBuilt) {
  console.log("building supervisor + runner…");
  const build = spawnSync("node", [join(root, "build-node-tools.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

if (!(await dockerAvailable())) {
  console.log("SKIP supervisor smoke: Docker unavailable");
  process.exit(0);
}

const workspace = mkdtempSync(join(tmpdir(), "celld-runner-smoke-"));
const fixture = spawnSync("node", [join(repoRoot, "dist/runner/runner.mjs")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CELLD_WORKSPACE: workspace,
    CELLD_ASSIGNMENT_JSON: JSON.stringify({
      assignmentId: "smoke",
      teamId: "team_smoke",
      taskId: "task_smoke",
      attemptId: "att_smoke",
      conversationId: "conv_smoke",
      baseUrl: "http://127.0.0.1:9876",
      machineId: "mach_smoke",
      envKind: "disposable",
      harness: "fixture",
      payload: { prompt: "supervisor smoke" },
    }),
  },
  encoding: "utf8",
});

if (fixture.status !== 0) {
  console.error(fixture.stdout);
  console.error(fixture.stderr);
  process.exit(fixture.status ?? 1);
}

console.log("supervisor smoke: fixture runner OK");
console.log(fixture.stdout.trim());
