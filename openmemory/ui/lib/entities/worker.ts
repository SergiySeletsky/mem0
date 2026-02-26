/**
 * lib/entities/worker.ts — Async entity extraction orchestrator (Spec 04)
 *
 * Fire-and-forget worker. Do NOT await this from hot-path code.
 *
 * Pipeline:
 *   1. Read memory content + check extractionStatus (skip if 'done')
 *   2. Resolve userId via graph traversal
 *   3. Set extractionStatus = 'pending'
 *   4. extractEntitiesFromMemory() → list of { name, type, description }
 *   5. resolveEntity() for each → entity id (MERGE find-or-create)
 *   6. linkMemoryToEntity() for each → [:MENTIONS] edge
 *   7. Set extractionStatus = 'done'
 *   On error: set extractionStatus = 'failed', store error message
 */
import { runRead, runWrite } from "@/lib/db/memgraph";
import { extractEntitiesFromMemory } from "./extract";
import { resolveEntity } from "./resolve";
import { linkMemoryToEntity } from "./link";

export async function processEntityExtraction(memoryId: string): Promise<void> {
  // Step 1: fetch memory content and current extraction status
  const check = await runRead<{ status: string | null; content: string }>(
    `MATCH (m:Memory {id: $memoryId}) RETURN m.extractionStatus AS status, m.content AS content`,
    { memoryId }
  );
  if (!check.length) return; // memory not found — silently skip

  const { status, content } = check[0];
  if (status === "done") return; // idempotent — already processed

  // Step 2: resolve the owner userId via the graph
  const ctx = await runRead<{ userId: string }>(
    `MATCH (u:User)-[:HAS_MEMORY]->(m:Memory {id: $memoryId}) RETURN u.userId AS userId`,
    { memoryId }
  );
  if (!ctx.length) return;
  const userId = ctx[0].userId;

  // Step 3: mark as pending / increment attempt counter
  await runWrite(
    `MATCH (m:Memory {id: $memoryId})
     SET m.extractionStatus = 'pending',
         m.extractionAttempts = coalesce(m.extractionAttempts, 0) + 1`,
    { memoryId }
  );

  try {
    // Step 4: LLM extraction
    const extracted = await extractEntitiesFromMemory(content as string);

    // Steps 5 & 6: resolve + link each entity
    for (const entity of extracted) {
      if (!entity.name?.trim()) continue;
      const entityId = await resolveEntity(entity, userId);
      await linkMemoryToEntity(memoryId, entityId);
    }

    // Step 7: mark done
    await runWrite(
      `MATCH (m:Memory {id: $memoryId}) SET m.extractionStatus = 'done'`,
      { memoryId }
    );
  } catch (e: unknown) {
    await runWrite(
      `MATCH (m:Memory {id: $memoryId})
       SET m.extractionStatus = 'failed', m.extractionError = $error`,
      { memoryId, error: e instanceof Error ? e.message : String(e) }
    );
  }
}
