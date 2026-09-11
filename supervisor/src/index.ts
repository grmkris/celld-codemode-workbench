#!/usr/bin/env node
import { loadCredentials } from "./credentials.js";
import { drainSupervisor } from "./drain.js";
import { enrollSupervisor } from "./enroll.js";
import { runSupervisor } from "./run.js";

function usage(): never {
  console.error(`Usage:
  supervisor enroll --name <name> --base-url <url> --token <token>
  supervisor run --name <name> [--once] [--allow-host]
  supervisor drain --name <name>`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const get = (key: string) => {
    const index = argv.indexOf(`--${key}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return { cmd: positional[0], get, flags, positional };
}

async function main() {
  const { cmd, get, flags } = parseArgs(process.argv.slice(2));
  if (!cmd) usage();

  if (cmd === "enroll") {
    const name = get("name");
    const baseUrl = get("base-url");
    const token = get("token");
    if (!name || !baseUrl || !token) usage();
    const creds = await enrollSupervisor({ name, baseUrl, token });
    console.log(
      JSON.stringify({ ok: true, machineId: creds.machineId, teamId: creds.teamId }, null, 2),
    );
    return;
  }

  const name = get("name");
  if (!name) usage();
  const creds = loadCredentials(name);

  if (cmd === "run") {
    await runSupervisor(creds, {
      allowHost: flags.has("--allow-host"),
      once: flags.has("--once"),
    });
    return;
  }

  if (cmd === "drain") {
    await drainSupervisor(creds);
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
