/**
 * lib/entities/link.ts — Create [:MENTIONS] edge from Memory to Entity (Spec 04)
 *
 * Idempotent via MERGE — re-running for the same (memoryId, entityId) pair is safe.
 */
import { runWrite } from "@/lib/db/memgraph";

/**
 * Create or update a [:MENTIONS] relationship between a Memory and an Entity node.
 */
export async function linkMemoryToEntity(
  memoryId: string,
  entityId: string,
  role: string = "mention",
  confidence: number = 1.0
): Promise<void> {
  await runWrite(
    `MATCH (m:Memory {id: $memoryId})
     MATCH (e:Entity {id: $entityId})
     MERGE (m)-[r:MENTIONS]->(e)
     ON CREATE SET r.role = $role, r.confidence = $confidence, r.createdAt = $now
     RETURN r`,
    { memoryId, entityId, role, confidence, now: new Date().toISOString() }
  );
}
