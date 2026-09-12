import { CelldClient } from "./client.js";
import type { SupervisorCredentials } from "./credentials.js";
import {
  assertDockerAvailable,
  createDockerClient,
  createRunnerContainer,
  sweepDisposableEnvironments,
  type Assignment,
} from "./docker.js";
import { SupervisorJournal } from "./journal.js";
import { credentialsDir } from "./credentials.js";

export async function runSupervisor(
  creds: SupervisorCredentials,
  options: { allowHost?: boolean; once?: boolean } = {},
): Promise<void> {
  const client = new CelldClient(creds);
  const journal = new SupervisorJournal(credentialsDir(creds.name), "journal");
  const activeContainers = new Set<string>();

  let docker: ReturnType<typeof createDockerClient> | null = null;
  if (!options.allowHost) {
    docker = createDockerClient();
    await assertDockerAvailable(docker);
  } else {
    console.warn("supervisor: --allow-host enabled; skipping Docker provisioning");
  }

  console.log(`supervisor run name=${creds.name} machine=${creds.machineId} team=${creds.teamId}`);

  for (;;) {
    await client.heartbeat().catch((error) => {
      console.warn("heartbeat failed:", error instanceof Error ? error.message : error);
    });

    const poll = await client.poll();
    for (const cancel of poll.cancels) {
      journal.append("cancel", cancel);
      console.log(`cancel signal task=${cancel.taskId} attempt=${cancel.attemptId}`);
    }

    for (const assignment of poll.assignments) {
      journal.append("assignment", assignment);
      if (docker) {
        const envId = crypto.randomUUID();
        const handle = await createRunnerContainer(docker, creds, assignment);
        activeContainers.add(handle.id);
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
