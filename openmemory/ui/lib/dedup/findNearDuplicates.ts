/**
 * lib/dedup/findNearDuplicates.ts — Stage 1 vector similarity check
 *
 * Embeds the new memory text and queries Memgraph vector_search for
 * existing memories that are semantically close (≥ threshold cosine similarity).
 */
import { runRead } from "@/lib/db/memgraph";
import { embed } from "@/lib/embeddings/openai";

export interface DuplicateCandidate {
  id: string;
  content: string;
  score: number; // cosine similarity 0–1
}

/**
 * Returns existing Memory nodes semantically similar to `text` for the given user.
 * Only returns nodes where invalidAt IS NULL and state <> 'deleted'.
 *
 * Fails open: returns [] on any error so the write pipeline is never blocked.
 */
export async function findNearDuplicates(
  text: string,
  userId: string,
  threshold: number = 0.85,
  limit: number = 5
): Promise<DuplicateCandidate[]> {
  try {
    const embedding = await embed(text);

    const records = await runRead(
      `CALL vector_search.search("memory_vectors", toInteger($limit), $embedding)
       YIELD node, similarity
       MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(node)
       WHERE node.invalidAt IS NULL AND node.state <> 'deleted'
         AND similarity >= $threshold
       RETURN node.id AS id, node.content AS content, similarity
       ORDER BY similarity DESC`,
      { userId, limit: limit * 2, embedding, threshold }
    );

    return records.slice(0, limit).map((r) => ({
      id: r.id as string,
      content: r.content as string,
      score: r.similarity as number,
    }));
  } catch (e) {
    console.warn("[dedup] vector search failed:", e);
    return [];
  }
}
