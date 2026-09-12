import { HostError } from "../../shared/errors";

export type MachineStatus = "pending" | "approved" | "draining" | "revoked" | "stale";

export type MachineRow = {
  id: string;
  team_id: string;
  name: string;
  status: MachineStatus;
  labels_json: string;
  capacities_json: string;
  credential_hash: string | null;
  last_seen_at: number | null;
  created_at: number;
};

export type Capacities = {
  workspaces?: number;
  cpu?: number;
  memoryMb?: number;
};

export function parseCapacities(raw: string | null | undefined): Capacities {
  if (!raw) return { workspaces: 1 };
  try {
    const parsed = JSON.parse(raw) as Capacities;
    return {
      workspaces: Math.max(1, Number(parsed.workspaces ?? 1)),
      cpu: parsed.cpu,
      memoryMb: parsed.memoryMb,
    };
  } catch {
    return { workspaces: 1 };
  }
}

export function parseLabels(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function machineCanAcceptWork(status: MachineStatus): boolean {
  return status === "approved";
}

export function countActiveAssignments(
  rows: Array<{ status: string }>,
  capacities: Capacities,
): { active: number; available: number } {
  const active = rows.filter((row) => row.status === "assigned" || row.status === "running").length;
  const limit = Math.max(1, Number(capacities.workspaces ?? 1));
  return { active, available: Math.max(0, limit - active) };
}

export function assertMachineCredential(
  machine: MachineRow,
  credential: string,
  credentialHash: string,
): void {
  if (machine.status === "revoked") {
    throw new HostError("forbidden", "Machine revoked", 403);
  }
  if (!machine.credential_hash || machine.credential_hash !== credentialHash) {
    throw new HostError("forbidden", "Invalid machine credential", 403);
  }
  if (!credential || credential.length < 16) {
    throw new HostError("invalid", "Malformed machine credential", 400);
  }
}
