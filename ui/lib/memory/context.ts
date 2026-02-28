/**
 * lib/memory/context.ts — Context window fetch and format utilities (Spec 05)
 *
 * Provides recent user memories as context for the LLM embedding step in addMemory().
 * When enabled, the embedding captures semantic relationships with prior stored facts.
 */
import { runRead } from "@/lib/db/memgraph";

export interface ContextMemory {
  id: string;
  content: string;
  createdAt: string;
}

/**
 * Retrieve the last `limit` active (non-deleted, non-superseded) memories for a user.
 * Returns results in descending createdAt order (most recent first).
 */
export async function getRecentMemories(
  userId: string,
  limit: number = 10
): Promise<ContextMemory[]> {
  const records = await runRead<{ id: string; content: string; createdAt: string }>(
    `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
     WHERE m.state <> 'deleted' AND m.invalidAt IS NULL
     RETURN m.id AS id, m.content AS content, m.createdAt AS createdAt
     ORDER BY m.createdAt DESC
     LIMIT $limit`,
    { userId, limit }
  );

  return records.map((r) => ({
    id: r.id as string,
    content: r.content as string,
    createdAt: r.createdAt as string,
  }));
}

/**
 * Format a list of recent memories into a context prefix string.
 * Memories are presented in chronological order (oldest first) for narrative flow.
 * Returns empty string when the list is empty.
 */
export function buildContextPrefix(recentMemories: ContextMemory[]): string {
  if (recentMemories.length === 0) return "";

  const lines = [...recentMemories]
    .reverse() // chronological order — oldest first for narrative context
    .map((m) => `- ${m.content}`)
    .join("\n");

  return `[Context: What we already know about this user]\n${lines}\n\n[New information to process]:\n`;
}
