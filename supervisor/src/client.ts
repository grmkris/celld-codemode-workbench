import type { SupervisorCredentials } from "./credentials.js";

export class CelldClient {
  constructor(private readonly creds: SupervisorCredentials) {}

  authHeaders(extra?: Record<string, string>): Record<string, string> {
    return this.headers(extra);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.creds.credential}`,
      "x-celld-machine-id": this.creds.machineId,
      ...extra,
    };
  }

  async enroll(
    token: string,
    name: string,
    labels: Record<string, string>,
    capacities: Record<string, unknown>,
  ) {
    const res = await fetch(`${this.creds.baseUrl}/api/machines/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, labels, capacities }),
    });
    if (!res.ok) throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ machineId: string; teamId: string; credential: string }>;
  }

  async poll(timeoutMs = 25_000) {
    const res = await fetch(`${this.creds.baseUrl}/api/machines/${this.creds.machineId}/poll`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ timeoutMs }),
    });
    if (!res.ok) throw new Error(`poll failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{
      assignments: Array<{
        assignmentId: string;
        teamId: string;
        taskId: string;
        attemptId: string;
        conversationId: string;
        payload: unknown;
      }>;
      cancels: Array<{ assignmentId: string; taskId: string; attemptId: string }>;
    }>;
  }

  async heartbeat(
    body: {
      attempts?: Array<{
        attemptId: string;
        taskCellAddress: string;
        lease: string;
        generation: number;
        ttlMs?: number;
      }>;
    } = {},
  ) {
    const res = await fetch(
      `${this.creds.baseUrl}/api/machines/${this.creds.machineId}/heartbeat`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`heartbeat failed: ${res.status}`);
    return res.json();
  }

  async postAttemptEvents(input: {
    attemptId: string;
    lease: string;
    generation: number;
    taskCellAddress: string;
    teamId: string;
    conversationId: string;
    events: Array<{ kind: string; payload?: unknown }>;
  }) {
    const res = await fetch(
      `${this.creds.baseUrl}/api/machines/${this.creds.machineId}/attempts/${encodeURIComponent(input.attemptId)}/events`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          lease: input.lease,
          generation: input.generation,
          taskCellAddress: input.taskCellAddress,
          teamId: input.teamId,
          conversationId: input.conversationId,
          events: input.events,
        }),
      },
    );
    if (!res.ok) throw new Error(`attempt events failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async drain() {
    const res = await fetch(`${this.creds.baseUrl}/api/machines/${this.creds.machineId}/drain`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`drain failed: ${res.status}`);
    return res.json();
  }

  taskEventsUrl(teamId: string, conversationId: string, attemptId: string): string {
    return `${this.creds.baseUrl}/api/teams/${teamId}/conversations/${conversationId}/tasks/attempts/${attemptId}/events`;
  }

  toolExecUrl(teamId: string, conversationId: string, attemptId: string): string {
    return `${this.creds.baseUrl}/api/teams/${teamId}/conversations/${conversationId}/tasks/attempts/${attemptId}/tool-exec`;
  }

  artifactChunkUrl(teamId: string, conversationId: string, artifactId: string): string {
    return `${this.creds.baseUrl}/api/teams/${teamId}/conversations/${conversationId}/tasks/artifacts/${artifactId}/chunks`;
  }
}
