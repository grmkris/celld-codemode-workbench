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
    return docker;
  } catch {
    return null;
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

const docker = await dockerAvailable();
if (!docker) {
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

// Cancel must be able to stop a running container (same helper the supervisor uses).
const image = process.env.CELLD_RUNNER_IMAGE ?? "alpine:3.20";
try {
  const stream = await docker.pull(image);
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve(undefined)));
  });
} catch {
  // image may already exist locally
}
const container = await docker.createContainer({
  Image: image,
  Cmd: ["sleep", "60"],
  Labels: { "celld.env": "disposable", "celld.attempt": "att_cancel_smoke" },
  HostConfig: { AutoRemove: false },
});
await container.start();
try {
  await container.stop({ t: 10 });
} catch {
  // already stopped
}
const inspected = await container.inspect();
if (inspected.State.Running) {
  console.error("cancel-stops-container FAILED: container still running");
  await container.remove({ force: true }).catch(() => undefined);
  process.exit(1);
}
await container.remove({ force: true }).catch(() => undefined);
console.log("supervisor smoke: cancel-stops-container OK");
