/**
 * lib/clusters/build.ts — Community Detection — Spec 07
 *
 * Builds community (cluster) nodes for a user's memory graph using
 * Memgraph MAGE's Louvain community detection algorithm.
 *
 * Pipeline:
 *   1. Count active memories (skip if < 5 — not enough to cluster meaningfully)
 *   2. Run CALL community_detection.get() filtered to user's memories
 *   3. If empty, return early (no stale-community deletion needed)
 *   4. Group results by community_id
 *   5. Delete existing Community nodes for this user (replace, not accumulate)
 *   6. For each group with ≥ 2 members: LLM summarize → MERGE Community node + edges
 */

import { runRead, runWrite } from "@/lib/db/memgraph";
import { summarizeCluster } from "./summarize";
import { v4 as uuidv4 } from "uuid";

interface CommunityMember {
  id: string;
  content: string;
  communityId: number;
}

export async function rebuildClusters(userId: string): Promise<void> {
  // Step 1: Minimum threshold check
  const countResult = await runRead(
    `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
     WHERE m.invalidAt IS NULL AND m.state = 'active'
     RETURN count(m) AS total`,
    { userId }
  );
  const total = ((countResult[0] as { total: number })?.total as number) ?? 0;
  if (total < 5) return;

  // Step 2: Louvain community detection on user's Memory subgraph
  const communityResults = (await runRead(
    `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
     WHERE m.invalidAt IS NULL AND m.state = 'active'
     CALL community_detection.get() YIELD node, community_id
     WHERE node = m
     RETURN node.id AS id, node.content AS content, community_id AS communityId
     ORDER BY community_id`,
    { userId }
  )) as CommunityMember[];

  // Step 3: Nothing to work with
  if (communityResults.length === 0) return;

  // Step 4: Group by community_id
  const groups = new Map<number, CommunityMember[]>();
  for (const row of communityResults) {
    const key = row.communityId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Step 5: Delete old Community nodes for this user (idempotent rebuild)
  await runWrite(
    `MATCH (u:User {userId: $userId})-[:HAS_COMMUNITY]->(c:Community)
     DETACH DELETE c`,
    { userId }
  );

  const now = new Date().toISOString();

  // Step 6: Summarize each group and create Community nodes
  await Promise.all(
    Array.from(groups.entries()).map(async ([, members]) => {
      if (members.length < 2) return; // Skip singleton communities

      const { name, summary } = await summarizeCluster(
        members.map((m) => m.content)
      );
      const cId = uuidv4();
      const memIds = members.map((m) => m.id);

      await runWrite(
        `MATCH (u:User {userId: $userId})
         CREATE (c:Community {
           id:          $cId,
           name:        $name,
           summary:     $summary,
           memberCount: $count,
           createdAt:   $now,
           updatedAt:   $now
         })
         CREATE (u)-[:HAS_COMMUNITY]->(c)
         WITH c
         UNWIND $memIds AS memId
         MATCH (m:Memory {id: memId})
         CREATE (m)-[:IN_COMMUNITY]->(c)`,
        { userId, cId, name, summary, count: members.length, now, memIds }
      );
    })
  );
}
