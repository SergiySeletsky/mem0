/**
 * Unit tests — MCP tool handlers (full coverage, all 10 tools)
 *
 * Tests all 10 MCP tools by mocking the DB layer (runRead/runWrite),
 * embedding layer (embed), and pipeline modules (addMemory, hybridSearch, etc),
 * then invoking handlers via the MCP SDK in-process client-server pair
 * (InMemoryTransport).
 *
 * Coverage:
 *   add_memories:
 *     MCP_ADD_01:    single-string backward compat — ADD path returns {id, memory, event: "ADD"}
 *     MCP_ADD_02:    single-string dedup skip returns event: "SKIP_DUPLICATE"
 *     MCP_ADD_03:    single-string dedup supersede returns event: "SUPERSEDE"
 *     MCP_ADD_04:    fires entity extraction asynchronously
 *     MCP_ADD_05:    array of strings: all items processed, returns one result per item
 *     MCP_ADD_06:    array: per-item error isolation — failed item returns event "ERROR", others succeed
 *     MCP_ADD_07:    empty array returns { results: [] } immediately
 *     MCP_ADD_08:    array with mixed dedup outcomes (ADD + SKIP + SUPERSEDE)
 *
 *   search_memory (search mode):
 *     MCP_SM_01:     returns hybrid search results with score, text_rank, vector_rank
 *     MCP_SM_02:     category filter removes non-matching results
 *     MCP_SM_03:     created_after filter removes older results
 *     MCP_SM_04:     logs access via runWrite (non-blocking)
 *
 *   search_memory (browse mode — no query):
 *     MCP_SM_BROWSE_01:  no query returns paginated shape { total, offset, limit, results }
 *     MCP_SM_BROWSE_02:  offset parameter is forwarded to SKIP clause
 *     MCP_SM_BROWSE_03:  clamps limit to max 200
 *     MCP_SM_BROWSE_04:  results include categories per memory
 *     MCP_SM_BROWSE_05:  category filter applied in browse mode
 *     MCP_SM_BROWSE_06:  empty string query also triggers browse mode
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
describe("MCP Tool Handlers — add_memories", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_ADD_01: single string backward compat — ADD returns {id, memory, event: 'ADD'}", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({ action: "add" } as any);
    mockAddMemory.mockResolvedValueOnce("new-mem-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: "Alice prefers TypeScript" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("new-mem-id");
    expect(parsed.results[0].memory).toBe("Alice prefers TypeScript");
    expect(parsed.results[0].event).toBe("ADD");
    expect(mockAddMemory).toHaveBeenCalledTimes(1);
  });

  it("MCP_ADD_02: single string dedup skip returns event: 'SKIP_DUPLICATE'", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({
      action: "skip",
      existingId: "existing-id",
    } as any);

    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: "Duplicate content" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results[0].event).toBe("SKIP_DUPLICATE");
    expect(parsed.results[0].id).toBe("existing-id");
    expect(mockAddMemory).not.toHaveBeenCalled();
  });

  it("MCP_ADD_03: single string dedup supersede returns event: 'SUPERSEDE'", async () => {
    mockCheckDeduplication.mockResolvedValueOnce({
      action: "supersede",
      existingId: "old-id",
    } as any);
    mockSupersedeMemory.mockResolvedValueOnce("superseded-id");
    mockProcessEntityExtraction.mockResolvedValueOnce(undefined);

    const result = await client.callTool({
      name: "add_memories",
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
      name: "add_memories",
      arguments: { content: "Entity test" },
    });

    // processEntityExtraction called with the new memory id
    expect(mockProcessEntityExtraction).toHaveBeenCalledWith("ext-mem-id");
  });

  it("MCP_ADD_05: array of strings processes all items, returns one result each", async () => {
    mockCheckDeduplication
      .mockResolvedValueOnce({ action: "add" } as any)
      .mockResolvedValueOnce({ action: "add" } as any)
      .mockResolvedValueOnce({ action: "add" } as any);
    mockAddMemory
      .mockResolvedValueOnce("id-1")
      .mockResolvedValueOnce("id-2")
      .mockResolvedValueOnce("id-3");
    mockProcessEntityExtraction.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: ["Fact one", "Fact two", "Fact three"] },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results.map((r: any) => r.id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(parsed.results.every((r: any) => r.event === "ADD")).toBe(true);
    expect(mockAddMemory).toHaveBeenCalledTimes(3);
    expect(mockProcessEntityExtraction).toHaveBeenCalledTimes(3);
  });

  it("MCP_ADD_06: per-item error isolation — failed item has event 'ERROR', others succeed", async () => {
    mockCheckDeduplication
      .mockResolvedValueOnce({ action: "add" } as any)
      .mockRejectedValueOnce(new Error("DB timeout"))
      .mockResolvedValueOnce({ action: "add" } as any);
    mockAddMemory
      .mockResolvedValueOnce("ok-id-1")
      .mockResolvedValueOnce("ok-id-3");
    mockProcessEntityExtraction.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: ["Good fact", "Bad fact", "Another good fact"] },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0].event).toBe("ADD");
    expect(parsed.results[1].event).toBe("ERROR");
    expect(parsed.results[1].error).toBe("DB timeout");
    expect(parsed.results[2].event).toBe("ADD");
  });

  it("MCP_ADD_07: empty array returns { results: [] } immediately", async () => {
    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: [] },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toEqual([]);
    expect(mockCheckDeduplication).not.toHaveBeenCalled();
    expect(mockAddMemory).not.toHaveBeenCalled();
  });

  it("MCP_ADD_08: array with mixed ADD + SKIP + SUPERSEDE outcomes", async () => {
    mockCheckDeduplication
      .mockResolvedValueOnce({ action: "add" } as any)
      .mockResolvedValueOnce({ action: "skip", existingId: "dup-id" } as any)
      .mockResolvedValueOnce({ action: "supersede", existingId: "old-id" } as any);
    mockAddMemory.mockResolvedValueOnce("new-id");
    mockSupersedeMemory.mockResolvedValueOnce("supersede-id");
    mockProcessEntityExtraction.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: ["new fact", "duplicate fact", "updated fact"] },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results[0].event).toBe("ADD");
    expect(parsed.results[0].id).toBe("new-id");
    expect(parsed.results[1].event).toBe("SKIP_DUPLICATE");
    expect(parsed.results[1].id).toBe("dup-id");
    expect(parsed.results[2].event).toBe("SUPERSEDE");
    expect(parsed.results[2].id).toBe("supersede-id");
    // entity extraction only for ADD and SUPERSEDE items
    expect(mockProcessEntityExtraction).toHaveBeenCalledTimes(2);
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
describe("MCP Tool Handlers — search_memory (browse mode)", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MCP_SM_BROWSE_01: no query returns paginated shape { total, offset, limit, results }", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 3 }])
      .mockResolvedValueOnce([
        { id: "m1", content: "Memory one", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: ["work"] },
        { id: "m2", content: "Memory two", createdAt: "2026-01-02", updatedAt: "2026-01-02", categories: [] },
      ]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: {},  // no query → browse mode
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed).toHaveProperty("total", 3);
    expect(parsed).toHaveProperty("offset", 0);
    expect(parsed).toHaveProperty("limit", 50);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toHaveProperty("id", "m1");
    expect(parsed.results[0]).toHaveProperty("memory", "Memory one");
    expect(parsed.results[0]).toHaveProperty("created_at");
    expect(parsed.results[0]).toHaveProperty("updated_at");
    // browse mode must NOT call hybridSearch
    expect(mockHybridSearch).not.toHaveBeenCalled();
  });

  it("MCP_SM_BROWSE_02: offset parameter forwarded to SKIP clause", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 10 }])
      .mockResolvedValueOnce([
        { id: "m6", content: "Memory six", createdAt: "2026-01-06", updatedAt: "2026-01-06", categories: [] },
      ]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { offset: 5, limit: 1 },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.offset).toBe(5);
    expect(parsed.limit).toBe(1);

    const paginationCypher = mockRunRead.mock.calls[1][0] as string;
    expect(paginationCypher).toContain("SKIP");
    expect(paginationCypher).toContain("LIMIT");
  });

  it("MCP_SM_BROWSE_03: clamps limit to max 200", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { limit: 9999 },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.limit).toBe(200);
  });

  it("MCP_SM_BROWSE_04: results include categories per memory", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        { id: "m1", content: "Test", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: ["architecture", "decisions"] },
      ]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: {},
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results[0].categories).toEqual(["architecture", "decisions"]);

    const cypher = mockRunRead.mock.calls[1][0] as string;
    expect(cypher).toContain("HAS_CATEGORY");
    expect(cypher).toContain("Category");
  });

  it("MCP_SM_BROWSE_05: category filter applied in browse mode", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        { id: "m1", content: "Test", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: ["security"] },
      ]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { category: "security" },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(1);

    const countCypher = mockRunRead.mock.calls[0][0] as string;
    expect(countCypher).toContain("toLower(cFilter.name) = toLower($category)");
    const listCypher = mockRunRead.mock.calls[1][0] as string;
    expect(listCypher).toContain("toLower(cFilter.name) = toLower($category)");
  });

  it("MCP_SM_BROWSE_06: empty string query also triggers browse mode", async () => {
    mockRunRead
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([
        { id: "m1", content: "A", createdAt: "2026-01-01", updatedAt: "2026-01-01", categories: [] },
        { id: "m2", content: "B", createdAt: "2026-01-02", updatedAt: "2026-01-02", categories: [] },
      ]);

    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "   " },  // whitespace-only → browse mode
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed).toHaveProperty("total");
    expect(parsed.results).toHaveLength(2);
    expect(mockHybridSearch).not.toHaveBeenCalled();
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
      arguments: { memory_id: "old-mem-id", text: "Updated fact about Alice" },
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
      arguments: { memory_id: "nonexistent", text: "Doesn't matter" },
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
      arguments: { memory_id: "old-id", text: "New version with entities" },
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

// ---------------------------------------------------------------------------
// Extraction drain (Tantivy concurrency prevention)
// ---------------------------------------------------------------------------
describe("MCP add_memories — extraction drain (Tantivy concurrency prevention)", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await setupClientServer());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunRead.mockResolvedValue([]);
    mockRunWrite.mockResolvedValue([]);
  });

  it("MCP_ADD_DRAIN: entity extraction from item N completes before item N+1's addMemory starts", async () => {
    const execOrder: string[] = [];

    // Item 1 extraction takes 50ms — should be awaited (drain) before item 2 addMemory
    mockCheckDeduplication.mockResolvedValue({ action: "add" } as any);
    mockAddMemory
      .mockImplementationOnce(async () => {
        execOrder.push("addMemory-1");
        return "id-1";
      })
      .mockImplementationOnce(async () => {
        execOrder.push("addMemory-2");
        return "id-2";
      });

    let extraction1Resolved = false;
    mockProcessEntityExtraction
      .mockImplementationOnce(async () => {
        execOrder.push("extraction-1-start");
        await new Promise<void>((r) => setTimeout(r, 50));
        extraction1Resolved = true;
        execOrder.push("extraction-1-done");
      })
      .mockImplementationOnce(async () => {
        execOrder.push("extraction-2-start");
      });

    const result = await client.callTool({
      name: "add_memories",
      arguments: { content: ["memory one", "memory two"] },
    });

    const parsed = parseToolResult(result as any) as any;
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].id).toBe("id-1");
    expect(parsed.results[1].id).toBe("id-2");

    // extraction-1-done must appear before addMemory-2 in the execution order
    const ext1DoneIdx = execOrder.indexOf("extraction-1-done");
    const addMem2Idx = execOrder.indexOf("addMemory-2");
    if (ext1DoneIdx !== -1 && addMem2Idx !== -1) {
      expect(ext1DoneIdx).toBeLessThan(addMem2Idx);
    }
    // extraction-1 must have resolved
    expect(extraction1Resolved).toBe(true);
  });

  it("MCP_ADD_DRAIN_TIMEOUT: if extraction hangs >3 s batch continues (does not deadlock)", async () => {
    jest.useFakeTimers({ advanceTimers: false });

    mockCheckDeduplication.mockResolvedValue({ action: "add" } as any);
    mockAddMemory
      .mockResolvedValueOnce("id-1")
      .mockResolvedValueOnce("id-2");

    // Item 1 extraction never resolves (simulates a hung Tantivy writer)
    let hangResolved = false;
    mockProcessEntityExtraction
      .mockImplementationOnce(
        () => new Promise<void>((r) => {
          // resolve after 10 s (beyond the 3 s drain timeout)
          setTimeout(() => { hangResolved = true; r(); }, 10_000);
        })
      )
      .mockResolvedValueOnce(undefined);

    const callPromise = client.callTool({
      name: "add_memories",
      arguments: { content: ["memory one", "memory two"] },
    });

    // Advance fake timers by 3.1 s to trigger the drain timeout
    await jest.advanceTimersByTimeAsync(3_100);

    const result = await callPromise;
    const parsed = parseToolResult(result as any) as any;

    // Both items must have been processed (batch didn't hang)
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].id).toBe("id-1");
    expect(parsed.results[1].id).toBe("id-2");
    // The extraction was NOT yet resolved (we only advanced 3.1 s, timeout is 10 s)
    expect(hangResolved).toBe(false);

    jest.useRealTimers();
  });
});
