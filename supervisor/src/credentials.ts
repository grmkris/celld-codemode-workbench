import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SupervisorCredentials = {
  name: string;
  baseUrl: string;
  machineId: string;
  teamId: string;
  credential: string;
  enrolledAt: number;
};

export function credentialsDir(name: string): string {
  return join(homedir(), ".celld-supervisor", name);
}

export function credentialsPath(name: string): string {
  return join(credentialsDir(name), "credentials.json");
}

export function loadCredentials(name: string): SupervisorCredentials {
  const raw = readFileSync(credentialsPath(name), "utf8");
  return JSON.parse(raw) as SupervisorCredentials;
}

export function saveCredentials(creds: SupervisorCredentials): void {
  const dir = credentialsDir(creds.name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = credentialsPath(creds.name);
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}
