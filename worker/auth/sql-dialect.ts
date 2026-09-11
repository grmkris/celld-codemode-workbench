import {
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
} from "kysely";
import type { SqlStorage } from "@cloudflare/workers-types";

export interface CelldSqliteDialectConfig {
  storage: SqlStorage;
  onCreateConnection?: (connection: DatabaseConnection) => Promise<void>;
}

class ConnectionMutex {
  #promise?: Promise<void>;
  #resolve?: () => void;

  async lock(): Promise<void> {
    while (this.#promise) {
      await this.#promise;
    }
    this.#promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  unlock(): void {
    const resolve = this.#resolve;
    this.#promise = undefined;
    this.#resolve = undefined;
    resolve?.();
  }
}

class CelldSqliteConnection implements DatabaseConnection {
  constructor(private readonly storage: SqlStorage) {}

  executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { sql, parameters } = compiledQuery;
    const cursor = this.storage.exec(sql, ...parameters);
    const lead = sql.trimStart().toUpperCase();
    const isSelect =
      lead.startsWith("SELECT") || lead.startsWith("WITH") || lead.startsWith("PRAGMA");
    if (isSelect) {
      return Promise.resolve({ rows: cursor.toArray() as R[] });
    }
    const rowsWritten = cursor.rowsWritten ?? 0;
    let insertId: bigint | undefined;
    if (lead.startsWith("INSERT")) {
      const row = this.storage.exec("SELECT last_insert_rowid() AS id").one() as { id?: number };
      if (row?.id != null) insertId = BigInt(row.id);
    }
    return Promise.resolve({
      rows: [],
      numAffectedRows: BigInt(rowsWritten),
      insertId,
    });
  }

  streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize?: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    return (async function* () {
      yield await Promise.reject(new Error("Celld SqlStorage does not support streaming queries"));
    })();
  }
}

class CelldSqliteDriver implements Driver {
  #config: CelldSqliteDialectConfig;
  #connection?: CelldSqliteConnection;
  #mutex = new ConnectionMutex();

  constructor(config: CelldSqliteDialectConfig) {
    this.#config = { ...config };
  }

  async init(): Promise<void> {
    this.#connection = new CelldSqliteConnection(this.#config.storage);
    if (this.#config.onCreateConnection) {
      await this.#config.onCreateConnection(this.#connection);
    }
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    await this.#mutex.lock();
    if (!this.#connection) {
      throw new Error("CelldSqliteDriver not initialized");
    }
    return this.#connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(): Promise<void> {
    this.#mutex.unlock();
  }

  async destroy(): Promise<void> {}
}

export class CelldSqliteDialect implements Dialect {
  #config: CelldSqliteDialectConfig;

  constructor(config: CelldSqliteDialectConfig) {
    this.#config = { ...config };
  }

  createDriver(): Driver {
    return new CelldSqliteDriver(this.#config);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}
