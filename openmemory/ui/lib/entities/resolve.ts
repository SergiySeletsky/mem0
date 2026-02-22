/**
 * lib/entities/resolve.ts — Entity resolution / find-or-create (Spec 04)
 *
 * Uses Cypher to atomically find or create an Entity node for the user.
 * Entities are matched by lowercased name only (ignoring type) to prevent
 * fragmentation when the LLM assigns different types to the same entity
 * in different memory contexts (e.g. "ADR-001" as CONCEPT vs OTHER).
 *
 * When merging, the most specific (non-OTHER) type wins.
 * Description is updated only when the new one is longer.
 */
import { runRead, runWrite } from "@/lib/db/memgraph";
import { embed } from "@/lib/embeddings/openai";
import { v4 as uuidv4 } from "uuid";
import type { ExtractedEntity } from "./extract";

/** Type specificity ranking — lower index = more specific. OTHER is least specific. */
const TYPE_PRIORITY: Record<string, number> = {
  PERSON: 1,
  ORGANIZATION: 2,
  LOCATION: 3,
  PRODUCT: 4,
  CONCEPT: 5,
  OTHER: 6,
};

function isMoreSpecific(newType: string, existingType: string): boolean {
  const newRank = TYPE_PRIORITY[newType] ?? 5;
  const existingRank = TYPE_PRIORITY[existingType] ?? 5;
  return newRank < existingRank;
}

/**
 * Find or create an Entity node scoped to the given user.
 * Returns the entity's id (existing or newly created).
 *
 * Match key: toLower(name) + userId (type is NOT part of the match key).
 * On match: upgrades type if new type is more specific, updates description
 * if longer.
 */
export async function resolveEntity(
  extracted: ExtractedEntity,
  userId: string
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const normalizedType = (extracted.type ?? "CONCEPT").toUpperCase();

  // Step 1: ensure User node exists
  await runWrite(
    `MERGE (u:User {userId: $userId})
     ON CREATE SET u.createdAt = $now`,
    { userId, now }
  );

  // Step 2: Find existing entity by case-insensitive name match (ignoring type)
  let existing = await runWrite<{
    id: string;
    name: string;
    type: string;
    description: string;
  }>(
    `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
     WHERE toLower(e.name) = toLower($name)
     RETURN e.id AS id, e.name AS name, e.type AS type,
            coalesce(e.description, '') AS description
     LIMIT 1`,
    { userId, name: extracted.name }
  );

  // Step 2b: Name-alias resolution for PERSON entities (Eval v4 Finding 2)
  // If no exact match was found and the entity is a PERSON, check for partial
  // name matches: "Alice" ↔ "Alice Chen" (prefix match on word boundary).
  if (existing.length === 0 && normalizedType === "PERSON") {
    existing = await runRead<{
      id: string;
      name: string;
      type: string;
      description: string;
    }>(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
       WHERE e.type = 'PERSON'
         AND (
           toLower(e.name) STARTS WITH toLower($name) + ' '
           OR toLower($name) STARTS WITH toLower(e.name) + ' '
         )
       RETURN e.id AS id, e.name AS name, e.type AS type,
              coalesce(e.description, '') AS description
       ORDER BY size(e.name) DESC
       LIMIT 1`,
      { userId, name: extracted.name }
    );

    // If we found a partial match, upgrade the stored name to the longer form
    if (existing.length > 0 && extracted.name.length > existing[0].name.length) {
      await runWrite(
        `MATCH (e:Entity {id: $entityId})
         SET e.name = $longerName, e.updatedAt = $now`,
        { entityId: existing[0].id, longerName: extracted.name, now }
      );
      existing[0].name = extracted.name;
    }
  }

  let entityId: string;

  if (existing.length > 0) {
    // Entity exists — update type if more specific, description if longer
    entityId = existing[0].id;
    const shouldUpgradeType = isMoreSpecific(normalizedType, existing[0].type);
    const shouldUpgradeDesc =
      (extracted.description ?? "").length > existing[0].description.length;

    if (shouldUpgradeType || shouldUpgradeDesc) {
      await runWrite(
        `MATCH (e:Entity {id: $entityId})
         SET e.type = CASE WHEN $shouldUpgradeType THEN $newType ELSE e.type END,
             e.description = CASE WHEN $shouldUpgradeDesc THEN $newDesc ELSE e.description END,
             e.updatedAt = $now`,
        {
          entityId,
          shouldUpgradeType,
          shouldUpgradeDesc,
          newType: normalizedType,
          newDesc: extracted.description ?? "",
          now,
        }
      );
    }
  } else {
    // Create new entity
    await runWrite(
      `CREATE (e:Entity {
         id: $id, userId: $userId, name: $name, type: $type,
         description: $description, createdAt: $now, updatedAt: $now
       })`,
      {
        id,
        userId,
        name: extracted.name,
        type: normalizedType,
        description: extracted.description ?? "",
        now,
      }
    );
    entityId = id;

    // Create HAS_ENTITY relationship
    await runWrite(
      `MATCH (u:User {userId: $userId}) WITH u LIMIT 1
       MATCH (e:Entity {id: $entityId})
       MERGE (u)-[:HAS_ENTITY]->(e)`,
      { userId, entityId }
    );
  }

  // Fire-and-forget: compute description embedding for semantic entity search
  const descText = extracted.description ?? extracted.name;
  if (descText) {
    embedDescriptionAsync(entityId, descText).catch((err) =>
      console.warn("[resolveEntity] descriptionEmbedding failed:", err)
    );
  }

  return entityId;
}

/**
 * Embed the entity description and store the vector on the Entity node.
 * Called fire-and-forget — failures are logged but do not block the pipeline.
 */
async function embedDescriptionAsync(
  entityId: string,
  text: string,
): Promise<void> {
  const vector = await embed(text);
  await runWrite(
    `MATCH (e:Entity {id: $entityId})
     SET e.descriptionEmbedding = $vector`,
    { entityId, vector },
  );
}
