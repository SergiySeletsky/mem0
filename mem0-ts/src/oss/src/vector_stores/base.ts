import { SearchFilters, VectorStoreResult } from "../types";

export interface VectorStore {
  insert(
    vectors: number[][],
    ids: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload shape is open-ended per provider
    payloads: Record<string, any>[],
  ): Promise<void>;
  search(
    query: number[],
    limit?: number,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]>;
  get(vectorId: string): Promise<VectorStoreResult | null>;
  update(
    vectorId: string,
    vector: number[] | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload shape is open-ended per provider
    payload: Record<string, any>,
  ): Promise<void>;
  delete(vectorId: string): Promise<void>;
  deleteCol(): Promise<void>;
  list(
    filters?: SearchFilters,
    limit?: number,
  ): Promise<[VectorStoreResult[], number]>;
  getUserId(): Promise<string>;
  setUserId(userId: string): Promise<void>;
  initialize(): Promise<void>;
  reset?(): Promise<void>;
}
