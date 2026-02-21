import neo4j, { Driver, Session } from "neo4j-driver";
import { HistoryManager } from "./base";

interface MemgraphHistoryConfig {
  url?: string;
  username?: string;
  password?: string;
}

export class MemgraphHistoryManager implements HistoryManager {
  private driver: Driver;

  constructor(config: MemgraphHistoryConfig = {}) {
    this.driver = neo4j.driver(
      config.url || process.env.MEMGRAPH_URL || "bolt://localhost:7687",
      neo4j.auth.basic(
        config.username || process.env.MEMGRAPH_USER || "memgraph",
        config.password || process.env.MEMGRAPH_PASSWORD || "memgraph",
      ),
      { disableLosslessIntegers: true },
    );
    this.init().catch((e) => console.warn("[MemgraphHistoryManager] init failed:", e));
  }

  private async withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    const session = this.driver.session();
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  private async init(): Promise<void> {
    await this.withSession((s) =>
      s.run("CREATE INDEX ON :MemoryHistory(memory_id) IF NOT EXISTS").catch(() => {
        // Memgraph versions <2.16 use a different syntax — silence and continue
      }),
    );
  }

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: string,
    createdAt?: string,
    updatedAt?: string,
    isDeleted: number = 0,
  ): Promise<void> {
    await this.withSession((s) =>
      s.run(
        `CREATE (h:MemoryHistory {
          id: randomUUID(),
          memory_id: $memoryId,
          previous_value: $previousValue,
          new_value: $newValue,
          action: $action,
          created_at: $createdAt,
          updated_at: $updatedAt,
          is_deleted: $isDeleted
        })`,
        {
          memoryId,
          previousValue: previousValue ?? null,
          newValue: newValue ?? null,
          action,
          createdAt: createdAt || new Date().toISOString(),
          updatedAt: updatedAt ?? null,
          isDeleted,
        },
      ),
    );
  }

  async getHistory(memoryId: string): Promise<any[]> {
    return this.withSession(async (s) => {
      const result = await s.run(
        `MATCH (h:MemoryHistory {memory_id: $memoryId})
         RETURN h
         ORDER BY h.created_at DESC
         LIMIT 100`,
        { memoryId },
      );
      return result.records.map((r) => r.get("h").properties);
    });
  }

  async reset(): Promise<void> {
    await this.withSession((s) => s.run("MATCH (h:MemoryHistory) DETACH DELETE h"));
  }

  close(): void {
    this.driver.close().catch((e) => console.warn("[MemgraphHistoryManager] close error:", e));
  }
}
