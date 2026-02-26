import { VectorStore } from "./base";
import { SearchFilters, VectorStoreConfig, VectorStoreResult } from "../types";

/**
 * In-memory vector store backed by a plain JS Map.
 * Zero external dependencies — intended for development and testing only.
 * For production use, configure a persistent vector store (Memgraph, Qdrant, etc.).
 */

interface MemoryEntry {
  id: string;
  vector: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload is an open-ended object matching VectorStoreResult.payload
  payload: Record<string, any>;
}

export class MemoryVectorStore implements VectorStore {
  private store: Map<string, MemoryEntry> = new Map();
  private dimension: number;
  private userId = "";

  constructor(config: VectorStoreConfig) {
    this.dimension = config.dimension || 1536;
  }

  async initialize(): Promise<void> {
    // Nothing to initialise for an in-memory store
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private matchesFilters(
    entry: MemoryEntry,
    filters?: SearchFilters,
  ): boolean {
    if (!filters) return true;
    return Object.entries(filters).every(
      ([key, value]) => entry.payload[key] === value,
    );
  }

  async insert(
    vectors: number[][],
    ids: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implements VectorStore; payload shape is provider-specific
    payloads: Record<string, any>[],
  ): Promise<void> {
    for (let i = 0; i < vectors.length; i++) {
      this.store.set(ids[i], {
        id: ids[i],
        vector: vectors[i],
        payload: payloads[i],
      });
    }
  }

  async search(
    query: number[],
    limit = 10,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    const results: VectorStoreResult[] = [];

    for (const entry of this.store.values()) {
      if (!this.matchesFilters(entry, filters)) continue;
      const score = this.cosineSimilarity(query, entry.vector);
      results.push({ id: entry.id, payload: entry.payload, score });
    }

    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return results.slice(0, limit);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const entry = this.store.get(vectorId);
    if (!entry) return null;
    return { id: entry.id, payload: entry.payload };
  }

  async update(
    vectorId: string,
    vector: number[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implements VectorStore; payload shape is provider-specific
    payload: Record<string, any>,
  ): Promise<void> {
    const existing = this.store.get(vectorId);
    this.store.set(vectorId, {
      id: vectorId,
      vector,
      payload: existing ? { ...existing.payload, ...payload } : payload,
    });
  }

  async delete(vectorId: string): Promise<void> {
    this.store.delete(vectorId);
  }

  async deleteCol(): Promise<void> {
    this.store.clear();
  }

  async list(
    filters?: SearchFilters,
    limit = 100,
  ): Promise<[VectorStoreResult[], number]> {
    const results: VectorStoreResult[] = [];

    for (const entry of this.store.values()) {
      if (this.matchesFilters(entry, filters)) {
        results.push({ id: entry.id, payload: entry.payload });
      }
    }

    return [results.slice(0, limit), results.length];
  }

  async getUserId(): Promise<string> {
    return this.userId;
  }

  async setUserId(userId: string): Promise<void> {
    this.userId = userId;
  }

  async reset(): Promise<void> {
    this.store.clear();
    this.userId = "";
  }
}
