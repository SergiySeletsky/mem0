/**
 * Full-text search wrapper -- Spec 02
 *
 * Wraps the Memgraph text_search.search_all() procedure.
 * The `memory_text` index is created in initSchema() (lib/db/memgraph.ts).
 *
 * Uses search_all() instead of search() because search() requires Tantivy
 * field-prefix syntax ("data.content:term") while search_all() searches
 * across all indexed text properties automatically.
 *
 * Returns results in relevance order (as returned by Memgraph) with 1-based rank.
 * Bi-temporal filter: only returns memories where invalidAt IS NULL.
 */

import { runRead } from "@/lib/db/memgraph";

export interface TextResult {
  id: string;
  /** 1-based position in text_search result set */
  rank: number;
}

/**
 * Full-text search over a user's memories using the Memgraph text index.
 *
 * @param query   Search query string
 * @param userId  Scope results to this user
 * @param limit   Maximum number of results to return (default 20)
 */
export async function textSearch(
  query: string,
  userId: string,
  limit = 20
): Promise<TextResult[]> {
  const records = await runRead(
    `CALL text_search.search_all("memory_text", $query) YIELD node AS m
     MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m)
     WHERE m.invalidAt IS NULL AND m.state <> 'deleted'
     RETURN m.id AS id
     LIMIT $limit`,
    { userId, query, limit }
  );
  return records.map((r, i) => ({ id: r.id as string, rank: i + 1 }));
}
