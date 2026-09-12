export const MACHINE_HEARTBEAT_INTERVAL_MS = 30_000;
/** Mark machines stale after three missed heartbeat intervals. */
export const MACHINE_STALE_AFTER_MS = MACHINE_HEARTBEAT_INTERVAL_MS * 3;
export const TEAM_SWEEP_ALARM_MS = 30_000;

export type SweepableMachine = {
  id: string;
  status: string;
  last_seen_at: number | null;
};

export type StaleMachineDecision = {
  machineId: string;
  action: "mark_stale";
};

export type RequeueAssignmentDecision = {
  assignmentId: string;
  action: "requeue";
};

/** Pure: approved machines whose last_seen_at is older than the stale window. */
export function decideStaleMachines(
  machines: SweepableMachine[],
  now: number,
  staleAfterMs = MACHINE_STALE_AFTER_MS,
): StaleMachineDecision[] {
  const cutoff = now - staleAfterMs;
  const decisions: StaleMachineDecision[] = [];
  for (const machine of machines) {
    if (machine.status !== "approved") continue;
    const lastSeen = machine.last_seen_at == null ? 0 : Number(machine.last_seen_at);
    if (lastSeen > cutoff) continue;
    decisions.push({ machineId: machine.id, action: "mark_stale" });
  }
  return decisions;
}

export type SweepableAssignment = {
  id: string;
  machine_id: string | null;
  status: string;
};

/** Pure: assigned (not yet running) work on stale machines returns to pending. */
export function decideRequeueAssignments(
  assignments: SweepableAssignment[],
  staleMachineIds: Set<string>,
): RequeueAssignmentDecision[] {
  const decisions: RequeueAssignmentDecision[] = [];
  for (const row of assignments) {
    if (row.status !== "assigned") continue;
    if (!row.machine_id || !staleMachineIds.has(row.machine_id)) continue;
    decisions.push({ assignmentId: row.id, action: "requeue" });
  }
  return decisions;
}
