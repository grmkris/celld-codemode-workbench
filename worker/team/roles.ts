import { HostError } from "../../shared/errors";

export type TeamRole = "owner" | "admin" | "member" | "viewer";

const ROLE_RANK: Record<TeamRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function parseTeamRole(value: unknown): TeamRole {
  const role = String(value ?? "").trim();
  if (role === "owner" || role === "admin" || role === "member" || role === "viewer") {
    return role;
  }
  throw new HostError("invalid", "Invalid team role", 400);
}

export function roleAtLeast(actual: TeamRole, required: TeamRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function requireRole(actual: TeamRole | null, required: TeamRole, action: string): TeamRole {
  if (!actual) {
    throw new HostError("forbidden", "Not a team member", 403);
  }
  if (!roleAtLeast(actual, required)) {
    throw new HostError("forbidden", `Requires ${required} role to ${action}`, 403);
  }
  return actual;
}

export function canManageInvitations(role: TeamRole): boolean {
  return roleAtLeast(role, "admin");
}

export function canManageMachines(role: TeamRole): boolean {
  return roleAtLeast(role, "admin");
}

export function canWriteConversations(role: TeamRole): boolean {
  return roleAtLeast(role, "member");
}
