/**
 * Graph traversal search — find memories through entity and relationship metadata.
 *
 * Given a natural-language query, finds entities matching by name, description,
 * or open-ontology metadata, traverses their RELATED_TO edges (configurable
 * depth, default 2 hops), and returns connected Memory IDs with hop distance.
 *
 * This complements hybrid search (BM25 + vector on Memory.content) by
 * discovering memories through the entity graph — useful when the query
 * references entity attributes or relationship metadata that wouldn't
 * appear in the memory text alone.
 *
 * No hardcoded entity types, property names, or relationship types — works
 * with whatever open-ontology data the extraction pipeline has stored.
 */

import { runRead } from "@/lib/db/memgraph";
import { getLLMClient } from "@/lib/ai/client";
// Used for vector-seeding path (avoids LLM term extraction)
const VECTOR_SEED_LIMIT = 8; // top-N memories to use for entity seeding

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphTraversalResult {
  memoryId: string;
  /** Minimum number of hops from a seed entity to this memory's entity (0 = seed itself). */
  hopDistance: number;
  /** Average edge weight along the path (0.0–1.0). Seeds (hop 0) get weight 1.0. */
  avgWeight: number;
}

// ---------------------------------------------------------------------------
// Term extraction — LLM-based with regex fallback
// ---------------------------------------------------------------------------

const EXTRACT_TERMS_PROMPT = `Extract the key search terms from this query for searching a knowledge graph.
Return entity names, attribute values, measurements, and relationship types that would help find relevant nodes and edges.
Keep multi-word names together (e.g. "Dr. John" not "Dr" and "John").
Return ONLY a JSON array of lowercase strings. No explanation.

Examples:
Query: "to whom dr. john gave 5mg ozempic 3 weeks ago?"
Answer: ["dr. john", "5mg", "ozempic"]

Query: "how many positions were opened by intellias this month?"
Answer: ["positions", "opened", "intellias"]

Query: "what allergies does sarah have?"
Answer: ["allergies", "sarah"]`;

/**
 * Use LLM to extract semantically meaningful search terms from a query.
 * Falls back to regex-based extraction on any failure.
 */
export async function extractSearchTerms(query: string): Promise<string[]> {
  try {
    const terms = await extractSearchTermsLLM(query);
    if (terms.length > 0) return terms;
  } catch {
    // LLM unavailable or failed — fall through to regex
  }
  return extractSearchTermsRegex(query);
}

/**
 * LLM-based term extraction — understands context, multi-word names,
 * and domain-agnostic attribute values.
 */
async function extractSearchTermsLLM(query: string): Promise<string[]> {
  const client = getLLMClient();
  const model = process.env.LLM_AZURE_DEPLOYMENT ?? process.env.MEMFORGE_CATEGORIZATION_MODEL ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 200,
    messages: [
      { role: "system", content: EXTRACT_TERMS_PROMPT },
      { role: "user", content: query },
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim() ?? "";
  // Strip markdown code fences if present
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
    .map((t: string) => t.toLowerCase());
}

/**
 * Minimal regex fallback — strips punctuation, keeps tokens >= 3 chars.
 * Only used when LLM is unavailable. No stop-word list — the LLM path
 * handles intelligent term selection; this is a best-effort safety net.
 * Exported for testing.
 */
export function extractSearchTermsRegex(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[?!.,;:'"()\[\]{}]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

/**
 * Find memories through entity graph traversal.
 *
 * Strategy:
 * 1. Find seed entities whose name, description, or metadata matches query terms
 * 2. Find entities connected via relationships whose type, description, or
 *    metadata matches query terms
 * 3. Expand seed entities up to `maxDepth` hops via live RELATED_TO edges
 * 4. Collect Memory nodes connected to any traversed entity via [:MENTIONS]
 *    with minimum hop distance from the nearest seed entity
 *
 * All queries are anchored through User for namespace isolation (Spec 09).
 * Only live memories (invalidAt IS NULL) and live edges are returned.
 */
export async function traverseEntityGraph(
  query: string,
  userId: string,
  options?: { limit?: number; maxDepth?: number; queryVector?: number[] },
): Promise<GraphTraversalResult[]> {
  const limit = options?.limit ?? 20;
  const maxDepth = Math.max(1, Math.min(options?.maxDepth ?? 2, 5));

  let allSeedIds: string[];
  let communitySeedIds: string[];

  if (options?.queryVector) {
    // ----------------------------------------------------------------
    // VECTOR SEEDING PATH — no LLM call
    // Use the pre-computed query embedding to find seed entities directly
    // by finding the top-N most relevant Memory nodes and extracting
    // their entity mentions as seeds. This replaces both term-based seeding
    // arms (entity name/description/metadata containment + relationship
    // metadata containment) with a single vector round-trip.
    // ----------------------------------------------------------------
    const queryVec = options.queryVector;

    // Step 1 (vector): Find seed entities via relevant memories
    let vectorSeedIds: string[] = [];
    try {
      const seedRows = await runRead<{ entityId: string }>(
        `CALL vector_search.search("memory_vectors", toInteger($topK), $queryVec)
         YIELD node, similarity
         MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(node)
         WHERE node.invalidAt IS NULL AND node.state <> 'deleted'
         MATCH (node)-[:MENTIONS]->(e:Entity)<-[:HAS_ENTITY]-(u)
         RETURN DISTINCT e.id AS entityId
         LIMIT 10`,
        { userId, topK: VECTOR_SEED_LIMIT * 2, queryVec },
      );
      vectorSeedIds = seedRows.map((r) => r.entityId);
    } catch {
      // Vector seeding failed — return empty (no fallback to LLM in this path)
    }
    allSeedIds = vectorSeedIds;

    // P4 — DRIFT-style community priming via vector (no LLM)
    // Find communities of the top vector-matched memories, inject their
    // member entities as additional seeds for global→local bridging.
    communitySeedIds = [];
    try {
      const communityRows = await runRead<{ entityId: string }>(
        `CALL vector_search.search("memory_vectors", toInteger($topK), $queryVec)
         YIELD node, similarity
         MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(node)
         WHERE node.invalidAt IS NULL AND node.state <> 'deleted'
         WITH node LIMIT 3
         MATCH (node)-[:IN_COMMUNITY]->(c:Community)
         MATCH (m2:Memory)-[:IN_COMMUNITY]->(c)
         WHERE m2.invalidAt IS NULL
         MATCH (m2)-[:MENTIONS]->(e:Entity)<-[:HAS_ENTITY]-(u)
         WHERE NOT e.id IN $directSeedIds
         RETURN DISTINCT e.id AS entityId
         LIMIT 20`,
        { userId, topK: VECTOR_SEED_LIMIT, queryVec, directSeedIds: allSeedIds },
      );
      communitySeedIds = communityRows.map((r) => r.entityId);
    } catch {
      // Community priming is best-effort
    }
  } else {
    // ----------------------------------------------------------------
    // TERM SEEDING PATH — LLM-based with regex fallback
    // ----------------------------------------------------------------
    const terms = await extractSearchTerms(query);
    if (terms.length === 0) return [];

    // Step 1: Find seed entities matching query terms in name, description, or metadata
    const seedRows = await runRead<{ entityId: string }>(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
       WHERE ANY(term IN $terms WHERE
         toLower(e.name) CONTAINS term
         OR (e.description IS NOT NULL AND toLower(e.description) CONTAINS term)
         OR (e.metadata IS NOT NULL AND toLower(e.metadata) CONTAINS term)
       )
       RETURN e.id AS entityId
       LIMIT 10`,
      { userId, terms },
    );

    // Step 1b: Find entities connected via relationships matching query terms
    let relSeedIds: string[] = [];
    try {
      const relRows = await runRead<{ entityId: string }>(
        `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)-[r:RELATED_TO]-(neighbor:Entity)
         WHERE r.invalidAt IS NULL
           AND ANY(term IN $terms WHERE
             toLower(coalesce(r.type, '')) CONTAINS term
             OR toLower(coalesce(r.description, '')) CONTAINS term
             OR toLower(coalesce(r.metadata, '')) CONTAINS term
           )
         WITH collect(DISTINCT e.id) + collect(DISTINCT neighbor.id) AS ids
         UNWIND ids AS entityId
         RETURN DISTINCT entityId
         LIMIT 10`,
        { userId, terms },
      );
      relSeedIds = relRows.map((r) => r.entityId);
    } catch {
      // Relationship metadata search is best-effort
    }

    allSeedIds = [...new Set([...seedRows.map((r) => r.entityId), ...relSeedIds])];

    // P4 — DRIFT-style community priming (term-based)
    communitySeedIds = [];
    try {
      const communityRows = await runRead<{ entityId: string }>(
        `MATCH (u:User {userId: $userId})-[:HAS_COMMUNITY]->(c:Community)
         WHERE ANY(term IN $terms WHERE
           toLower(c.name) CONTAINS term
           OR toLower(c.summary) CONTAINS term
         )
         WITH c LIMIT 3
         MATCH (m:Memory)-[:IN_COMMUNITY]->(c)
         WHERE m.invalidAt IS NULL
         MATCH (m)-[:MENTIONS]->(e:Entity)<-[:HAS_ENTITY]-(u)
         RETURN DISTINCT e.id AS entityId
         LIMIT 20`,
        { userId, terms },
      );
      communitySeedIds = communityRows
        .map((r) => r.entityId)
        .filter((id) => !allSeedIds.includes(id));
    } catch {
      // Community priming is best-effort
    }
  }

  // Merge all seeds: direct entity matches + community-primed entities
  const directAndCommSeeds = [...new Set([...allSeedIds, ...communitySeedIds])];
  if (directAndCommSeeds.length === 0) return [];

  // Step 2: Expand seeds up to maxDepth hops via RELATED_TO, tracking hop distance.
  // Uses variable-length path to discover entities within the configured radius.
  // Each entity gets the minimum hop distance from any seed.
  // Neighbor fan-out is ordered by entity rank (degree centrality) so the most
  // connected/important entities are traversed first (GraphRAG-inspired).
  // Also computes average edge weight along the path for weight-aware scoring.
  const expandRows = await runRead<{ entityId: string; hops: number; avgWeight: number }>(
    `UNWIND $seedIds AS sid
     MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(seed:Entity {id: sid})
     // Seed itself at distance 0, weight 1.0
     WITH seed, u, 0 AS hops, 1.0 AS avgWeight
     RETURN seed.id AS entityId, hops, avgWeight
     UNION
     UNWIND $seedIds AS sid
     MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(seed:Entity {id: sid})
     MATCH path = (seed)-[:RELATED_TO*1..${maxDepth}]-(neighbor:Entity)<-[:HAS_ENTITY]-(u)
     WHERE ALL(rel IN relationships(path) WHERE rel.invalidAt IS NULL)
     WITH neighbor,
          min(size(relationships(path))) AS hops,
          avg(reduce(w = 0.0, rel IN relationships(path) | w + coalesce(rel.weight, 0.5)) / size(relationships(path))) AS avgWeight
     RETURN neighbor.id AS entityId, hops, avgWeight
     ORDER BY neighbor.rank DESC`,
    { userId, seedIds: directAndCommSeeds },
  );

  // Build entity→{minHops, avgWeight} map (keep shortest hop; for ties, prefer higher weight)
  const entityHopMap = new Map<string, number>();
  const entityWeightMap = new Map<string, number>();
  for (const row of expandRows) {
    const eid = row.entityId as string;
    const h = typeof row.hops === "number" ? row.hops : Number(row.hops);
    const w = typeof row.avgWeight === "number" ? row.avgWeight : Number(row.avgWeight || 0.5);
    const prev = entityHopMap.get(eid);
    if (prev === undefined || h < prev) {
      entityHopMap.set(eid, h);
      entityWeightMap.set(eid, w);
    } else if (h === prev && w > (entityWeightMap.get(eid) ?? 0)) {
      entityWeightMap.set(eid, w);
    }
  }
  if (entityHopMap.size === 0) return [];

  // Step 3: Find memories connected to any traversed entity via [:MENTIONS]
  // Each memory inherits the minimum hop distance among its connected entities.
  const memoryRows = await runRead<{ memoryId: string; entityId: string }>(
    `UNWIND $entityIds AS eid
     MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)-[:MENTIONS]->(e:Entity {id: eid})
     WHERE m.invalidAt IS NULL
     WITH m, e.id AS entityId
     RETURN DISTINCT m.id AS memoryId, entityId
     LIMIT $limit`,
    { userId, entityIds: [...entityHopMap.keys()], limit },
  );

  // Build memory→{minHopDistance, avgWeight} map
  const memHopMap = new Map<string, number>();
  const memWeightMap = new Map<string, number>();
  for (const row of memoryRows) {
    const mid = row.memoryId as string;
    const eid = row.entityId as string;
    const entityHop = entityHopMap.get(eid) ?? 0;
    const entityWeight = entityWeightMap.get(eid) ?? 0.5;
    const prev = memHopMap.get(mid);
    if (prev === undefined || entityHop < prev) {
      memHopMap.set(mid, entityHop);
      memWeightMap.set(mid, entityWeight);
    } else if (entityHop === prev && entityWeight > (memWeightMap.get(mid) ?? 0)) {
      memWeightMap.set(mid, entityWeight);
    }
  }

  return [...memHopMap.entries()].map(([memoryId, hopDistance]) => ({
    memoryId,
    hopDistance,
    avgWeight: memWeightMap.get(memoryId) ?? 0.5,
  }));
}
