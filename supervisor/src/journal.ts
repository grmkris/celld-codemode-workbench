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
      CREATE TABLE IF NOT EXISTS journal_offsets (
        attempt_id TEXT PRIMARY KEY,
        container_id TEXT,
        byte_offset INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
    try {
      this.db.exec(`ALTER TABLE environments ADD COLUMN assignment_json TEXT`);
    } catch {
      // column already present
    }
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
    assignment?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO environments(id, kind, container_id, status, assignment_id, assignment_json, created_at, released_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.kind,
        input.containerId ?? null,
        input.status,
        input.assignmentId ?? null,
        input.assignment ? JSON.stringify(input.assignment) : null,
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

  activeEnvironments(): Array<{
    id: string;
    kind: string;
    container_id: string | null;
    assignment_id: string | null;
    assignment_json: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT id, kind, container_id, assignment_id, assignment_json
         FROM environments WHERE status = 'active' AND released_at IS NULL`,
      )
      .all() as Array<{
      id: string;
      kind: string;
      container_id: string | null;
      assignment_id: string | null;
      assignment_json: string | null;
    }>;
  }

  getJournalOffset(attemptId: string): number | null {
    const row = this.db
      .prepare("SELECT byte_offset FROM journal_offsets WHERE attempt_id = ?")
      .get(attemptId) as { byte_offset: number } | undefined;
    return row ? Number(row.byte_offset) : null;
  }

  setJournalOffset(attemptId: string, byteOffset: number, containerId?: string): void {
    this.db
      .prepare(
        `INSERT INTO journal_offsets(attempt_id, container_id, byte_offset, updated_at)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(attempt_id) DO UPDATE SET
           container_id = excluded.container_id,
           byte_offset = excluded.byte_offset,
           updated_at = excluded.updated_at`,
      )
      .run(attemptId, containerId ?? null, byteOffset, Date.now());
  }

  listJournalOffsets(): Array<{
    attempt_id: string;
    container_id: string | null;
    byte_offset: number;
  }> {
    return this.db
      .prepare("SELECT attempt_id, container_id, byte_offset FROM journal_offsets")
      .all() as Array<{ attempt_id: string; container_id: string | null; byte_offset: number }>;
  }
}
