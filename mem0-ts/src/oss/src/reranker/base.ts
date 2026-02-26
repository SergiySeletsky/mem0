/**
 * Base reranker interface.
 * Rerankers re-score search results based on query relevance.
 */

/** A memory document record — allows any string keys for extensibility */
export type MemoryDocument = Record<string, unknown> & { rerank_score?: number };

export interface Reranker {
  /**
   * Rerank documents based on relevance to the query.
   *
   * @param query  The search query
   * @param documents  List of documents with at least a `memory` field
   * @param topK  Max results to return (undefined = return all)
   * @returns  Documents with added `rerank_score`, sorted descending
   */
  rerank(
    query: string,
    documents: MemoryDocument[],
    topK?: number,
  ): Promise<MemoryDocument[]>;
}

/** Helper to extract text from a document object (tries memory → text → content) */
export function extractDocText(doc: MemoryDocument): string {
  return (
    (doc.memory ?? doc.text ?? doc.content ?? JSON.stringify(doc)) as string
  );
}
