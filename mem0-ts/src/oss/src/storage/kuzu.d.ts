/**
 * Minimal ambient type declaration for the `kuzu` package.
 * The package ships a pre-built native addon without bundled TypeScript types.
 */
declare module "kuzu" {
  class Database {
    /** Pass a path for persistent storage; omit (or pass nothing) for in-memory mode. */
    constructor(databasePath?: string);
    close(): void;
  }

  class Connection {
    constructor(database: Database);
    prepare(query: string): Promise<PreparedStatement>;
    execute(
      preparedStatement: PreparedStatement,
      params?: Record<string, unknown>,
    ): Promise<QueryResult>;
    query(query: string): Promise<QueryResult>;
    close(): void;
  }

  class PreparedStatement {
    // opaque handle
  }

  class QueryResult {
    getAll(): Record<string, unknown>[];
    close(): void;
  }
}
