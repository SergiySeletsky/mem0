import neo4j, { Driver, Session } from "neo4j-driver";
import { VectorStore } from "./base";
import { SearchFilters, VectorStoreConfig, VectorStoreResult } from "../types";

interface MemgraphVectorStoreConfig extends VectorStoreConfig {
  url?: string;
  username?: string;
  password?: string;
  /** Name of the Memgraph vector index (default: "mem0_vectors") */
  indexName?: string;
  metric?: "cos" | "l2";
}

export class MemgraphVectorStore implements VectorStore {
  private driver: Driver;
  private indexName: string;
  private dimension: number;
  private metric: "cos" | "l2";
  private userId = "";
  private initialized: Promise<void>;

  constructor(config: MemgraphVectorStoreConfig) {
    this.indexName = config.indexName || config.collectionName || "mem0_vectors";
    this.dimension = config.dimension || 1536;
    this.metric = config.metric || "cos";
    this.driver = neo4j.driver(
      config.url || process.env.MEMGRAPH_URL || "bolt://localhost:7687",
      neo4j.auth.basic(
        config.username || process.env.MEMGRAPH_USER || "memgraph",
        config.password || process.env.MEMGRAPH_PASSWORD || "memgraph",
      ),
      { disableLosslessIntegers: true },
    );
    this.initialized = this.init();
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
      s.run(
        `CREATE VECTOR INDEX $idx ON :MemVector(embedding)
         OPTIONS {size: $size, metric: $metric}`,
        { idx: this.indexName, size: this.dimension, metric: this.metric },
      ).catch(() => {
        // Index may already exist — not an error
      }),
    );
  }

  async initialize(): Promise<void> {
    await this.initialized;
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    await this.initialized;
    await this.withSession(async (s) => {
      for (let i = 0; i < vectors.length; i++) {
        await s.run(
          `MERGE (v:MemVector {id: $id})
           SET v.embedding = $embedding,
               v.payload   = $payload`,
          {
            id: ids[i],
            embedding: vectors[i],
            payload: JSON.stringify(payloads[i]),
          },
        );
      }
    });
  }

  async search(
    query: number[],
    limit: number = 10,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    await this.initialized;
    return this.withSession(async (s) => {
      // Use Memgraph MAGE vector_search module
      const result = await s.run(
        `CALL vector_search.search($idx, $k, $query) YIELD node, similarity
         RETURN node, similarity`,
        { idx: this.indexName, k: limit * 4, query },
      );

      const rows: VectorStoreResult[] = result.records
        .map((r) => {
          const node = r.get("node").properties;
          const payload = JSON.parse(node.payload as string);
          return {
            id: node.id as string,
            payload,
            score: r.get("similarity") as number,
          };
        })
        .filter((r) => this.matchesFilters(r.payload, filters))
        .slice(0, limit);

      return rows;
    });
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    await this.initialized;
    return this.withSession(async (s) => {
      const result = await s.run(
        "MATCH (v:MemVector {id: $id}) RETURN v",
        { id: vectorId },
      );
      if (!result.records.length) return null;
      const node = result.records[0].get("v").properties;
      return { id: node.id as string, payload: JSON.parse(node.payload as string) };
    });
  }

  async update(
    vectorId: string,
    vector: number[] | null,
    payload: Record<string, any>,
  ): Promise<void> {
    await this.initialized;
    await this.withSession((s) =>
      s.run(
        `MATCH (v:MemVector {id: $id})
         SET v.payload = $payload
         ${vector ? ", v.embedding = $embedding" : ""}`,
        { id: vectorId, payload: JSON.stringify(payload), embedding: vector },
      ),
    );
  }

  async delete(vectorId: string): Promise<void> {
    await this.initialized;
    await this.withSession((s) =>
      s.run("MATCH (v:MemVector {id: $id}) DETACH DELETE v", { id: vectorId }),
    );
  }

  async deleteCol(): Promise<void> {
    await this.initialized;
    await this.withSession((s) => s.run("MATCH (v:MemVector) DETACH DELETE v"));
  }

  async list(
    filters?: SearchFilters,
    limit: number = 100,
  ): Promise<[VectorStoreResult[], number]> {
    await this.initialized;
    return this.withSession(async (s) => {
      const result = await s.run("MATCH (v:MemVector) RETURN v LIMIT $limit", {
        limit,
      });
      const all: VectorStoreResult[] = result.records
        .map((r) => {
          const node = r.get("v").properties;
          const payload = JSON.parse(node.payload as string);
          return { id: node.id as string, payload };
        })
        .filter((r) => this.matchesFilters(r.payload, filters));
      return [all, all.length] as [VectorStoreResult[], number];
    });
  }

  async getUserId(): Promise<string> {
    return this.userId;
  }

  async setUserId(userId: string): Promise<void> {
    this.userId = userId;
  }

  async reset(): Promise<void> {
    await this.deleteCol();
  }

  private matchesFilters(payload: Record<string, any>, filters?: SearchFilters): boolean {
    if (!filters) return true;
    return Object.entries(filters).every(([k, v]) => payload[k] === v);
  }

  close(): void {
    this.driver.close().catch((e) => console.warn("[MemgraphVectorStore] close error:", e));
  }
}
