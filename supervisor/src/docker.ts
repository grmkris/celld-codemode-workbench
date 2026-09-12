import Dockerode from "dockerode";
import type { SupervisorCredentials } from "./credentials.js";

export type Assignment = {
  assignmentId: string;
  teamId: string;
  taskId: string;
  attemptId: string;
  conversationId: string;
  payload: unknown;
};

export type ContainerHandle = {
  id: string;
  name: string;
};

const DEFAULT_MEMORY = 512 * 1024 * 1024;
const DEFAULT_NANO_CPUS = 1_000_000_000;

export function createDockerClient(): Dockerode {
  return new Dockerode({ socketPath: "/var/run/docker.sock" });
}

export async function assertDockerAvailable(docker: Dockerode): Promise<void> {
  try {
    await docker.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Docker unavailable (${message}). Install/start Docker or pass --allow-host for development only.`,
    );
  }
}

export async function createRunnerContainer(
  docker: Dockerode,
  creds: SupervisorCredentials,
  assignment: Assignment,
  options: {
    image?: string;
    envKind?: "retained" | "disposable";
    runnerPath?: string;
  } = {},
): Promise<ContainerHandle> {
  const image = options.image ?? process.env.CELLD_RUNNER_IMAGE ?? "celld-runner:local";
  const envKind = options.envKind ?? "disposable";
  const name = `celld-${assignment.attemptId.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}`;

  const assignmentJson = JSON.stringify({
    ...assignment,
    baseUrl: creds.baseUrl,
    machineId: creds.machineId,
    envKind,
  });

  const container = await docker.createContainer({
    name,
    Image: image,
    Env: [
      `CELLD_ASSIGNMENT_JSON=${assignmentJson}`,
      `CELLD_BASE_URL=${creds.baseUrl}`,
      `CELLD_MACHINE_ID=${creds.machineId}`,
      `CELLD_ENV_KIND=${envKind}`,
    ],
    HostConfig: {
      Memory: DEFAULT_MEMORY,
      NanoCpus: DEFAULT_NANO_CPUS,
      PidsLimit: 256,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      AutoRemove: envKind === "disposable",
      ReadonlyRootfs: false,
    },
    User: "1000:1000",
    Labels: {
      "celld.team": creds.teamId,
      "celld.task": assignment.taskId,
      "celld.attempt": assignment.attemptId,
      "celld.env": envKind,
      "celld.supervisor": creds.name,
    },
  });

  await container.start();
  return { id: container.id, name };
}

export async function exportContainerWorkspace(
  docker: Dockerode,
  containerId: string,
  workspacePath = "/workspace",
): Promise<Buffer> {
  const container = docker.getContainer(containerId);
  const archive = await container.getArchive({ path: workspacePath });
  const chunks: Buffer[] = [];
  for await (const chunk of archive) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function stopContainer(docker: Dockerode, containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: 10 });
  } catch {
    // already stopped
  }
}

/** Sweeper stub — skips environments with active leases. */
export async function sweepDisposableEnvironments(
  docker: Dockerode,
  activeContainerIds: Set<string>,
): Promise<number> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ["celld.env=disposable"] },
  });
  let removed = 0;
  for (const info of containers) {
    if (activeContainerIds.has(info.Id)) continue;
    if (info.State === "running") continue;
    try {
      await docker.getContainer(info.Id).remove({ force: true });
      removed += 1;
    } catch {
      // best effort
    }
  }
  return removed;
}
