export type SqlRow = Record<string, unknown>;

export class Sql {
  constructor(private readonly storage: DurableObjectStorage) {}

  exec(query: string, ...binds: unknown[]): SqlRow[] {
    const cursor = this.storage.sql.exec(query, ...binds);
    return [...cursor] as SqlRow[];
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  one<T extends SqlRow>(query: string, ...binds: unknown[]): T | null {
    return (this.exec(query, ...binds)[0] as T | undefined) ?? null;
  }

  migrate(schemaSql: string, version: number): void {
    this.storage.sql.exec(schemaSql);
    const current = this.one<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      "schema_version",
    );
    const currentVersion = current ? Number(current.value) : 0;
    if (currentVersion < version) {
      this.exec(
        "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        "schema_version",
        String(version),
      );
    }
  }

  prune(table: string, keep: number): void {
    this.exec(
      `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY created_at DESC LIMIT ?)`,
      keep,
    );
  }
}
