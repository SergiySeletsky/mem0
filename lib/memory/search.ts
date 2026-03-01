/**
 * Memory search â€” Spec 00
 *
 * Core vector search pipeline â€” replaces mem0ai/oss Memory.search().
 * (Hybrid BM25 + RRF is layered on in Spec 02.)
 *
 * Spec 00 search path:
 *  1. Embed query via OpenAI
 *  2. CALL vector_search.search("memory_vectors", K, embedding) â€” user-scoped
 *  3. Return matches as MemoryNode[]
 */

import { runRead } from "@/lib/db/memgraph";
import { embed } from "@/lib/embeddings/intelli";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  content: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  appName?: string;
  metadata?: string;
  score?: number;
  validAt?: string;
  invalidAt?: string;
}

export interface ListOptions {
  userId: string;
  appName?: string;
  state?: string;
  page?: number;
  pageSize?: number;
  /** Spec 01: when true, include superseded (invalidAt IS NOT NULL) memories */
  includeSuperseeded?: boolean;
  /** Spec 01: ISO-8601 string; if set, return snapshot at this point in time */
  asOf?: string;
}

// ---------------------------------------------------------------------------
// Vector search (Spec 00 baseline; hybrid added in Spec 02)
// ---------------------------------------------------------------------------

/**
 * Semantic search over a user's memories using the Memgraph vector index.
 *
 * @param query    Natural-language query string
 * @param userId   Scope search to this user's memories
 * @param topK     Max results to return (default 10)
 * @param appName  Optional: scope further to a specific app
 */
export async function searchMemories(
  query: string,
  userId: string,
  topK = 10,
  appName?: string
): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);

  // The MAGE vector_search.search() procedure returns nodes ordered by
  // cosine similarity. We then filter to only current (non-deleted) memories
  // belonging to the requesting user.
  const cypher = appName
    ? `
      CALL vector_search.search("memory_vectors", toInteger($k), $embedding) YIELD node, similarity
      MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(node)
      MATCH (node)-[:CREATED_BY]->(a:App {appName: $appName})
      WHERE node.state <> 'deleted' AND node.invalidAt IS NULL
      RETURN node.id AS id,
             node.content AS content,
             node.state AS state,
             node.createdAt AS createdAt,
             node.updatedAt AS updatedAt,
             node.metadata AS metadata,
             $userId AS userId,
             a.appName AS appName,
             similarity AS score
      ORDER BY similarity DESC`
    : `
      CALL vector_search.search("memory_vectors", toInteger($k), $embedding) YIELD node, similarity
      MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(node)
      WHERE node.state <> 'deleted' AND node.invalidAt IS NULL
      OPTIONAL MATCH (node)-[:CREATED_BY]->(a:App)
      RETURN node.id AS id,
             node.content AS content,
             node.state AS state,
             node.createdAt AS createdAt,
             node.updatedAt AS updatedAt,
             node.metadata AS metadata,
             $userId AS userId,
             a.appName AS appName,
             similarity AS score
      ORDER BY similarity DESC`;

  const params: Record<string, unknown> = {
    userId,
    k: topK,
    embedding: queryEmbedding,
  };
  if (appName) params.appName = appName;

  return runRead<SearchResult>(cypher, params);
}

// ---------------------------------------------------------------------------
// List memories (no vector search â€” filter + pagination)
// ---------------------------------------------------------------------------

/**
 * List a user's memories with optional filters.
 * Spec 01: honours includeSuperseeded and asOf for bi-temporal queries.
 */
export async function listMemories(
  opts: ListOptions
): Promise<{ memories: SearchResult[]; total: number }> {
  const {
    userId,
    appName,
    state,
    page = 1,
    pageSize = 50,
    includeSuperseeded = false,
    asOf,
  } = opts;
  const skip = (page - 1) * pageSize;

  // Default: exclude both deleted and archived memories from the list.
  // Callers can pass state='archived' explicitly to query archived memories.
  const stateFilter = state
    ? `AND m.state = $state`
    : `AND m.state <> 'deleted' AND m.state <> 'archived'`;
  const params: Record<string, unknown> = { userId, skip, limit: pageSize };
  if (state) params.state = state;
  if (appName) params.appName = appName;

  // Bi-temporal filter (Spec 01)
  let temporalFilter: string;
  if (asOf) {
    // Point-in-time: memory was valid at the requested timestamp
    params.asOfIso = asOf;
    temporalFilter = `AND m.validAt <= $asOfIso AND (m.invalidAt IS NULL OR m.invalidAt > $asOfIso)`;
  } else if (includeSuperseeded) {
    // No temporal filter -- return all including superseded
    temporalFilter = "";
  } else {
    // Default: current facts only
    temporalFilter = `AND m.invalidAt IS NULL`;
  }

  // Put WHERE filters BEFORE OPTIONAL MATCH so they apply to (m) directly,
  // not inadvertently to the optional pattern.
  const appClause = appName
    ? `MATCH (m)-[:CREATED_BY]->(a:App {appName: $appName})`
    : `OPTIONAL MATCH (m)-[:CREATED_BY]->(a:App)`;

  const query = `
    MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
    WHERE true ${stateFilter} ${temporalFilter}
    ${appClause}
    RETURN m.id AS id, m.content AS content, m.state AS state,
           m.createdAt AS createdAt, m.updatedAt AS updatedAt,
           m.validAt AS validAt, m.invalidAt AS invalidAt,
           m.metadata AS metadata, $userId AS userId,
           a.appName AS appName
    ORDER BY m.createdAt DESC
    SKIP toInteger($skip) LIMIT toInteger($limit)`;

  const countQuery = `
    MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
    ${appName ? `MATCH (m)-[:CREATED_BY]->(a:App {appName: $appName})` : ""}
    WHERE true ${stateFilter} ${temporalFilter}
    RETURN count(m) AS total`;

  const [memories, countRows] = await Promise.all([
    runRead<SearchResult>(query, params),
    runRead(countQuery, params),
  ]);

  const raw = countRows[0]?.total;
  const total = typeof raw === "number" ? raw : (raw as { low?: number })?.low ?? 0;

  return { memories, total };
}
