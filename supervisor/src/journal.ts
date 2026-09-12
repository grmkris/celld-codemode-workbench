import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type JournalEntry = {
  id: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
};

export class SupervisorJournal {
  private readonly db: DatabaseSync;

  constructor(rootDir: string, name: string) {
    mkdirSync(rootDir, { recursive: true });
    this.db = new DatabaseSync(join(rootDir, `${name}.sqlite`));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('retained', 'disposable', 'host')),
        container_id TEXT,
        status TEXT NOT NULL,
        assignment_id TEXT,
        created_at INTEGER NOT NULL,
        released_at INTEGER
      );
    `);
  }

  append(kind: string, payload: unknown): void {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO journal(id, kind, payload_json, created_at) VALUES(?, ?, ?, ?)")
      .run(id, kind, JSON.stringify(payload), now);
  }

  recordEnvironment(input: {
    id: string;
    kind: "retained" | "disposable" | "host";
    containerId?: string;
    status: string;
    assignmentId?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO environments(id, kind, container_id, status, assignment_id, created_at, released_at)
       VALUES(?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.kind,
        input.containerId ?? null,
        input.status,
        input.assignmentId ?? null,
        Date.now(),
      );
  }

  releaseEnvironment(id: string): void {
    this.db
      .prepare(
        "UPDATE environments SET status = 'released', released_at = ? WHERE id = ? AND released_at IS NULL",
      )
      .run(Date.now(), id);
  }

  activeEnvironments(): Array<{ id: string; kind: string; container_id: string | null }> {
    return this.db
      .prepare(
        "SELECT id, kind, container_id FROM environments WHERE status = 'active' AND released_at IS NULL",
      )
      .all() as Array<{ id: string; kind: string; container_id: string | null }>;
  }
}
