/**
 * MCP Server for OpenMemory — Spec 00 Memgraph port
 *
 * 9 MCP tools for agentic long-term memory, organized in two groups:
 *
 *   Core Memory:      add_memories, search_memory, update_memory
 *   Entity Knowledge:  search_memory_entities, get_memory_entity,
 *                      get_memory_map, create_memory_relation,
 *                      delete_memory_relation, delete_memory_entity
 *
 * add_memories accepts a single string or an array of strings so agents can
 * flush an entire batch of facts in one round-trip.
 *
 * search_memory is dual-mode:
 *   - query provided  → hybrid BM25 + vector search, ranked by relevance
 *   - query omitted   → browse mode: chronological listing with offset/limit
 *                       pagination and total count (replaces list_memories)
 *
 * Uses @modelcontextprotocol/sdk with SSE transport.
 * Context (user_id, client_name) is passed per-connection via the SSE URL path.
 *
 * Storage: Memgraph via lib/memory/write.ts + lib/memory/search.ts
 * Search: hybrid BM25 + vector + Reciprocal Rank Fusion (lib/search/hybrid.ts)
 * Knowledge: entity extraction + relationship graph (lib/entities/)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addMemory, supersedeMemory } from "@/lib/memory/write";
import { hybridSearch } from "@/lib/search/hybrid";
import { runRead, runWrite } from "@/lib/db/memgraph";
import { checkDeduplication } from "@/lib/dedup";
import { processEntityExtraction } from "@/lib/entities/worker";
import { resolveEntity } from "@/lib/entities/resolve";
import { embed } from "@/lib/embeddings/openai";
import { randomUUID } from "crypto";

/**
 * Create a new McpServer instance with all 10 memory tools registered.
 * Each request carries userId & clientName via closure.
 */
// Pre-define tool input schemas to avoid TS2589 deep type instantiation
// search_memory is dual-mode — query is optional:
//   present  → hybrid BM25 + vector search
//   absent   → browse mode (chronological, paginated)
const searchMemorySchema = {
  query: z.string().optional().describe(
    "Natural language search query. " +
    "When provided: hybrid relevance search (BM25 + vector). " +
    "When omitted: returns all memories in reverse-chronological order with pagination."
  ),
  limit: z.number().optional().describe("Maximum results to return (default: 10 for search, 50 for browse; max: 200)"),
  offset: z.number().optional().describe("Number of memories to skip — used for paginating browse results (no query). Default: 0"),
  category: z.string().optional().describe("Filter to memories in this category only"),
  created_after: z.string().optional().describe("ISO date — only return memories created after this date (e.g. '2026-02-01')"),
};
const addMemoriesSchema = {
  content: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "One or more facts, preferences, goals, decisions, or information to remember. " +
      "Pass a single string for one memory or an array of strings to write multiple " +
      "memories in a single call — avoids N round-trips when ingesting a document or " +
      "a batch of architectural decisions at once."
    ),
};
const updateMemorySchema = {
  memory_id: z.string().optional().describe(
    "ID of the existing memory — returned by add_memories or search_memory. "
    + "Provide either memory_id or memory_content."
  ),
  memory_content: z.string().optional().describe(
    "A fragment of the existing memory's text (e.g. 'Alice prefers TypeScript'). "
    + "The system finds the closest matching live memory and supersedes it. "
    + "Provide either memory_id or memory_content."
  ),
  text: z.string().describe("The updated content that replaces the old memory"),
};

// Entity & Knowledge tool schemas
const searchMemoryEntitiesSchema = {
  query: z.string().describe("Name, keyword, or description fragment to search for across remembered entities. Use specific name fragments (e.g. 'Alice', 'Memgraph') for best results; general concepts also work via description matching."),
  entity_type: z.string().optional().describe("Filter by entity type: PERSON, ORGANIZATION, LOCATION, CONCEPT, PRODUCT, or OTHER"),
  limit: z.number().optional().describe("Maximum number of entities to return (default: 10)"),
};

const getMemoryEntitySchema = {
  entity_id: z.string().optional().describe(
    "Exact entity ID — returned by search_memory_entities. Preferred when known."
  ),
  entity_name: z.string().optional().describe(
    "Name of the entity (e.g. 'Alice', 'PaymentService'). "
    + "The system resolves it internally. Provide either entity_id or entity_name."
  ),
};

const getRelatedMemoriesSchema = {
  entity_name: z.string().optional().describe(
    "The name of the entity to search for (e.g. 'PaymentService'). " +
    "Provide either entity_name or entity_id — at least one is required."
  ),
  entity_id: z.string().optional().describe(
    "The unique ID of the entity (from search_memory_entities or get_memory_entity). " +
    "Preferred over entity_name when the ID is known."
  ),
};

const getMemoryMapSchema = {
  entity_id: z.string().describe("The entity ID to build the knowledge map around"),
  depth: z.number().optional().describe("How many hops from center to include (default: 1, max: 3)"),
  limit: z.number().optional().describe("Maximum number of entities in the map (default: 50)"),
  max_edges: z.number().optional().describe("Maximum number of edges to return (default: 100). Prevents large responses."),
};
const createMemoryRelationSchema = {
  source_entity: z.string().describe("Name of the source entity (e.g. 'Alice')"),
  relationship_type: z.string().describe("Type of relationship in UPPER_SNAKE_CASE (e.g. WORKS_AT, KNOWS, USES, LIVES_IN)"),
  target_entity: z.string().describe("Name of the target entity (e.g. 'Acme Corp')"),
  description: z.string().optional().describe("Optional context or details about this relationship"),
};
const deleteMemoryRelationSchema = {
  relationship_id: z.string().optional().describe(
    "ID of the relationship to remove — returned by create_memory_relation. " +
    "When provided, source_entity / relationship_type / target_entity are not required."
  ),
  source_entity: z.string().optional().describe("Name of the source entity"),
  relationship_type: z.string().optional().describe("The relationship type to remove (e.g. WORKS_AT)"),
  target_entity: z.string().optional().describe("Name of the target entity"),
};
const deleteMemoryEntitySchema = {
  entity_id: z.string().optional().describe(
    "Exact entity ID — returned by search_memory_entities. Preferred when known."
  ),
  entity_name: z.string().optional().describe(
    "Name of the entity to delete (e.g. 'Alice'). "
    + "The system resolves it internally. Provide either entity_id or entity_name."
  ),
};

export function createMcpServer(userId: string, clientName: string): McpServer {
  const server = new McpServer({ name: "mem0-mcp-server", version: "1.0.0" });

  // -------- add_memories --------
  server.registerTool(
    "add_memories",
    {
      description:
        "Save one or more facts to long-term memory in a single call. " +
        "Pass a single string or an array of strings — use the array form to flush " +
        "an entire batch of architectural decisions, incident breadcrumbs, or document " +
        "facts without paying N round-trip latencies. " +
        "Supports automatic deduplication — existing memories are updated rather than duplicated.",
      inputSchema: addMemoriesSchema,
    },
    async ({ content }) => {
      if (!userId) return { content: [{ type: "text", text: "Error: user_id not provided" }] };
      if (!clientName) return { content: [{ type: "text", text: "Error: client_name not provided" }] };

      // Normalise to array — accepts a single string for backward compatibility
      const items: string[] = Array.isArray(content) ? content : [content];
      if (items.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ results: [] }) }] };
      }

      const t0 = Date.now();
      console.log(`[MCP] add_memories start userId=${userId} batch=${items.length}`);

      try {
        /**
         * Process items SEQUENTIALLY to avoid concurrent write-transaction conflicts
         * on both Memgraph and KuzuDB. Parallel sessions from Promise.all can deadlock
         * when they attempt to MERGE the same User/App nodes simultaneously.
         * Sequential processing also ensures dedup TOCTOU safety: each item's
         * near-duplicate check completes before the next item's write begins.
         *
         * Tantivy write-conflict prevention: entity extraction from the PREVIOUS item
         * is awaited (up to EXTRACTION_DRAIN_TIMEOUT_MS) before the next write starts.
         * This prevents two concurrent write sessions from hitting Memgraph's text-index
         * writer simultaneously, which causes "Tantivy error: index writer was killed".
         * runWrite() also retries on transient Tantivy errors as a defense-in-depth.
         */
        const EXTRACTION_DRAIN_TIMEOUT_MS = 3_000;

        type MemoryResult =
          | { id: string;   memory: string; event: "ADD" | "SUPERSEDE" | "SKIP_DUPLICATE" }
          | { id: null;     memory: string; event: "ERROR"; error: string };
        const results: MemoryResult[] = [];

        let prevExtractionPromise: Promise<void> | null = null;

        for (const text of items) {
          // Drain previous item's entity extraction before starting the next write,
          // capped at EXTRACTION_DRAIN_TIMEOUT_MS to avoid blocking the batch indefinitely.
          if (prevExtractionPromise) {
            await Promise.race([
              prevExtractionPromise,
              new Promise<void>((r) => setTimeout(r, EXTRACTION_DRAIN_TIMEOUT_MS)),
            ]);
            prevExtractionPromise = null;
          }

          try {
            // Spec 03: Deduplication pre-write hook
            const dedup = await checkDeduplication(text, userId);

            if (dedup.action === "skip") {
              console.log(`[MCP] add_memories dedup skip — duplicate of ${dedup.existingId}`);
              results.push({ id: dedup.existingId, memory: text, event: "SKIP_DUPLICATE" });
              continue;
            }

            let id: string;
            if (dedup.action === "supersede") {
              console.log(`[MCP] add_memories dedup supersede — superseding ${dedup.existingId}`);
              id = await supersedeMemory(dedup.existingId, text, userId, clientName);
            } else {
              id = await addMemory(text, {
                userId,
                appName: clientName,
                metadata: { source_app: "openmemory", mcp_client: clientName },
              });
            }

            const event = dedup.action === "supersede" ? "SUPERSEDE" : "ADD";

            // Spec 04: Async entity extraction — tracked so next iteration can drain it
            prevExtractionPromise = processEntityExtraction(id)
              .catch((e: unknown) => console.warn("[entity worker]", e));

            results.push({ id, memory: text, event });
          } catch (itemErr: unknown) {
            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
            console.error(`[MCP] add_memories item error text.slice(0,80)="${text.slice(0, 80)}" err=${msg}`);
            results.push({ id: null, memory: text, event: "ERROR", error: msg });
          }
        }

        // Drain the last item's entity extraction (fire-and-forget to caller,
        // but we still want it to finish before the session tears down)
        if (prevExtractionPromise) {
          await Promise.race([
            prevExtractionPromise,
            new Promise<void>((r) => setTimeout(r, EXTRACTION_DRAIN_TIMEOUT_MS)),
          ]);
        }

        console.log(`[MCP] add_memories done in ${Date.now() - t0}ms batch=${items.length}`);

        return {
          content: [{ type: "text", text: JSON.stringify({ results }) }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in add_memories:", msg);
        return { content: [{ type: "text", text: `Error adding memories: ${msg}` }] };
      }
    }
  );

  // -------- search_memory (dual-mode) --------
  //
  //   query absent / empty  →  BROWSE MODE
  //     Chronological listing sorted by createdAt DESC.
  //     Supports offset + limit pagination and returns total count.
  //     Replaces the former list_memories tool.
  //
  //   query present  →  SEARCH MODE
  //     Hybrid BM25 + vector search via Reciprocal Rank Fusion.
  //     Returns relevance-ranked results with confidence signal.
  //
  server.registerTool(
    "search_memory",
    {
      description:
        "Dual-mode memory tool. " +
        "SEARCH (query provided): hybrid relevance search using BM25 + vector similarity — use for specific recall, " +
        "incident lookup, policy checks, or any targeted question. " +
        "BROWSE (query omitted): returns all memories newest-first with total count and offset/limit pagination — " +
        "use on cold-start to see what is already known, for category audits, or to systematically page through the store.",
      inputSchema: searchMemorySchema,
    },
    async ({ query, limit, offset, category, created_after }) => {
      if (!userId) return { content: [{ type: "text", text: "Error: user_id not provided" }] };
      if (!clientName) return { content: [{ type: "text", text: "Error: client_name not provided" }] };

      const browseMode = !query || query.trim() === "";

      try {
        const t0 = Date.now();

        // ── BROWSE MODE ───────────────────────────────────────────────────
        if (browseMode) {
          const effectiveLimit = Math.min(limit ?? 50, 200);
          const effectiveOffset = offset ?? 0;
          console.log(`[MCP] search_memory browse userId=${userId} limit=${effectiveLimit} offset=${effectiveOffset} category=${category}`);

          const countRows = await runRead<{ total: number }>(
            `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
             WHERE m.invalidAt IS NULL AND m.state <> 'deleted'
             ${category ? `MATCH (m)-[:HAS_CATEGORY]->(cFilter:Category) WHERE toLower(cFilter.name) = toLower($category)` : ""}
             RETURN count(m) AS total`,
            { userId, category }
          );
          const total = countRows[0]?.total ?? 0;

          const rows = await runRead<{
            id: string; content: string; createdAt: string; updatedAt: string; categories: string[];
          }>(
            `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
             WHERE m.invalidAt IS NULL AND m.state <> 'deleted'
             ${category ? `MATCH (m)-[:HAS_CATEGORY]->(cFilter:Category) WHERE toLower(cFilter.name) = toLower($category)` : ""}
             OPTIONAL MATCH (m)-[:HAS_CATEGORY]->(c:Category)
             WITH m, collect(c.name) AS categories
             ORDER BY m.createdAt DESC
             SKIP $offset
             LIMIT $limit
             RETURN m.id AS id, m.content AS content,
                    m.createdAt AS createdAt, m.updatedAt AS updatedAt,
                    categories`,
            { userId, offset: effectiveOffset, limit: effectiveLimit, category }
          );

          console.log(`[MCP] search_memory browse done in ${Date.now() - t0}ms count=${rows.length} total=${total}`);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                total,
                offset: effectiveOffset,
                limit: effectiveLimit,
                results: rows.map((m) => ({
                  id: m.id,
                  memory: m.content,
                  created_at: m.createdAt,
                  updated_at: m.updatedAt,
                  categories: m.categories ?? [],
                })),
              }, null, 2),
            }],
          };
        }

        // ── SEARCH MODE ───────────────────────────────────────────────────
        const effectiveLimit = limit ?? 10;
        console.log(`[MCP] search_memory search userId=${userId} query="${query}" limit=${effectiveLimit}`);

        // Spec 02: hybrid search (BM25 + vector + RRF)
        const results = await hybridSearch(query, {
          userId,
          topK: effectiveLimit,
          mode: "hybrid",
        });

        // Apply optional post-filters (category, date)
        let filtered = results;
        if (category) {
          const catLower = category.toLowerCase();
          filtered = filtered.filter(r => r.categories.some(c => c.toLowerCase() === catLower));
        }
        if (created_after) {
          filtered = filtered.filter(r => r.createdAt >= created_after);
        }

        console.log(`[MCP] search_memory search done in ${Date.now() - t0}ms hits=${results.length} filtered=${filtered.length}`);

        // Log access for each hit — fire-and-forget
        if (filtered.length > 0) {
          const now = new Date().toISOString();
          const ids = filtered.map(r => r.id);
          runWrite(
            `MERGE (a:App {appName: $appName})
             WITH a
             MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
             WHERE m.id IN $ids
             CREATE (a)-[:ACCESSED {accessedAt: $accessedAt, queryUsed: $query}]->(m)`,
            { appName: clientName, userId, ids, accessedAt: now, query }
          ).catch(() => {/* non-critical */});
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              // Eval v4 Finding 3: low-confidence flag when no BM25 hit and scores are weak
              ...(filtered.length > 0 ? (() => {
                const hasAnyTextHit = filtered.some(r => r.textRank !== null);
                const maxScore = Math.max(...filtered.map(r => r.rrfScore));
                const confident = hasAnyTextHit || maxScore > 0.02;
                return {
                  confident,
                  message: confident
                    ? "Found relevant results."
                    : "Found some results, but confidence is LOW. These might not be relevant to your query.",
                };
              })() : { confident: true, message: "No results found." }),
              results: filtered.map((r) => {
                const normalizedScore = Math.min(1.0, Math.round((r.rrfScore / 0.032786) * 100) / 100);
                return {
                  id: r.id,
                  memory: r.content,
                  relevance_score: normalizedScore,
                  raw_score: r.rrfScore,
                  text_rank: r.textRank,
                  vector_rank: r.vectorRank,
                  created_at: r.createdAt,
                  categories: r.categories,
                };
              }),
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in search_memory:", msg);
        return { content: [{ type: "text", text: `Error searching memory: ${msg}` }] };
      }
    }
  );

  // -------- update_memory --------
  server.registerTool(
    "update_memory",
    {
      description:
        "Update an existing memory with new content. The old version is preserved in history (bi-temporal model) " +
        "and the new content replaces it as the current version. Use when a previously stored fact has changed — " +
        "e.g. the user changed jobs, moved cities, switched tech stacks, or corrected earlier information.",
      inputSchema: updateMemorySchema,
    },
    async ({ memory_id, memory_content, text }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      if (!memory_id && !memory_content) {
        return { content: [{ type: "text" as const, text: "Error: provide either memory_id or memory_content" }] };
      }

      try {
        const t0 = Date.now();

        // Resolve memory ID — direct when provided, fuzzy-content-match otherwise
        let resolvedMemoryId = memory_id;
        if (!resolvedMemoryId) {
          const found = await runRead<{ id: string }>(
            `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
             WHERE m.invalidAt IS NULL AND toLower(m.content) CONTAINS toLower($fragment)
             RETURN m.id AS id ORDER BY m.createdAt DESC LIMIT 1`,
            { userId, fragment: memory_content! },
          );
          if (found.length === 0) {
            return { content: [{ type: "text" as const, text: "Error: No memory found matching the provided content fragment" }] };
          }
          resolvedMemoryId = found[0].id;
        }

        console.log(`[MCP] update_memory start for userId=${userId} memoryId=${resolvedMemoryId}`);

        // Verify old memory exists and belongs to user
        const oldRows = await runRead<{ content: string }>(
          `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory {id: $memoryId})
           WHERE m.invalidAt IS NULL
           RETURN m.content AS content`,
          { userId, memoryId: resolvedMemoryId },
        );

        if (oldRows.length === 0) {
          return { content: [{ type: "text" as const, text: "Error: Memory not found or already superseded" }] };
        }

        // Use bi-temporal supersede — old memory preserved with invalidAt, new one linked via [:SUPERSEDES]
        const newId = await supersedeMemory(resolvedMemoryId, text, userId, clientName);

        console.log(`[MCP] update_memory done in ${Date.now() - t0}ms old=${resolvedMemoryId} new=${newId}`);

        // Async entity extraction on new version — fire-and-forget
        processEntityExtraction(newId).catch((e) => console.warn("[entity worker]", e));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              updated: {
                old_id: resolvedMemoryId,
                new_id: newId,
                old_content: oldRows[0].content,
                new_content: text,
              },
              message: "Memory updated — old version preserved in history",
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in update_memory:", msg);
        return { content: [{ type: "text" as const, text: `Error updating memory: ${msg}` }] };
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // Entity & Knowledge tools — structured memory via entities & relations
  // ────────────────────────────────────────────────────────────────────────

  // -------- search_memory_entities --------
  server.registerTool(
    "search_memory_entities",
    {
      description:
        "Find people, organizations, places, concepts, or products mentioned across memories. " +
        "Searches by name substring match AND semantic similarity on entity descriptions. " +
        "Returns matching entities with their type and how many memories reference them. " +
        "Use when tracing who or what the user has discussed — e.g. 'which people have I mentioned?' or 'what technologies do I use?'",
      inputSchema: searchMemoryEntitiesSchema,
    },
    async ({ query, entity_type, limit }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      try {
        const effectiveLimit = limit ?? 10;
        const typeClause = entity_type ? "AND e.type = $entityType" : "";
        const params: Record<string, unknown> = { userId, query: query.toLowerCase(), limit: effectiveLimit };
        if (entity_type) params.entityType = entity_type.toUpperCase();

        // Arm 1: Substring match on name/description (existing behavior)
        const substringRows = await runRead<{
          id: string; name: string; type: string;
          description: string | null; memoryCount: number;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
           WHERE (toLower(e.name) CONTAINS $query
                  OR (e.description IS NOT NULL AND toLower(e.description) CONTAINS $query))
                 ${typeClause}
           OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(e)
           WHERE m.invalidAt IS NULL
           WITH e, count(m) AS memoryCount
           RETURN e.id AS id, e.name AS name, e.type AS type,
                  e.description AS description, memoryCount
           ORDER BY memoryCount DESC
           LIMIT $limit`,
          params,
        );

        // Arm 2: Semantic match — embed query, compute cosine similarity against entity descriptions
        let semanticRows: typeof substringRows = [];
        try {
          const queryEmbedding = await embed(query);
          const semanticParams: Record<string, unknown> = {
            userId,
            embedding: queryEmbedding,
            limit: effectiveLimit,
          };
          if (entity_type) semanticParams.entityType = entity_type.toUpperCase();
          const semanticTypeClause = entity_type ? "AND e.type = $entityType" : "";

          semanticRows = await runRead<{
            id: string; name: string; type: string;
            description: string | null; memoryCount: number;
          }>(
            `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
             WHERE e.descriptionEmbedding IS NOT NULL ${semanticTypeClause}
             WITH e, vector.similarity.cosine(e.descriptionEmbedding, $embedding) AS similarity
             WHERE similarity > 0.3
             OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(e)
             WHERE m.invalidAt IS NULL
             WITH e, count(m) AS memoryCount, similarity
             ORDER BY similarity DESC
             LIMIT $limit
             RETURN e.id AS id, e.name AS name, e.type AS type,
                    e.description AS description, memoryCount`,
            semanticParams,
          );
        } catch {
          // Semantic arm is best-effort — vector similarity may not be available
          // on Entity nodes if embeddings haven't been computed yet
        }

        // Merge results: deduplicate by id, substring matches first, then semantic
        const seen = new Set<string>();
        const merged: typeof substringRows = [];
        for (const row of [...substringRows, ...semanticRows]) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
          }
        }

        const finalRows = merged.slice(0, effectiveLimit);
        console.log(`[MCP] search_memory_entities query="${query}" substring=${substringRows.length} semantic=${semanticRows.length} merged=${finalRows.length}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ nodes: finalRows }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in search_memory_entities:", msg);
        return { content: [{ type: "text" as const, text: `Error searching memory entities: ${msg}` }] };
      }
    },
  );

  // -------- get_memory_entity --------
  server.registerTool(
    "get_memory_entity",
    {
      description:
        "Get the complete profile of a known entity — its type, description, every memory that mentions it, " +
        "connected entities (co-occurrence), and explicit relationships. " +
        "Use when the user asks about a specific person, company, project, " +
        "or concept and you need full context from memory.",
      inputSchema: getMemoryEntitySchema,
    },
    async ({ entity_id, entity_name }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      if (!entity_id && !entity_name) {
        return { content: [{ type: "text" as const, text: "Error: provide either entity_id or entity_name" }] };
      }

      try {
        // Resolve entity ID — direct when provided, name-lookup otherwise
        let resolvedEntityId = entity_id;
        if (!resolvedEntityId) {
          const found = await runRead<{ id: string }>(
            `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
             WHERE toLower(e.name) = toLower($name)
             RETURN e.id AS id LIMIT 1`,
            { userId, name: entity_name! },
          );
          if (found.length === 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Entity not found" }) }] };
          }
          resolvedEntityId = found[0].id;
        }

        // Get entity details
        const entityRows = await runRead<{
          id: string; name: string; type: string;
          description: string | null; createdAt: string;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           RETURN e.id AS id, e.name AS name, e.type AS type,
                  e.description AS description, e.createdAt AS createdAt`,
          { userId, entityId: resolvedEntityId },
        );

        if (entityRows.length === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Entity not found" }) }] };
        }

        // Get memories mentioning this entity (most recent first)
        const memRows = await runRead<{
          id: string; content: string; createdAt: string;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           MATCH (m:Memory)-[:MENTIONS]->(e)
           WHERE m.invalidAt IS NULL
           RETURN m.id AS id, m.content AS content, m.createdAt AS createdAt
           ORDER BY m.createdAt DESC
           LIMIT 20`,
          { userId, entityId: resolvedEntityId },
        );

        // Get connected entities (co-occurrence)
        const connectedRows = await runRead<{
          id: string; name: string; type: string; weight: number;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(center:Entity {id: $entityId})
           MATCH (m:Memory)-[:MENTIONS]->(center)
           WHERE m.invalidAt IS NULL
           MATCH (m)-[:MENTIONS]->(other:Entity)<-[:HAS_ENTITY]-(u)
           WHERE other.id <> center.id
           WITH other, count(DISTINCT m) AS weight
           RETURN other.id AS id, other.name AS name, other.type AS type, weight
           ORDER BY weight DESC
           LIMIT 10`,
          { userId, entityId: resolvedEntityId },
        );

        // Get explicit RELATED_TO relationships (both directions)
        const relRows = await runRead<{
          sourceName: string; relType: string;
          targetName: string; targetType: string;
          description: string | null;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(center:Entity {id: $entityId})
           MATCH (center)-[r:RELATED_TO]->(tgt:Entity)<-[:HAS_ENTITY]-(u)
           RETURN center.name AS sourceName, r.relType AS relType,
                  tgt.name AS targetName, tgt.type AS targetType,
                  r.description AS description
           UNION ALL
           MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(center:Entity {id: $entityId})
           MATCH (u)-[:HAS_ENTITY]->(src:Entity)-[r:RELATED_TO]->(center)
           RETURN src.name AS sourceName, r.relType AS relType,
                  center.name AS targetName, center.type AS targetType,
                  r.description AS description`,
          { userId, entityId: resolvedEntityId },
        );

        const entity = entityRows[0];
        console.log(`[MCP] get_memory_entity id=${resolvedEntityId} memories=${memRows.length} connected=${connectedRows.length} relations=${relRows.length}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              entity: {
                id: entity.id,
                name: entity.name,
                type: entity.type,
                description: entity.description,
                createdAt: entity.createdAt,
              },
              memories: memRows.map((m) => ({
                id: m.id,
                content: m.content,
                createdAt: m.createdAt,
              })),
              connectedEntities: connectedRows,
              relationships: relRows.map((r) => ({
                source: r.sourceName,
                type: r.relType,
                target: r.targetName,
                targetType: r.targetType,
                description: r.description,
              })),
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in get_memory_entity:", msg);
        return { content: [{ type: "text" as const, text: `Error getting memory entity: ${msg}` }] };
      }
    },
  );

  // -------- get_related_memories --------
  server.registerTool(
    "get_related_memories",
    {
      description: "Natural language entity graph traversal. Finds an entity by name and returns all memories mentioning it, plus its explicit relationships to other entities. Use this to quickly understand everything known about a specific component, person, or concept.",
      inputSchema: getRelatedMemoriesSchema,
    },
    async ({ entity_name, entity_id: entityIdParam }) => {
      if (!userId) return { content: [{ type: "text", text: "Error: user_id not provided" }] };

      if (!entity_name && !entityIdParam) {
        return { content: [{ type: "text", text: "Error: provide entity_name or entity_id" }] };
      }

      try {
        // Resolve entity: prefer entity_id (direct), fall back to name resolution
        const entityId = entityIdParam
          ? entityIdParam
          : await resolveEntity({ name: entity_name!, type: "OTHER", description: "" }, userId);

        // Get entity details
        const entityRows = await runRead<{
          id: string; name: string; type: string; description: string | null;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           RETURN e.id AS id, e.name AS name, e.type AS type, e.description AS description`,
          { userId, entityId }
        );

        if (entityRows.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Entity not found" }) }] };
        }

        const entity = entityRows[0];

        // Get memories mentioning this entity — correct edge: Memory-[:MENTIONS]->Entity
        const memRows = await runRead<{
          id: string; content: string; createdAt: string;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           MATCH (m:Memory)-[:MENTIONS]->(e)
           WHERE m.invalidAt IS NULL
           RETURN m.id AS id, m.content AS content, m.createdAt AS createdAt
           ORDER BY m.createdAt DESC
           LIMIT 20`,
          { userId, entityId },
        );

        // 3. Get explicit RELATED_TO relationships
        const relRows = await runRead<{
          sourceName: string; relType: string;
          targetName: string; targetType: string;
          description: string | null;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(center:Entity {id: $entityId})
           MATCH (center)-[r:RELATED_TO]->(tgt:Entity)<-[:HAS_ENTITY]-(u)
           RETURN center.name AS sourceName, r.relType AS relType,
                  tgt.name AS targetName, tgt.type AS targetType,
                  r.description AS description
           UNION ALL
           MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(center:Entity {id: $entityId})
           MATCH (u)-[:HAS_ENTITY]->(src:Entity)-[r:RELATED_TO]->(center)
           RETURN src.name AS sourceName, r.relType AS relType,
                  center.name AS targetName, center.type AS targetType,
                  r.description AS description`,
          { userId, entityId },
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              entity: {
                id: entity.id,
                name: entity.name,
                type: entity.type,
                description: entity.description,
              },
              memories: memRows.map(m => ({ id: m.id, content: m.content, created_at: m.createdAt })),
              relationships: relRows.map(r => ({
                source: r.sourceName,
                type: r.relType,
                target: r.targetName,
                description: r.description,
              })),
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error getting related memories: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  // -------- get_memory_map --------
  server.registerTool(
    "get_memory_map",
    {
      description:
        "Build a knowledge map centered on an entity — returns all connected entities and the relationships " +
        "between them as a structured graph (nodes + edges), including inter-neighbor connections. " +
        "Use when you need to understand a complex relationship network or visualize how concepts relate. " +
        "Set depth=2 for friends-of-friends (default: 1).",
      inputSchema: getMemoryMapSchema,
    },
    async ({ entity_id, depth, limit, max_edges }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      try {
        const effectiveDepth = Math.min(depth ?? 1, 3);
        const effectiveLimit = Math.min(limit ?? 50, 50);
        const effectiveMaxEdges = Math.min(max_edges ?? 100, 500);

        // Get the center entity
        const centerRows = await runRead<{
          id: string; name: string; type: string; description: string | null;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           RETURN e.id AS id, e.name AS name, e.type AS type, e.description AS description`,
          { userId, entityId: entity_id },
        );

        if (centerRows.length === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Entity not found" }) }] };
        }

        // Collect all entities in the subgraph via co-occurrence
        const allNeighbors = await runRead<{
          id: string; name: string; type: string; description: string | null; hop: number;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(center:Entity {id: $entityId})
           MATCH (m:Memory)-[:MENTIONS]->(center)
           WHERE m.invalidAt IS NULL
           MATCH (m)-[:MENTIONS]->(hop1:Entity)<-[:HAS_ENTITY]-(u)
           WHERE hop1.id <> center.id
           WITH DISTINCT u, center, hop1
           RETURN hop1.id AS id, hop1.name AS name, hop1.type AS type,
                  hop1.description AS description, 1 AS hop
           LIMIT $limit`,
          { userId, entityId: entity_id, limit: effectiveLimit },
        );

        // For depth >= 2, add second-hop entities
        const hop2Entities: typeof allNeighbors = [];
        if (effectiveDepth >= 2 && allNeighbors.length > 0) {
          const hop1Ids = allNeighbors.map((n) => n.id);
          const hop2Rows = await runRead<{
            id: string; name: string; type: string; description: string | null;
          }>(
            `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(hop1:Entity)
             WHERE hop1.id IN $hop1Ids
             MATCH (m:Memory)-[:MENTIONS]->(hop1)
             WHERE m.invalidAt IS NULL
             MATCH (m)-[:MENTIONS]->(hop2:Entity)<-[:HAS_ENTITY]-(u)
             WHERE hop2.id <> $centerId AND NOT hop2.id IN $hop1Ids
             WITH DISTINCT hop2
             RETURN hop2.id AS id, hop2.name AS name, hop2.type AS type,
                    hop2.description AS description
             LIMIT $limit`,
            { userId, hop1Ids, centerId: entity_id, limit: effectiveLimit },
          );
          for (const r of hop2Rows) {
            hop2Entities.push({ ...r, hop: 2 });
          }
        }

        // All node IDs in the subgraph
        const allNodes = [centerRows[0], ...allNeighbors, ...hop2Entities];
        const allIds = allNodes.map((n) => n.id);

        // Get all co-occurrence edges between nodes in the subgraph
        const coEdges = await runRead<{
          srcName: string; tgtName: string; weight: number;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(src:Entity),
                 (u)-[:HAS_ENTITY]->(tgt:Entity)
           WHERE src.id IN $ids AND tgt.id IN $ids AND src.id < tgt.id
           MATCH (m:Memory)-[:MENTIONS]->(src)
           WHERE m.invalidAt IS NULL
           MATCH (m)-[:MENTIONS]->(tgt)
           WITH src.name AS srcName, tgt.name AS tgtName, count(DISTINCT m) AS weight
           WHERE weight > 0
           RETURN srcName, tgtName, weight
           ORDER BY weight DESC`,
          { userId, ids: allIds },
        );

        // Get explicit RELATED_TO edges between subgraph nodes
        const relEdges = await runRead<{
          srcName: string; relType: string; tgtName: string; description: string | null;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(src:Entity)-[r:RELATED_TO]->(tgt:Entity)<-[:HAS_ENTITY]-(u)
           WHERE src.id IN $ids AND tgt.id IN $ids
           RETURN src.name AS srcName, r.relType AS relType,
                  tgt.name AS tgtName, r.description AS description`,
          { userId, ids: allIds },
        );

        console.log(`[MCP] get_memory_map entity=${entity_id} nodes=${allNodes.length} coEdges=${coEdges.length} relEdges=${relEdges.length}`);

        const allEdges = [
          ...coEdges.map((e) => ({
            source: e.srcName, target: e.tgtName,
            relationship: "CO_OCCURS_WITH",
            weight: e.weight,
          })),
          ...relEdges.map((e) => ({
            source: e.srcName, target: e.tgtName,
            relationship: e.relType,
            description: e.description,
          })),
        ];

        const truncated = allEdges.length > effectiveMaxEdges;
        const edges = truncated ? allEdges.slice(0, effectiveMaxEdges) : allEdges;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              nodes: allNodes.map((n) => ({
                id: n.id, name: n.name, type: n.type,
                description: n.description,
                hop: "hop" in n ? n.hop : 0,
              })),
              edges,
              ...(truncated ? {
                truncated: true,
                totalEdges: allEdges.length,
                returnedEdges: edges.length,
              } : {}),
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in get_memory_map:", msg);
        return { content: [{ type: "text" as const, text: `Error building memory map: ${msg}` }] };
      }
    },
  );

  // -------- create_memory_relation --------
  server.registerTool(
    "create_memory_relation",
    {
      description:
        "Create or update a typed relationship between two entities (e.g. 'Alice WORKS_AT Acme', " +
        "'User USES TypeScript'). Entities are auto-created if they don't exist yet. " +
        "Use when the user states a fact linking two things, or when you extract structured knowledge from conversation.",
      inputSchema: createMemoryRelationSchema,
    },
    async ({ source_entity, relationship_type, target_entity, description }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      try {
        const now = new Date().toISOString();
        const relType = relationship_type.toUpperCase().replace(/\s+/g, "_");
        const srcInput = source_entity.trim();
        const tgtInput = target_entity.trim();
        const desc = description ?? "";
        const relId = randomUUID();

        // Use shared resolveEntity to avoid entity duplication between
        // create_memory_relation and the extraction pipeline (Eval v4 Finding 1)
        const srcId = await resolveEntity(
          { name: srcInput, type: "CONCEPT", description: desc },
          userId,
        );
        const tgtId = await resolveEntity(
          { name: tgtInput, type: "CONCEPT", description: "" },
          userId,
        );
        const src = { id: srcId, name: srcInput };
        const tgt = { id: tgtId, name: tgtInput };

        // MERGE the RELATED_TO edge using entity IDs (not names)
        const rows = await runWrite<{ relId: string; srcName: string; tgtName: string }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(src:Entity {id: $srcId})
           MATCH (u)-[:HAS_ENTITY]->(tgt:Entity {id: $tgtId})
           MERGE (src)-[r:RELATED_TO {relType: $relType}]->(tgt)
           ON CREATE SET r.id = $relId, r.description = $desc, r.createdAt = $now, r.updatedAt = $now
           ON MATCH SET r.description = $desc, r.updatedAt = $now
           RETURN r.id AS relId, src.name AS srcName, tgt.name AS tgtName`,
          { userId, srcId: src.id, tgtId: tgt.id, relType, relId, desc, now },
        );

        const srcName = rows[0]?.srcName ?? src.name;
        const tgtName = rows[0]?.tgtName ?? tgt.name;
        console.log(`[MCP] create_memory_relation ${srcName} -[${relType}]-> ${tgtName}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              relationship: {
                id: rows[0]?.relId ?? relId,
                source: srcName,
                type: relType,
                target: tgtName,
                description: desc,
              },
              message: "Relationship created successfully",
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in create_memory_relation:", msg);
        return { content: [{ type: "text" as const, text: `Error creating memory relation: ${msg}` }] };
      }
    },
  );

  // -------- delete_memory_relation --------
  server.registerTool(
    "delete_memory_relation",
    {
      description:
        "Remove a specific typed relationship between two entities. Use when a previously known fact " +
        "is no longer true (e.g. someone left a company, stopped using a tool, or moved cities).",
      inputSchema: deleteMemoryRelationSchema,
    },
    async ({ relationship_id, source_entity, relationship_type, target_entity }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      // Require either relationship_id OR all three name-based params
      if (!relationship_id && (!source_entity || !relationship_type || !target_entity)) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: provide either relationship_id or all of source_entity, relationship_type, and target_entity",
          }],
        };
      }

      try {
        let rows: Array<{ count: number; label: string }>;

        if (relationship_id) {
          // Fast path: delete by relationship ID (returned by create_memory_relation)
          rows = await runWrite<{ count: number; label: string }>(
            `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(src:Entity)-[r:RELATED_TO {id: $relId}]->(tgt:Entity)<-[:HAS_ENTITY]-(u)
             WITH src.name AS sn, r.relType AS rt, tgt.name AS tn
             DELETE r
             RETURN 1 AS count, (sn + ' -[' + rt + ']-> ' + tn) AS label`,
            { userId, relId: relationship_id },
          );
        } else {
          // Name-based path: match by source / type / target names
          const relType = relationship_type!.toUpperCase().replace(/\s+/g, "_");
          const srcInput = source_entity!.trim();
          const tgtInput = target_entity!.trim();
          rows = await runWrite<{ count: number; label: string }>(
            `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(src:Entity)
             WHERE toLower(src.name) = toLower($srcName)
             MATCH (u)-[:HAS_ENTITY]->(tgt:Entity)
             WHERE toLower(tgt.name) = toLower($tgtName)
             MATCH (src)-[r:RELATED_TO {relType: $relType}]->(tgt)
             DELETE r
             RETURN 1 AS count, ($srcName + ' -[' + $relType + ']-> ' + $tgtName) AS label`,
            { userId, srcName: srcInput, tgtName: tgtInput, relType },
          );
        }

        const deleted = rows[0]?.count ?? rows.length;
        const label = rows[0]?.label
          ?? (relationship_id ? relationship_id : `${source_entity} -[${relationship_type}]-> ${target_entity}`);
        console.log(`[MCP] delete_memory_relation ${label} deleted=${deleted}`);

        return {
          content: [{
            type: "text" as const,
            text: deleted > 0
              ? `Successfully removed relationship ${label}`
              : "No matching relationship found to remove",
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in delete_memory_relation:", msg);
        return { content: [{ type: "text" as const, text: `Error deleting memory relation: ${msg}` }] };
      }
    },
  );

  // -------- delete_memory_entity --------
  server.registerTool(
    "delete_memory_entity",
    {
      description:
        "Remove an entity and all its connections from memory. The memories themselves are preserved — " +
        "only the entity record and its relationships are deleted. " +
        "WARNING: This also removes all explicit relationships (e.g. OWNS, WORKS_AT) " +
        "connected to this entity. Use when the user asks to stop tracking " +
        "a specific person, concept, or organization.",
      inputSchema: deleteMemoryEntitySchema,
    },
    async ({ entity_id, entity_name }) => {
      if (!userId) return { content: [{ type: "text" as const, text: "Error: user_id not provided" }] };

      if (!entity_id && !entity_name) {
        return { content: [{ type: "text" as const, text: "Error: provide either entity_id or entity_name" }] };
      }

      try {
        // Resolve entity ID — direct when provided, name-lookup otherwise
        let resolvedEntityId = entity_id;
        if (!resolvedEntityId) {
          const found = await runRead<{ id: string }>(
            `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
             WHERE toLower(e.name) = toLower($name)
             RETURN e.id AS id LIMIT 1`,
            { userId, name: entity_name! },
          );
          if (found.length === 0) {
            return { content: [{ type: "text" as const, text: "Error: Entity not found" }] };
          }
          resolvedEntityId = found[0].id;
        }

        // Count relationships that will be lost before deleting
        const countRows = await runRead<{
          name: string; mentionCount: number; relationCount: number;
        }>(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           OPTIONAL MATCH (m:Memory)-[mention:MENTIONS]->(e)
           WITH e, count(mention) AS mentionCount
           OPTIONAL MATCH (e)-[rel:RELATED_TO]-()
           RETURN e.name AS name, mentionCount,
                  count(rel) AS relationCount`,
          { userId, entityId: resolvedEntityId },
        );

        if (countRows.length === 0 || countRows[0].name == null) {
          return { content: [{ type: "text" as const, text: "Error: Entity not found or not owned by user" }] };
        }

        const { name, mentionCount, relationCount } = countRows[0];

        // Now perform the DETACH DELETE
        await runWrite(
          `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
           DETACH DELETE e`,
          { userId, entityId: resolvedEntityId },
        );

        console.log(`[MCP] delete_memory_entity id=${resolvedEntityId} name=${name} mentions=${mentionCount} relations=${relationCount}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              deleted: {
                entity: name,
                mentionEdgesRemoved: mentionCount,
                relationshipsRemoved: relationCount,
              },
              message: `Removed entity "${name}" and all its connections (${mentionCount} memory mentions, ${relationCount} explicit relationships deleted)`,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Error in delete_memory_entity:", msg);
        return { content: [{ type: "text" as const, text: `Error deleting memory entity: ${msg}` }] };
      }
    },
  );

  return server;
}
