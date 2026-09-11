import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
loadEnvFile(join(homedir(), ".config/secrets.env"));
loadEnvFile(join(root, ".env"));

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return (result.stdout || result.stderr || "").trim();
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function present(name) {
  const value = process.env[name];
  return Boolean(value && value.length > 0);
}

const node = process.version;
const npm = run("npm", ["-v"]);
const celldPath = existsSync(`${homedir()}/.local/bin/celld`)
  ? `${homedir()}/.local/bin/celld`
  : "celld";
const celldOut = run(celldPath, ["--version"]);
const celldVersion = /celld\s+([0-9.]+)/.exec(celldOut)?.[1] ?? "missing";
const esbuild = run("npx", ["esbuild", "--version"]);
const workbench = await portOpen(9876);
const tests = await portOpen(9888);
const rows = [
  [
    "node",
    node,
    node.startsWith("v20") || node.startsWith("v22") || node.startsWith("v24") ? "ok" : "warn",
  ],
  ["npm", npm, "ok"],
  ["celld", celldVersion, celldVersion === "0.4.1" ? "ok" : "warn"],
  ["esbuild", esbuild || "missing", esbuild ? "ok" : "fail"],
  ["MODEL_PROVIDER", process.env.MODEL_PROVIDER ?? "fixture (default)", "ok"],
  ["ALIBABA_TOKEN_PLAN_API_KEY", present("ALIBABA_TOKEN_PLAN_API_KEY") ? "set" : "unset", "ok"],
  ["OPENAI_API_KEY", present("OPENAI_API_KEY") ? "set" : "unset", "ok"],
  ["XAI_API_KEY", present("XAI_API_KEY") ? "set" : "unset", "ok"],
  ["workbench :9876", workbench ? "listening" : "free", "ok"],
  ["test port :9888", tests ? "in use" : "free", tests ? "warn" : "ok"],
  ["lockfile", existsSync(join(root, "package-lock.json")) ? "present" : "missing", "ok"],
];

console.log("celld-codemode-workbench doctor");
for (const [name, value, status] of rows) {
  console.log(`${status.padEnd(4)} ${name}: ${value}`);
}
console.log(
  "\nFixture mode needs no provider keys. test:live fails clearly without a configured key.",
);
console.log("Do not expose celld's internal/operator listener. Keep --host 127.0.0.1.");
if (celldVersion !== "0.4.1") {
  console.log(
    "Expected celld 0.4.1. Install with CELLD_VERSION=v0.4.1 curl -fsSL https://celld.dev/install.sh | sh",
  );
}
process.exit(rows.some((row) => row[2] === "fail") ? 1 : 0);
