import { readFileSync } from "node:fs";

export type RunnerAssignment = {
  assignmentId: string;
  teamId: string;
  taskId: string;
  attemptId: string;
  conversationId: string;
  baseUrl: string;
  machineId: string;
  envKind: "retained" | "disposable" | "host";
  lease?: string;
  generation?: number;
  harness?: string;
  payload?: Record<string, unknown>;
};

export function loadAssignment(): RunnerAssignment {
  const fromEnv = process.env.CELLD_ASSIGNMENT_JSON;
  if (fromEnv) {
    return JSON.parse(fromEnv) as RunnerAssignment;
  }
  const fromFile = process.env.CELLD_ASSIGNMENT_FILE;
  if (fromFile) {
    return JSON.parse(readFileSync(fromFile, "utf8")) as RunnerAssignment;
  }
  throw new Error("Missing CELLD_ASSIGNMENT_JSON or CELLD_ASSIGNMENT_FILE");
}
