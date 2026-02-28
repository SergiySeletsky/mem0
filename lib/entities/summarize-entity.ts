/**
 * lib/entities/summarize-entity.ts — Entity profile summary generation (Graphiti-inspired)
 *
 * Goes beyond description consolidation: fetches ALL connected memories ([:MENTIONS])
 * and relationships ([:RELATED_TO]) for an entity, then generates a comprehensive
 * profile summary via LLM.
 *
 * Triggered from the worker pipeline when an entity accumulates enough context
 * (≥ SUMMARY_THRESHOLD connected memories). Fire-and-forget — failures are
 * logged but never block the write pipeline.
 */
import { runRead, runWrite } from "@/lib/db/memgraph";
import { getLLMClient } from "@/lib/ai/client";
import { ENTITY_SUMMARY_PROMPT } from "./prompts";

/** Minimum number of connected memories before generating a summary. */
export const SUMMARY_THRESHOLD = 3;

interface ConnectedMemory {
  content: string;
  createdAt: string;
}

interface ConnectedRelationship {
  targetName: string;
  relType: string;
  description: string;
}

/**
 * Check if an entity has enough connected context to warrant a summary.
 * Returns the count of connected memories.
 */
export async function getEntityMentionCount(entityId: string): Promise<number> {
  const rows = await runRead<{ cnt: number }>(
    `MATCH (e:Entity {id: $entityId})<-[:MENTIONS]-(m:Memory)
     WHERE m.invalidAt IS NULL
     RETURN count(m) AS cnt`,
    { entityId }
  );
  return typeof rows[0]?.cnt === "object"
    ? (rows[0].cnt as { low: number }).low
    : (rows[0]?.cnt ?? 0);
}

/**
 * Generate a comprehensive entity profile summary from all connected context.
 *
 * Gathers:
 *   - Entity name, type, current description
 *   - All live memories that mention this entity ([:MENTIONS])
 *   - All live outgoing/incoming relationships ([:RELATED_TO])
 *
 * Produces a 2-4 sentence summary stored as `e.summary` on the Entity node.
 * Also sets `e.summaryUpdatedAt` for cache invalidation.
 *
 * Skips if:
 *   - Entity not found
 *   - Fewer than SUMMARY_THRESHOLD connected memories
 */
export async function generateEntitySummary(
  entityId: string
): Promise<void> {
  // Fetch entity basic info
  const entityRows = await runRead<{
    name: string;
    type: string;
    description: string;
  }>(
    `MATCH (e:Entity {id: $entityId})
     RETURN e.name AS name, coalesce(e.type, 'OTHER') AS type, coalesce(e.description, '') AS description`,
    { entityId }
  );
  if (!entityRows.length) return;
  const { name, type, description } = entityRows[0];

  // Fetch connected memories (live only)
  const memoryRows = await runRead<ConnectedMemory>(
    `MATCH (e:Entity {id: $entityId})<-[:MENTIONS]-(m:Memory)
     WHERE m.invalidAt IS NULL
     RETURN m.content AS content, m.createdAt AS createdAt
     ORDER BY m.createdAt DESC
     LIMIT 10`,
    { entityId }
  );

  if (memoryRows.length < SUMMARY_THRESHOLD) return;

  // Fetch live outgoing relationships
  const relRows = await runRead<ConnectedRelationship>(
    `MATCH (e:Entity {id: $entityId})-[r:RELATED_TO]->(t:Entity)
     WHERE r.invalidAt IS NULL
     RETURN t.name AS targetName, r.type AS relType, coalesce(r.description, '') AS description
     LIMIT 15`,
    { entityId }
  );

  // Build context for LLM
  const memoriesText = memoryRows
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const relationshipsText = relRows.length > 0
    ? relRows.map((r) => `- ${name} --[${r.relType}]--> ${r.targetName}: ${r.description}`).join("\n")
    : "(none)";

  const prompt = ENTITY_SUMMARY_PROMPT
    .replace("{entityName}", name)
    .replace("{entityType}", type)
    .replace("{entityDescription}", description || "(none)")
    .replace("{memories}", memoriesText)
    .replace("{relationships}", relationshipsText);

  const model =
    process.env.LLM_AZURE_DEPLOYMENT ??
    process.env.MEMFORGE_CATEGORIZATION_MODEL ??
    "gpt-4o-mini";

  const client = getLLMClient();
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 300,
  });

  const summary = (response.choices[0]?.message?.content ?? "").trim();
  if (!summary) return;

  await runWrite(
    `MATCH (e:Entity {id: $entityId})
     SET e.summary = $summary, e.summaryUpdatedAt = $now`,
    { entityId, summary, now: new Date().toISOString() }
  );
}
