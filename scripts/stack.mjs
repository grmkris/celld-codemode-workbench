import { spawn } from "node:child_process";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { celldDevArgs, defaultIsolateRoot, prepareIsolateRoot } from "./isolate-celld.mjs";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
const streamsPort = Number(process.env.STREAMS_PORT ?? 4437);
const streamsHost = "127.0.0.1";
const celldPort = process.env.CELLD_PORT ?? "9876";

const ownedChildren = [];

function trackChild(child) {
  ownedChildren.push(child);
  child.on("exit", () => {
    const index = ownedChildren.indexOf(child);
    if (index >= 0) ownedChildren.splice(index, 1);
  });
  return child;
}

function waitForTcp(host, port, timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function waitForStreamsReady() {
  const baseUrl = `http://${streamsHost}:${streamsPort}`;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok || response.status === 404) return;
    } catch (error) {
      if (error instanceof TypeError) {
        await waitForTcp(streamsHost, streamsPort, 30_000);
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await waitForTcp(streamsHost, streamsPort, 30_000);
}

const streams = trackChild(
  spawn("node", [join(root, "services/streams.mjs")], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  }),
);

let streamsUrl = `http://${streamsHost}:${streamsPort}`;
streams.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      if (payload.ok && payload.url) streamsUrl = payload.url;
    } catch {
      // Ignore non-JSON log lines.
    }
  }
});

await waitForStreamsReady();
console.log(`streams ready at ${streamsUrl}`);

const isolateRoot = process.env.CELLD_ISOLATE_ROOT ?? defaultIsolateRoot(celldPort, "dev");
const project = prepareIsolateRoot(root, isolateRoot);

const env = {
  ...process.env,
  STREAMS_BASE_URL: process.env.STREAMS_BASE_URL ?? streamsUrl,
  CELLD_VAR_STREAMS_BASE_URL: process.env.STREAMS_BASE_URL ?? streamsUrl,
  PATH: `${join(root, "node_modules/.bin")}:${process.env.HOME}/.local/bin:${process.env.PATH}`,
  CELLD_VAR_MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? "fixture",
};

const celld = trackChild(
  spawn(
    "celld",
    celldDevArgs(project, {
      port: celldPort,
      watch: process.env.CELLD_NO_WATCH !== "1",
      clean: process.env.CELLD_DEV_CLEAN === "1",
    }),
    {
      cwd: project,
      env,
      stdio: "inherit",
    },
  ),
);

function stopChildren(signal = "SIGTERM") {
  for (const child of ownedChildren) {
    if (child.exitCode == null && !child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGTERM", () => stopChildren("SIGTERM"));
process.on("SIGINT", () => stopChildren("SIGINT"));

celld.on("exit", (code) => {
  stopChildren("SIGTERM");
  process.exit(code ?? 0);
});

streams.on("exit", (code) => {
  if (code && code !== 0) {
    stopChildren("SIGTERM");
    process.exit(code);
  }
});
