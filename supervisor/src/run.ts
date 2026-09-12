import { CelldClient } from "./client.js";
import type { SupervisorCredentials } from "./credentials.js";
import {
  assertDockerAvailable,
  createDockerClient,
  createRunnerContainer,
  stopContainer,
  sweepDisposableEnvironments,
  type Assignment,
} from "./docker.js";
import { SupervisorJournal } from "./journal.js";
import { credentialsDir } from "./credentials.js";

type ActiveRun = {
  containerId: string;
  assignment: Assignment;
  lease?: string;
  generation?: number;
  taskCellAddress?: string;
};

export async function runSupervisor(
  creds: SupervisorCredentials,
  options: { allowHost?: boolean; once?: boolean } = {},
): Promise<void> {
  const client = new CelldClient(creds);
  const journal = new SupervisorJournal(credentialsDir(creds.name), "journal");
  const activeContainers = new Set<string>();
  const activeByAttempt = new Map<string, ActiveRun>();

  let docker: ReturnType<typeof createDockerClient> | null = null;
  if (!options.allowHost) {
    docker = createDockerClient();
    await assertDockerAvailable(docker);
  } else {
    console.warn("supervisor: --allow-host enabled; skipping Docker provisioning");
  }

  console.log(`supervisor run name=${creds.name} machine=${creds.machineId} team=${creds.teamId}`);

  for (;;) {
    const attempts = [...activeByAttempt.values()]
      .map((row) => ({
        attemptId: row.assignment.attemptId,
        taskCellAddress:
          row.taskCellAddress ??
          String(
            (row.assignment.payload as { taskCellAddress?: string } | null)?.taskCellAddress ?? "",
          ),
        lease:
          row.lease ?? String((row.assignment.payload as { lease?: string } | null)?.lease ?? ""),
        generation: Number(
          row.generation ??
            (row.assignment.payload as { generation?: number } | null)?.generation ??
            0,
        ),
      }))
      .filter((row) => row.attemptId && row.taskCellAddress && row.lease);

    await client.heartbeat({ attempts }).catch((error) => {
      console.warn("heartbeat failed:", error instanceof Error ? error.message : error);
    });

    const poll = await client.poll();
    for (const cancel of poll.cancels) {
      journal.append("cancel", cancel);
      console.log(`cancel signal task=${cancel.taskId} attempt=${cancel.attemptId}`);
      const active = activeByAttempt.get(cancel.attemptId);
      if (active && docker) {
        await stopContainer(docker, active.containerId);
        activeContainers.delete(active.containerId);
        activeByAttempt.delete(cancel.attemptId);
        journal.recordEnvironment({
          id: crypto.randomUUID(),
          kind: "disposable",
          containerId: active.containerId,
          status: "cancelled",
          assignmentId: active.assignment.assignmentId,
        });
        const payload = (active.assignment.payload ?? {}) as Record<string, unknown>;
        await client
          .postAttemptEvents({
            attemptId: cancel.attemptId,
            lease: String(payload.lease ?? active.lease ?? ""),
            generation: Number(payload.generation ?? active.generation ?? 0),
            taskCellAddress: String(payload.taskCellAddress ?? active.taskCellAddress ?? ""),
            teamId: active.assignment.teamId,
            conversationId: active.assignment.conversationId,
            events: [{ kind: "attempt.cancelled", payload: { taskId: cancel.taskId } }],
          })
          .catch((error) => {
            console.warn(
              "attempt.cancelled event failed:",
              error instanceof Error ? error.message : error,
            );
          });
      }
    }

    for (const assignment of poll.assignments) {
      journal.append("assignment", assignment);
      const payload = (assignment.payload ?? {}) as Record<string, unknown>;
      if (docker) {
        const envId = crypto.randomUUID();
        const handle = await createRunnerContainer(docker, creds, assignment);
        activeContainers.add(handle.id);
        activeByAttempt.set(assignment.attemptId, {
          containerId: handle.id,
          assignment,
          lease: String(payload.lease ?? ""),
          generation: Number(payload.generation ?? 0),
          taskCellAddress: String(payload.taskCellAddress ?? ""),
        });
        journal.recordEnvironment({
          id: envId,
          kind: "disposable",
          containerId: handle.id,
          status: "active",
          assignmentId: assignment.assignmentId,
        });
        console.log(`started container ${handle.name} for attempt ${assignment.attemptId}`);
      } else {
        console.log(`host-mode assignment task=${assignment.taskId} (no container)`);
      }
    }

    if (docker) {
      const swept = await sweepDisposableEnvironments(docker, activeContainers);
      if (swept > 0) console.log(`swept ${swept} disposable environment(s)`);
    }

    if (options.once) break;
    await sleep(2_000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { Assignment };
