import { CelldClient } from "./client.js";
import { saveCredentials, type SupervisorCredentials } from "./credentials.js";

export async function enrollSupervisor(input: {
  name: string;
  baseUrl: string;
  token: string;
  labels?: Record<string, string>;
  capacities?: Record<string, unknown>;
}): Promise<SupervisorCredentials> {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const bootstrap: SupervisorCredentials = {
    name: input.name,
    baseUrl,
    machineId: "",
    teamId: "",
    credential: "",
    enrolledAt: 0,
  };
  const client = new CelldClient(bootstrap);
  const result = await client.enroll(
    input.token,
    input.name,
    input.labels ?? { role: "supervisor" },
    input.capacities ?? { workspaces: 1, memoryMb: 512 },
  );

  const creds: SupervisorCredentials = {
    name: input.name,
    baseUrl,
    machineId: result.machineId,
    teamId: result.teamId,
    credential: result.credential,
    enrolledAt: Date.now(),
  };
  saveCredentials(creds);
  return creds;
}
