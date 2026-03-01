/**
 * lib/entities/rank.ts — Entity rank (degree centrality)
 *
 * Computes and stores a `rank` integer on each Entity node, representing
 * degree centrality: the count of live [:MENTIONS] edges (from active memories)
 * plus live [:RELATED_TO] edges (where invalidAt IS NULL).
 *
 * Higher rank = more connected/important entity. Used for:
 * - Ordering neighbor fan-out in graph traversal (prioritize high-rank entities)
 * - Entity enrichment sorting (most connected entities first)
 * - Future: community-level entity ranking
 *
 * Inspired by GraphRAG's `rank` attribute on Entity nodes (computed from
 * degree centrality of the entity within the global graph).
 */
import { runWrite } from "@/lib/db/memgraph";

/**
 * Compute and store degree centrality (mentions + relationships) for an entity.
 * Fire-and-forget — designed to be called from worker.ts after entity linking.
 */
export async function updateEntityRank(entityId: string): Promise<void> {
  await runWrite(
    `MATCH (e:Entity {id: $entityId})
     OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(e)
     WHERE m.invalidAt IS NULL
     WITH e, count(DISTINCT m) AS mentions
     OPTIONAL MATCH (e)-[r:RELATED_TO]-()
     WHERE r.invalidAt IS NULL
     WITH e, mentions, count(DISTINCT r) AS rels
     SET e.rank = mentions + rels`,
    { entityId },
  );
}
