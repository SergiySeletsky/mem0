import { z } from "zod";

export interface MultiModalMessages {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface Message {
  role: string;
  content: string | MultiModalMessages;
}

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string;
  url?: string;
  embeddingDims?: number;
  modelProperties?: Record<string, unknown>;
}

export interface VectorStoreConfig {
  collectionName?: string;
  dimension?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary provider-specific client instance
  client?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary provider-specific instance
  instance?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- index signature required for pass-through of provider-specific options
  [key: string]: any;
}

export interface HistoryStoreConfig {
  provider: string;
  config: {
    /** Memgraph / Neo4j connection URL (bolt://...) */
    url?: string;
    username?: string;
    password?: string;
    /** KuzuDB database path; omit or use ":memory:" for in-process in-memory store */
    dbPath?: string;
    tableName?: string;
  };
}

export interface LLMConfig {
  provider?: string;
  baseURL?: string;
  config?: Record<string, unknown>;
  apiKey?: string;
  model?: string;
  modelProperties?: Record<string, unknown>;
  /** Per-request timeout in milliseconds (default 30000) */
  timeout?: number;
  /** Number of retries on network error (default 1) */
  maxRetries?: number;
}

export interface Neo4jConfig {
  url: string;
  username: string;
  password: string;
}

export interface GraphStoreConfig {
  /** Graph store provider: "neo4j" (legacy MemoryGraph), "memgraph", or "kuzu". */
  provider: string;
  config: Partial<Neo4jConfig> & {
    /** KuzuDB-only: path to database directory. Omit or ":memory:" for in-process. */
    dbPath?: string;
    [key: string]: unknown;
  };
  llm?: LLMConfig;
  customPrompt?: string;
}

export interface MemoryConfig {
  version?: string;
  embedder: {
    provider: string;
    config: EmbeddingConfig;
  };
  vectorStore: {
    provider: string;
    config: VectorStoreConfig;
  };
  llm: {
    provider: string;
    config: LLMConfig;
  };
  historyStore?: HistoryStoreConfig;
  disableHistory?: boolean;
  historyDbPath?: string;
  customPrompt?: string;
  customUpdateMemoryPrompt?: string;
  graphStore?: GraphStoreConfig;
  enableGraph?: boolean;
  reranker?: {
    provider: string;
    config?: Record<string, unknown>;
  };
}

export interface MemoryItem {
  id: string;
  memory: string;
  hash?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchFilters {
  userId?: string;
  agentId?: string;
  runId?: string;
  [key: string]: string | undefined;
}

export interface SearchResult {
  results: MemoryItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- relations come from graph store with varying shapes
  relations?: Array<Record<string, any>>;
}

export interface VectorStoreResult {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload is an open-ended object from the vector DB
  payload: Record<string, any>;
  score?: number;
}

export const MemoryConfigSchema = z.object({
  version: z.string().optional(),
  embedder: z.object({
    provider: z.string(),
    config: z.object({
      modelProperties: z.record(z.string(), z.any()).optional(),
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      baseURL: z.string().optional(),
      embeddingDims: z.number().optional(),
      url: z.string().optional(),
    }),
  }),
  vectorStore: z.object({
    provider: z.string(),
    config: z
      .object({
        collectionName: z.string().optional(),
        dimension: z.number().optional(),
        client: z.any().optional(),
      })
      .passthrough(),
  }),
  llm: z.object({
    provider: z.string(),
    config: z.object({
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      modelProperties: z.record(z.string(), z.any()).optional(),
      baseURL: z.string().optional(),
    }),
  }),
  historyDbPath: z.string().optional(),
  customPrompt: z.string().optional(),
  customUpdateMemoryPrompt: z.string().optional(),
  enableGraph: z.boolean().optional(),
  graphStore: z
    .object({
      provider: z.string(),
      config: z
        .object({
          // Memgraph connection fields (optional — not needed for kuzu provider)
          url: z.string().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
        })
        .passthrough(),
      llm: z
        .object({
          provider: z.string(),
          config: z.record(z.string(), z.any()),
        })
        .optional(),
      customPrompt: z.string().optional(),
    })
    .optional(),
  historyStore: z
    .object({
      provider: z.string(),
      config: z.record(z.string(), z.any()),
    })
    .optional(),
  disableHistory: z.boolean().optional(),
  reranker: z
    .object({
      provider: z.string(),
      config: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
});
