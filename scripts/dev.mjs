import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { celldDevArgs, prepareIsolateRoot } from "./isolate-celld.mjs";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eq = stripped.indexOf("=");
    if (eq < 1) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(join(homedir(), ".config/secrets.env"));
loadEnvFile(join(root, ".env"));

if (process.env.ALIBABA_TOKEN_PLAN_API_KEY && !process.env.MODEL_PROVIDER) {
  process.env.MODEL_PROVIDER = "alibaba";
}

const env = {
  ...process.env,
  PATH: `${join(root, "node_modules/.bin")}:${process.env.HOME}/.local/bin:${process.env.PATH}`,
  CELLD_VAR_MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? "fixture",
  CELLD_VAR_ALIBABA_MODEL: process.env.ALIBABA_MODEL ?? "qwen3.8-max",
};
if (process.env.ALIBABA_TOKEN_PLAN_API_KEY) {
  env.CELLD_VAR_ALIBABA_TOKEN_PLAN_API_KEY = process.env.ALIBABA_TOKEN_PLAN_API_KEY;
}

const port = process.env.CELLD_PORT ?? "9876";
const isolateRoot = process.env.CELLD_ISOLATE_ROOT;
const project = isolateRoot ? prepareIsolateRoot(root, isolateRoot) : root;
console.log(
  `celld provider=${env.CELLD_VAR_MODEL_PROVIDER} model=${env.CELLD_VAR_ALIBABA_MODEL} key=${
    env.CELLD_VAR_ALIBABA_TOKEN_PLAN_API_KEY ? "alibaba-token-plan" : "none"
  } project=${project}`,
);

const child = spawn(
  "celld",
  celldDevArgs(project, {
    port,
    watch: process.env.CELLD_NO_WATCH !== "1",
    clean: process.env.CELLD_DEV_CLEAN === "1",
  }),
  {
    cwd: project,
    env,
    stdio: "inherit",
  },
);

function stop(signal = "SIGTERM") {
  if (child.exitCode != null || child.killed) return;
  child.kill(signal);
  // celld can linger on long-poll drains; escalate so Playwright webServer exits.
  setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      child.kill("SIGKILL");
    }
  }, 2_000).unref();
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGHUP", () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
