/**
 * lib/entities/resolve.ts — Entity resolution / find-or-create (Spec 04)
 *
 * Uses Cypher MERGE to atomically find or create an Entity node for the user.
 * If the entity already exists, updates description only when the new one is longer.
 */
import { runWrite } from "@/lib/db/memgraph";
import { v4 as uuidv4 } from "uuid";
import type { ExtractedEntity } from "./extract";

/**
 * Find or create an Entity node scoped to the given user.
 * Returns the entity's id (existing or newly created).
 */
export async function resolveEntity(
  extracted: ExtractedEntity,
  userId: string
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();

  // Memgraph cannot MERGE a path (u)-[r]->(e) when `u` already exists behind a
  // UNIQUE constraint — it tries to CREATE the whole pattern, violating the constraint.
  // Solution: three separate writes:
  //   1. Ensure User exists (MERGE with LIMIT 1 guard)
  //   2. MERGE Entity scoped by userId+name+type
  //   3. MERGE the HAS_ENTITY relationship

  // Step 1: ensure User node exists
  await runWrite(
    `MERGE (u:User {userId: $userId})
     ON CREATE SET u.createdAt = $now`,
    { userId, now }
  );

  // Step 2: MERGE Entity by (userId, name, type)
  const records = await runWrite(
    `MATCH (u:User {userId: $userId}) WITH u LIMIT 1
     MERGE (e:Entity {userId: $userId, name: $name, type: $type})
     ON CREATE SET
       e.id = $id,
       e.description = $description,
       e.createdAt = $now,
       e.updatedAt = $now
     ON MATCH SET
       e.description = CASE
         WHEN size($description) > size(coalesce(e.description, ''))
         THEN $description
         ELSE e.description
       END,
       e.updatedAt = $now
     RETURN e.id AS id`,
    {
      userId,
      name: extracted.name,
      type: extracted.type,
      description: extracted.description ?? "",
      id,
      now,
    }
  );

  const entityId = records[0].id as string;

  // Step 3: MERGE the HAS_ENTITY relationship
  await runWrite(
    `MATCH (u:User {userId: $userId}) WITH u LIMIT 1
     MATCH (e:Entity {id: $entityId})
     MERGE (u)-[:HAS_ENTITY]->(e)`,
    { userId, entityId }
  );

  return entityId;
}
