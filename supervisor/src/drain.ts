import { CelldClient } from "./client.js";
import type { SupervisorCredentials } from "./credentials.js";
import { createDockerClient, stopContainer, sweepDisposableEnvironments } from "./docker.js";
import { SupervisorJournal } from "./journal.js";
import { credentialsDir } from "./credentials.js";

export async function drainSupervisor(creds: SupervisorCredentials): Promise<void> {
  const client = new CelldClient(creds);
  await client.drain();
  const journal = new SupervisorJournal(credentialsDir(creds.name), "journal");
  journal.append("drain", { at: Date.now() });

  const docker = createDockerClient();
  const active = new Set(
    journal
      .activeEnvironments()
      .map((row) => row.container_id)
      .filter((id): id is string => Boolean(id)),
  );

  for (const id of active) {
    await stopContainer(docker, id);
    journal.releaseEnvironment(id);
  }

  await sweepDisposableEnvironments(docker, new Set());
  console.log(`supervisor drained name=${creds.name}`);
}
