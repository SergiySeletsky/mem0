/**
 * Unit tests — MCP tool handlers (full coverage, all 10 tools)
 *
 * Tests all 10 MCP tools by mocking the DB layer (runRead/runWrite),
 * embedding layer (embed), and pipeline modules (addMemory, hybridSearch, etc),
 * then invoking handlers via the MCP SDK in-process client-server pair
 * (InMemoryTransport).
 *
 * Coverage:
 *   add_memory:
 *     MCP_ADD_01:    normal ADD path returns {id, memory, event: "ADD"}
 *     MCP_ADD_02:    dedup skip returns event: "SKIP_DUPLICATE"
 *     MCP_ADD_03:    dedup supersede returns event: "SUPERSEDE"
 *     MCP_ADD_04:    fires entity extraction asynchronously
 *
 *   search_memory:
 *     MCP_SM_01:     returns hybrid search results with score, text_rank, vector_rank
 *     MCP_SM_02:     category filter removes non-matching results
 *     MCP_SM_03:     created_after filter removes older results
 *     MCP_SM_04:     logs access via runWrite (non-blocking)
 *
 *   list_memories:
 *     MCP_LIST_01:   returns paginated shape { total, offset, limit, memories }
 *     MCP_LIST_02:   respects offset for pagination
 *     MCP_LIST_03:   clamps limit to max 200
 *     MCP_LIST_04:   includes categories per memory
 *
 *   update_memory:
 *     MCP_UPD_01:    supersedes old memory with bi-temporal model
 *     MCP_UPD_02:    returns error when memory not found
 *     MCP_UPD_03:    fires entity extraction on new version
 *
 *   search_memory_entities:
 *     MCP_SEARCH_01: substring arm finds entities by name
 *     MCP_SEARCH_02: semantic arm finds by descriptionEmbedding
 *     MCP_SEARCH_03: deduplicates across both arms
 *     MCP_SEARCH_04: graceful degradation when embed() fails
 *     MCP_SEARCH_05: entity_type filter works
 *
 *   get_memory_entity:
 *     MCP_ENT_01:    returns full profile (entity, memories, connected, relationships)
 *     MCP_ENT_02:    returns error when entity not found
 *     MCP_ENT_03:    respects user namespace (Cypher has userId)
 *
 *   get_memory_map:
 *     MCP_MAP_01:    returns nodes and edges
 *     MCP_MAP_02:    truncates edges to max_edges
 *     MCP_MAP_03:    returns error when entity not found
 *
 *   create_memory_relation:
 *     MCP_REL_01:    creates relation between existing entities
 *     MCP_REL_02:    auto-creates entities that don't exist
 *     MCP_REL_03:    case-insensitive entity matching
 *     MCP_REL_04:    normalizes relationship type to UPPER_SNAKE_CASE
 *
 *   delete_memory_relation:
 *     MCP_DELR_01:   deletes matching relationship
 *     MCP_DELR_02:   returns "no matching" when relation not found
 *
 *   delete_memory_entity:
 *     MCP_DEL_01:    returns cascade report (mentions + relations)
 *     MCP_DEL_02:    returns error when entity not found
 *     MCP_DEL_03:    calls DETACH DELETE with correct entity id
 */

export {};

// ---------------------------------------------------------------------------
// Mocks — must come before imports
// ---------------------------------------------------------------------------
const mockRunRead = jest.fn();
const mockRunWrite = jest.fn();
const mockEmbed = jest.fn();

jest.mock("@/lib/db/memgraph", () => ({
  runRead: (...args: unknown[]) => mockRunRead(...args),
  runWrite: (...args: unknown[]) => mockRunWrite(...args),
}));

jest.mock("@/lib/embeddings/openai", () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
}));

jest.mock("@/lib/memory/write", () => ({
  addMemory: jest.fn(),
  deleteMemory: jest.fn(),
  deleteAllMemories: jest.fn(),
  supersedeMemory: jest.fn(),
}));

jest.mock("@/lib/memory/search", () => ({
  searchMemories: jest.fn(),
  listMemories: jest.fn(),
}));

jest.mock("@/lib/search/hybrid", () => ({
  hybridSearch: jest.fn(),
}));

jest.mock("@/lib/dedup", () => ({
  checkDeduplication: jest.fn(),
}));

jest.mock("@/lib/entities/worker", () => ({
  processEntityExtraction: jest.fn(),
}));

jest.mock("@/lib/entities/resolve", () => ({
  resolveEntity: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------
jest.mock("@/lib/entities/resolve", () => ({
  resolveEntity: jest.fn(),
}));

import { createMcpServer } from "@/lib/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { addMemory, supersedeMemory } from "@/lib/memory/write";
import { hybridSearch } from "@/lib/search/hybrid";
import { checkDeduplication } from "@/lib/dedup";
import { processEntityExtraction } from "@/lib/entities/worker";
import { resolveEntity } from "@/lib/entities/resolve";

const mockAddMemory = addMemory as jest.MockedFunction<typeof addMemory>;
const mockSupersedeMemory = supersedeMemory as jest.MockedFunction<typeof supersedeMemory>;
const mockHybridSearch = hybridSearch as jest.MockedFunction<typeof hybridSearch>;
const mockCheckDeduplication = checkDeduplication as jest.MockedFunction<typeof checkDeduplication>;
const mockProcessEntityExtraction = processEntityExtraction as jest.MockedFunction<typeof processEntityExtraction>;
const mockResolveEntity = resolveEntity as jest.MockedFunction<typeof resolveEntity>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const USER_ID = "test-user";
const CLIENT_NAME = "test-client";

async function setupClientServer() {
  const server = createMcpServer(USER_ID, CLIENT_NAME);
  const client = new Client({ name: "test-mcp-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client, clientTransport, serverTransport };
}

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — add_memory", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_ADD_01: normal ADD returns {id, memory, event: 'ADD'}", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({ action: "add" } as any);
    mockAddMemory.mockResolvedValueOnce("new-mem-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "add_memory",
      arguments: { content: "Alice prefers TypeScript" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("new-mem-id");
    expect(parsed.results[0].memory).toBe("Alice prefers TypeScript");
    expect(parsed.results[0].event).toBe("ADD");
    expect(mockAddMemory).toHaveBeenCalledTimes(1);
  });

  it("MCP_ADD_02: dedup skip returns event: 'SKIP_DUPLICATE'", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({
      action: "skip",
      existingId: "existing-id",
    } as any);

    const result = await client.callTool({
      name: "add_memory",
      arguments: { content: "Duplicate content" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results[0].event).toBe("SKIP_DUPLICATE");
    expect(parsed.results[0].id).toBe("existing-id");
    expect(mockAddMemory).not.toHaveBeenCalled();
  });

  it("MCP_ADD_03: dedup supersede returns event: 'SUPERSEDE'", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({
      action: "supersede",
      existingId: "old-id",
    } as any);
    mockSupersedeMemory.mockResolvedValueOnce("superseded-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "add_memory",
      arguments: { content: "Updated preference" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results[0].event).toBe("SUPERSEDE");
    expect(parsed.results[0].id).toBe("superseded-id");
    expect(mockSupersedeMemory).toHaveBeenCalledWith("old-id", "Updated preference", "test-user", "test-client");
  });

  it("MCP_ADD_04: fires entity extraction asynchronously", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({ action: "add" } as any);
    mockAddMemory.mockResolvedValueOnce("ext-mem-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    await client.callTool({
      name: "add_memory",
      arguments: { content: "Entity test" },
    });

    // processEntityExtraction called with the new memory id
    expect(mockProcessEntityExtraction).toHaveBeenCalledWith("ext-mem-id");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — search_memory", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_SM_01: returns hybrid search results with score fields", async () => {
    mockHybridSearch.mockResolvedValueOnce([
      {
        id: "m1", content: "Alice uses TypeScript", rrfScore: 0.05,
        textRank: 1, vectorRank: 2, createdAt: "2026-01-15", categories: ["tech"],
      },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]); // access log

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "TypeScript" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toHaveProperty("id", "m1");
    expect(parsed.results[0]).toHaveProperty("memory", "Alice uses TypeScript");
    expect(parsed.results[0]).toHaveProperty("relevance_score", 1.0); // 0.05 / 0.032786 > 1.0 -> capped at 1.0
    expect(parsed.results[0]).toHaveProperty("raw_score", 0.05);
    expect(parsed.results[0]).toHaveProperty("text_rank", 1);
    expect(parsed.results[0]).toHaveProperty("vector_rank", 2);
    expect(parsed.results[0]).toHaveProperty("categories", ["tech"]);
  });

  it("MCP_SM_02: category filter removes non-matching results", async () => {
    mockHybridSearch.mockResolvedValueOnce([
      { id: "m1", content: "A", rrfScore: 0.1, textRank: 1, vectorRank: 1, createdAt: "2026-01-15", categories: ["tech"] },
      { id: "m2", content: "B", rrfScore: 0.08, textRank: 2, vectorRank: 2, createdAt: "2026-01-14", categories: ["personal"] },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "test", category: "tech" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("m1");
  });

  it("MCP_SM_03: created_after filter removes older results", async () => {
    mockHybridSearch.mockResolvedValueOnce([
      { id: "m1", content: "New", rrfScore: 0.1, textRank: 1, vectorRank: 1, createdAt: "2026-02-10", categories: [] },
      { id: "m2", content: "Old", rrfScore: 0.08, textRank: 2, vectorRank: 2, createdAt: "2026-01-01", categories: [] },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "test", created_after: "2026-02-01" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("m1");
  });

  it("MCP_SM_04: logs access via runWrite (non-blocking)", async () => {
    mockHybridSearch.mockResolvedValueOnce([
      { id: "m1", content: "Hit", rrfScore: 0.1, textRank: 1, vectorRank: 1, createdAt: "2026-01-15", categories: [] },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]);

    await client.callTool({
      name: "search_memory",
      arguments: { query: "hit" },
    });

    // Wait a tick for the fire-and-forget runWrite to be called
    await new Promise((r) => setTimeout(r, 50));
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const accessCypher = mockRunWrite.mock.calls[0][0] as string;
    expect(accessCypher).toContain("ACCESSED");
  });

  it("MCP_SM_05: includes confident:true when BM25 matches exist", async () => {
    mockHybridSearch.mockResolvedValueOnce([
      { id: "m1", content: "Relevant result", rrfScore: 0.05, textRank: 1, vectorRank: 2, createdAt: "2026-01-15", categories: [] },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "relevant" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.confident).toBe(true);
    expect(parsed.message).toContain("Found relevant results");
    expect(parsed.results).toHaveLength(1);
  });

  it("MCP_SM_06: includes confident:false when all text_rank null and low scores", async () => {
    // Simulate irrelevant query — vector-only results with low RRF scores
    mockHybridSearch.mockResolvedValueOnce([
      { id: "m1", content: "Unrelated A", rrfScore: 0.015, textRank: null, vectorRank: 5, createdAt: "2026-01-15", categories: [] },
      { id: "m2", content: "Unrelated B", rrfScore: 0.012, textRank: null, vectorRank: 8, createdAt: "2026-01-14", categories: [] },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "quantum blockchain NFT" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.confident).toBe(false);
    expect(parsed.message).toContain("confidence is LOW");
    expect(parsed.results).toHaveLength(2);
  });

  it("MCP_SM_07: confident:true when no text_rank but high RRF scores", async () => {
    // Vector-only match but with high score (above 0.02 threshold)
    mockHybridSearch.mockResolvedValueOnce([
      { id: "m1", content: "Semantically close", rrfScore: 0.03, textRank: null, vectorRank: 1, createdAt: "2026-01-15", categories: [] },
    ] as any);
    mockRunWrite.mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "semantic match only" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.confident).toBe(true);
    expect(parsed.message).toContain("Found relevant results");
  });

  it("MCP_SM_08: confident:true when results are empty (nothing to misjudge)", async () => {
    mockHybridSearch.mockResolvedValueOnce([] as any);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "nothing matches" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.confident).toBe(true);
    expect(parsed.message).toContain("No results found");
    expect(parsed.results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — list_memories", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_LIST_01: returns paginated shape { total, offset, limit, memories }", async () => {
    // Mock count query
    mockRunRead
      .mockResolvedValueOnce([{ total: 3 }]) // count query
      .mockResolvedValueOnce([                // paginated query
        { id: "m1", content: "Memory one", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: ["work"] },
        { id: "m2", content: "Memory two", createdAt: "2026-01-02", updatedAt: "2026-01-02", categories: [] },
      ]);

    const result = await client.callTool({
      name: "list_memories",
      arguments: {},
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed).toHaveProperty("total", 3);
    expect(parsed).toHaveProperty("offset", 0);
    expect(parsed).toHaveProperty("limit", 50);
    expect(parsed.memories).toHaveLength(2);
    expect(parsed.memories[0]).toHaveProperty("id", "m1");
    expect(parsed.memories[0]).toHaveProperty("memory", "Memory one");
  });

  it("MCP_LIST_02: respects offset for pagination", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 10 }])
      .mockResolvedValueOnce([
        { id: "m6", content: "Memory six", createdAt: "2026-01-06", updatedAt: "2026-01-06", categories: [] },
      ]);

    const result = await client.callTool({
      name: "list_memories",
      arguments: { offset: 5, limit: 1 },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.offset).toBe(5);
    expect(parsed.limit).toBe(1);

    // Verify the Cypher query used SKIP $offset LIMIT $limit
    const paginationCypher = mockRunRead.mock.calls[1][0] as string;
    expect(paginationCypher).toContain("SKIP");
    expect(paginationCypher).toContain("LIMIT");
  });

  it("MCP_LIST_03: clamps limit to max 200", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "list_memories",
      arguments: { limit: 9999 },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.limit).toBe(200);
  });

  it("MCP_LIST_04: includes categories per memory", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        { id: "m1", content: "Test", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: ["architecture", "decisions"] },
      ]);

    const result = await client.callTool({
      name: "list_memories",
      arguments: {},
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.memories[0].categories).toEqual(["architecture", "decisions"]);

    // Verify Cypher joins Category nodes
    const cypher = mockRunRead.mock.calls[1][0] as string;
    expect(cypher).toContain("HAS_CATEGORY");
    expect(cypher).toContain("Category");
  });

  it("MCP_LIST_05: supports category filter", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        { id: "m1", content: "Test", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: ["work"] },
      ]);

    const result = await client.callTool({
      name: "list_memories",
      arguments: { category: "work" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.memories).toHaveLength(1);

    // Verify Cypher filters by Category
    const countCypher = mockRunRead.mock.calls[0][0] as string;
    expect(countCypher).toContain("toLower(cFilter.name) = toLower($category)");
    
    const listCypher = mockRunRead.mock.calls[1][0] as string;
    expect(listCypher).toContain("toLower(cFilter.name) = toLower($category)");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — update_memory", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_UPD_01: supersedes old memory, returns old + new content", async () => {
    // runRead to verify old memory exists
    mockRunRead.mockResolvedValueOnce([{ content: "Old fact about Alice" }]);
    mockSupersedeMemory.mockResolvedValueOnce("new-superseded-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "update_memory",
      arguments: { memory_id: "old-mem-id", new_text: "Updated fact about Alice" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.updated.old_id).toBe("old-mem-id");
    expect(parsed.updated.new_id).toBe("new-superseded-id");
    expect(parsed.updated.old_content).toBe("Old fact about Alice");
    expect(parsed.updated.new_content).toBe("Updated fact about Alice");
    expect(parsed.message).toContain("preserved in history");
    expect(mockSupersedeMemory).toHaveBeenCalledWith("old-mem-id", "Updated fact about Alice", "test-user", "test-client");
  });

  it("MCP_UPD_02: returns error when memory not found", async () => {
    mockRunRead.mockResolvedValueOnce([]); // no memory found

    const result = await client.callTool({
      name: "update_memory",
      arguments: { memory_id: "nonexistent", new_text: "Doesn't matter" },
    });

    const text = (result as any).content[0].text;
    expect(text).toContain("not found");
    expect(mockSupersedeMemory).not.toHaveBeenCalled();
  });

  it("MCP_UPD_03: fires entity extraction on new version", async () => {
    mockRunRead.mockResolvedValueOnce([{ content: "Old" }]);
    mockSupersedeMemory.mockResolvedValueOnce("new-v2-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    await client.callTool({
      name: "update_memory",
      arguments: { memory_id: "old-id", new_text: "New version with entities" },
    });

    expect(mockProcessEntityExtraction).toHaveBeenCalledWith("new-v2-id");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — get_memory_entity", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_ENT_01: returns full profile (entity, memories, connected, relationships)", async () => {
    // Entity details
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Alice", type: "PERSON", description: "Team lead", createdAt: "2026-01-01" },
    ]);
    // Memories mentioning entity
    mockRunRead.mockResolvedValueOnce([
      { id: "m1", content: "Alice leads the backend team", createdAt: "2026-01-10" },
      { id: "m2", content: "Alice reviewed the ADR", createdAt: "2026-01-05" },
    ]);
    // Connected entities (co-occurrence)
    mockRunRead.mockResolvedValueOnce([
      { id: "e2", name: "Bob", type: "PERSON", weight: 3 },
    ]);
    // Explicit relationships
    mockRunRead.mockResolvedValueOnce([
      { sourceName: "Alice", relType: "MANAGES", targetName: "Bob", targetType: "PERSON", description: null },
    ]);

    const result = await client.callTool({
      name: "get_memory_entity",
      arguments: { entity_id: "e1" },
    });

    const parsed = parseToolResult(result as any) as any;

    // Entity
    expect(parsed.entity.id).toBe("e1");
    expect(parsed.entity.name).toBe("Alice");
    expect(parsed.entity.type).toBe("PERSON");

    // Memories
    expect(parsed.memories).toHaveLength(2);
    expect(parsed.memories[0].content).toBe("Alice leads the backend team");

    // Connected entities
    expect(parsed.connectedEntities).toHaveLength(1);
    expect(parsed.connectedEntities[0].name).toBe("Bob");

    // Relationships
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0].source).toBe("Alice");
    expect(parsed.relationships[0].type).toBe("MANAGES");
    expect(parsed.relationships[0].target).toBe("Bob");
  });

  it("MCP_ENT_02: returns error when entity not found", async () => {
    mockRunRead.mockResolvedValueOnce([]); // entity not found

    const result = await client.callTool({
      name: "get_memory_entity",
      arguments: { entity_id: "nonexistent" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.error).toBe("Entity not found");
  });

  it("MCP_ENT_03: Cypher anchors to User node (namespace isolation)", async () => {
    // Return valid data so handler runs all queries
    mockRunRead
      .mockResolvedValueOnce([{ id: "e1", name: "X", type: "CONCEPT", description: null, createdAt: "2026-01-01" }])
      .mockResolvedValueOnce([]) // no memories
      .mockResolvedValueOnce([]) // no connected
      .mockResolvedValueOnce([]); // no relationships

    await client.callTool({
      name: "get_memory_entity",
      arguments: { entity_id: "e1" },
    });

    // All 4 runRead calls should include userId in the Cypher
    for (let i = 0; i < 4; i++) {
      const cypher = mockRunRead.mock.calls[i][0] as string;
      expect(cypher).toContain("userId");
    }
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — create_memory_relation", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_REL_01: creates relation between existing entities", async () => {
    // resolveEntity returns entity IDs for both entities
    mockResolveEntity
      .mockResolvedValueOnce("e1")   // source
      .mockResolvedValueOnce("e2");  // target
    // MERGE RELATED_TO
    mockRunWrite.mockResolvedValueOnce([
      { relId: "rel-1", srcName: "Alice", tgtName: "Acme Corp" },
    ]);

    const result = await client.callTool({
      name: "create_memory_relation",
      arguments: {
        source_entity: "Alice",
        relationship_type: "WORKS_AT",
        target_entity: "Acme Corp",
        description: "Full-time engineer",
      },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.relationship.source).toBe("Alice");
    expect(parsed.relationship.type).toBe("WORKS_AT");
    expect(parsed.relationship.target).toBe("Acme Corp");
    expect(parsed.relationship.description).toBe("Full-time engineer");
    expect(parsed.message).toContain("created successfully");
  });

  it("MCP_REL_02: uses resolveEntity (shared with extraction pipeline)", async () => {
    // resolveEntity is called for both entities — same function as entity extraction
    mockResolveEntity
      .mockResolvedValueOnce("new-e1")
      .mockResolvedValueOnce("new-e2");
    // MERGE RELATED_TO
    mockRunWrite.mockResolvedValueOnce([
      { relId: "rel-new", srcName: "NewPerson", tgtName: "NewCompany" },
    ]);

    const result = await client.callTool({
      name: "create_memory_relation",
      arguments: {
        source_entity: "NewPerson",
        relationship_type: "WORKS_AT",
        target_entity: "NewCompany",
      },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.relationship).toBeDefined();
    // Verify resolveEntity was called for BOTH entities with correct args
    expect(mockResolveEntity).toHaveBeenCalledTimes(2);
    expect(mockResolveEntity).toHaveBeenCalledWith(
      { name: "NewPerson", type: "CONCEPT", description: "" },
      "test-user",
    );
    expect(mockResolveEntity).toHaveBeenCalledWith(
      { name: "NewCompany", type: "CONCEPT", description: "" },
      "test-user",
    );
    // Only 1 runWrite for the MERGE RELATED_TO (not entity creation)
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
  });

  it("MCP_REL_03: passes description to resolveEntity for source entity", async () => {
    mockResolveEntity
      .mockResolvedValueOnce("e1")
      .mockResolvedValueOnce("e2");
    mockRunWrite.mockResolvedValueOnce([
      { relId: "rel-ci", srcName: "Alice", tgtName: "Bob" },
    ]);

    await client.callTool({
      name: "create_memory_relation",
      arguments: {
        source_entity: "Alice",
        relationship_type: "KNOWS",
        target_entity: "Bob",
        description: "Colleagues since 2024",
      },
    });

    // Source entity gets the description, target gets empty
    expect(mockResolveEntity).toHaveBeenCalledWith(
      { name: "Alice", type: "CONCEPT", description: "Colleagues since 2024" },
      "test-user",
    );
    expect(mockResolveEntity).toHaveBeenCalledWith(
      { name: "Bob", type: "CONCEPT", description: "" },
      "test-user",
    );
  });

  it("MCP_REL_04: normalizes relationship type to UPPER_SNAKE_CASE", async () => {
    mockResolveEntity
      .mockResolvedValueOnce("e1")
      .mockResolvedValueOnce("e2");
    mockRunWrite.mockResolvedValueOnce([
      { relId: "rel-norm", srcName: "A", tgtName: "B" },
    ]);

    await client.callTool({
      name: "create_memory_relation",
      arguments: {
        source_entity: "A",
        relationship_type: "works at",
        target_entity: "B",
      },
    });

    // Verify the relationship type was normalized in the MERGE call
    const mergeParams = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(mergeParams.relType).toBe("WORKS_AT");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — delete_memory_relation", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_DELR_01: deletes matching relationship", async () => {
    mockRunWrite.mockResolvedValueOnce([{ count: 1 }]);

    const result = await client.callTool({
      name: "delete_memory_relation",
      arguments: {
        source_entity: "Alice",
        relationship_type: "WORKS_AT",
        target_entity: "Acme Corp",
      },
    });

    const text = (result as any).content[0].text;
    expect(text).toContain("Successfully removed");
    expect(text).toContain("WORKS_AT");

    // Verify case-insensitive matching in Cypher
    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("toLower");
    expect(cypher).toContain("RELATED_TO");
    expect(cypher).toContain("DELETE");
  });

  it("MCP_DELR_02: returns 'no matching' when relation not found", async () => {
    mockRunWrite.mockResolvedValueOnce([{ count: 0 }]);

    const result = await client.callTool({
      name: "delete_memory_relation",
      arguments: {
        source_entity: "X",
        relationship_type: "UNKNOWN",
        target_entity: "Y",
      },
    });

    const text = (result as any).content[0].text;
    expect(text).toContain("No matching relationship");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — search_memory_entities", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_SEARCH_01: substring arm finds entities by name", async () => {
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Alice", type: "PERSON", description: "A colleague", memoryCount: 3 },
    ]);
    mockEmbed.mockRejectedValueOnce(new Error("No API key")); // semantic arm fails gracefully

    const result = await client.callTool({
      name: "search_memory_entities",
      arguments: { query: "Alice" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].name).toBe("Alice");

    // Verify substring search used CONTAINS
    const cypher = mockRunRead.mock.calls[0][0] as string;
    expect(cypher).toContain("CONTAINS");
  });

  it("MCP_SEARCH_02: semantic arm finds by descriptionEmbedding", async () => {
    // Substring arm returns nothing
    mockRunRead.mockResolvedValueOnce([]);
    // Semantic arm embedding
    mockEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    // Semantic arm query
    mockRunRead.mockResolvedValueOnce([
      { id: "e2", name: "Memgraph", type: "PRODUCT", description: "Graph database engine", memoryCount: 5 },
    ]);

    const result = await client.callTool({
      name: "search_memory_entities",
      arguments: { query: "graph database engine" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].name).toBe("Memgraph");

    // Verify semantic search used cosine similarity
    const semanticCypher = mockRunRead.mock.calls[1][0] as string;
    expect(semanticCypher).toContain("vector.similarity.cosine");
    expect(semanticCypher).toContain("descriptionEmbedding");
  });

  it("MCP_SEARCH_03: deduplicates across both arms", async () => {
    // Both arms return the same entity
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Alice", type: "PERSON", description: "A colleague", memoryCount: 3 },
    ]);
    mockEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Alice", type: "PERSON", description: "A colleague", memoryCount: 3 },
    ]);

    const result = await client.callTool({
      name: "search_memory_entities",
      arguments: { query: "Alice" },
    });

    const parsed = parseToolResult(result as any) as any;
    // Should only have 1 result, not 2 (dedup by id)
    expect(parsed.nodes).toHaveLength(1);
  });

  it("MCP_SEARCH_04: graceful degradation when embed() fails", async () => {
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Test", type: "CONCEPT", description: "Testing", memoryCount: 1 },
    ]);
    mockEmbed.mockRejectedValueOnce(new Error("Missing API key"));

    const result = await client.callTool({
      name: "search_memory_entities",
      arguments: { query: "Test" },
    });

    // Should still return substring results without error
    const parsed = parseToolResult(result as any) as any;
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].name).toBe("Test");
  });

  it("MCP_SEARCH_05: entity_type filter is applied", async () => {
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Alice", type: "PERSON", description: "A colleague", memoryCount: 2 },
    ]);
    mockEmbed.mockRejectedValueOnce(new Error("No key"));

    await client.callTool({
      name: "search_memory_entities",
      arguments: { query: "Alice", entity_type: "PERSON" },
    });

    // Verify type filter in Cypher
    const cypher = mockRunRead.mock.calls[0][0] as string;
    expect(cypher).toContain("e.type");
    const params = mockRunRead.mock.calls[0][1] as Record<string, unknown>;
    expect(params.entityType).toBe("PERSON");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — delete_memory_entity", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_DEL_01: returns cascade report (mentions + relations)", async () => {
    // runRead for counting edges
    mockRunRead.mockResolvedValueOnce([
      { name: "Clerk", mentionCount: 5, relationCount: 2 },
    ]);
    // runWrite for DETACH DELETE
    mockRunWrite.mockResolvedValueOnce([{}]);

    const result = await client.callTool({
      name: "delete_memory_entity",
      arguments: { entity_id: "entity-123" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.deleted).toBeDefined();
    expect(parsed.deleted.entity).toBe("Clerk");
    expect(parsed.deleted.mentionEdgesRemoved).toBe(5);
    expect(parsed.deleted.relationshipsRemoved).toBe(2);
    expect(parsed.message).toContain("5 memory mentions");
    expect(parsed.message).toContain("2 explicit relationships");
  });

  it("MCP_DEL_02: returns error when entity not found", async () => {
    mockRunRead.mockResolvedValueOnce([]); // No entity found

    const result = await client.callTool({
      name: "delete_memory_entity",
      arguments: { entity_id: "nonexistent" },
    });

    const text = (result as any).content[0].text;
    expect(text).toContain("not found");
  });

  it("MCP_DEL_03: calls DETACH DELETE with correct entity id", async () => {
    mockRunRead.mockResolvedValueOnce([
      { name: "TestEntity", mentionCount: 0, relationCount: 0 },
    ]);
    mockRunWrite.mockResolvedValueOnce([{}]);

    await client.callTool({
      name: "delete_memory_entity",
      arguments: { entity_id: "entity-123" },
    });

    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("DETACH DELETE e");
    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.entityId).toBe("entity-123");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — get_related_memories", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_RELMEM_01: returns entity, memories, and relationships", async () => {
    // Mock resolveEntity
    const mockResolveEntity = require("@/lib/entities/resolve").resolveEntity;
    mockResolveEntity.mockResolvedValueOnce("e1");

    // Mock entity details query
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "PaymentService", type: "OTHER", description: "Handles payments" },
    ]);

    // Mock memories query
    mockRunRead.mockResolvedValueOnce([
      { id: "m1", content: "PaymentService uses Stripe", createdAt: "2026-01-01" },
    ]);

    // Mock relationships query
    mockRunRead.mockResolvedValueOnce([
      { sourceName: "PaymentService", relType: "USES", targetName: "Stripe", targetType: "PRODUCT", description: null },
    ]);

    const result = await client.callTool({
      name: "get_related_memories",
      arguments: { entity_name: "PaymentService" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.entity.name).toBe("PaymentService");
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories[0].content).toBe("PaymentService uses Stripe");
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0].target).toBe("Stripe");
  });
});

// ---------------------------------------------------------------------------
describe("MCP Tool Handlers — get_memory_map", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_MAP_01: returns nodes and edges for a valid entity", async () => {
    // Center entity query
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Alice", type: "PERSON", description: "Team lead" },
    ]);
    // Neighbors (hop 1)
    mockRunRead.mockResolvedValueOnce([
      { id: "e2", name: "Bob", type: "PERSON", description: "Dev", hop: 1 },
    ]);
    // Co-occurrence edges
    mockRunRead.mockResolvedValueOnce([
      { srcName: "Alice", tgtName: "Bob", weight: 3 },
    ]);
    // RELATED_TO edges
    mockRunRead.mockResolvedValueOnce([
      { srcName: "Alice", relType: "MANAGES", tgtName: "Bob", description: "Direct report" },
    ]);

    const result = await client.callTool({
      name: "get_memory_map",
      arguments: { entity_id: "e1" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.nodes).toBeDefined();
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(2); // center + neighbor
    expect(parsed.edges).toBeDefined();
    expect(parsed.edges.length).toBe(2); // 1 co-occur + 1 RELATED_TO

    // Check edge types
    const relTypes = parsed.edges.map((e: any) => e.relationship);
    expect(relTypes).toContain("CO_OCCURS_WITH");
    expect(relTypes).toContain("MANAGES");
  });

  it("MCP_MAP_02: truncates edges to max_edges and reports truncation", async () => {
    // Center entity
    mockRunRead.mockResolvedValueOnce([
      { id: "e1", name: "Hub", type: "CONCEPT", description: "Central concept" },
    ]);
    // Many neighbors
    mockRunRead.mockResolvedValueOnce(
      Array.from({ length: 50 }, (_, i) => ({
        id: `e${i + 2}`, name: `Node${i}`, type: "CONCEPT", description: null, hop: 1,
      }))
    );
    // Many co-occurrence edges (more than max_edges=2)
    mockRunRead.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => ({
        srcName: "Hub", tgtName: `Node${i}`, weight: 10 - i,
      }))
    );
    // No RELATED_TO edges
    mockRunRead.mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "get_memory_map",
      arguments: { entity_id: "e1", max_edges: 2 },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.edges).toHaveLength(2);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalEdges).toBe(10);
    expect(parsed.returnedEdges).toBe(2);
  });

  it("MCP_MAP_03: returns error when entity not found", async () => {
    mockRunRead.mockResolvedValueOnce([]); // No center entity

    const result = await client.callTool({
      name: "get_memory_map",
      arguments: { entity_id: "nonexistent" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.error).toBe("Entity not found");
  });
});
