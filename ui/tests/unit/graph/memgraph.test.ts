export {};
/**
 * Unit tests — MemgraphGraphStore (lib/graph/memgraph.ts)
 *
 * All database calls are mocked via jest.mock("@/lib/db/memgraph").
 * Tests verify correct Cypher queries, parameter passing, and result mapping.
 *
 * MGRAPH_01: initialize() is no-op (entity_vectors managed by initSchema)
 * MGRAPH_02: searchNodes() passes embedding + userId, returns mapped GraphNode[]
 * MGRAPH_03: searchNodes() filters by threshold (no results below)
 * MGRAPH_04: getNode() returns single node or null
 * MGRAPH_05: deleteNode() calls DETACH DELETE with userId scope
 * MGRAPH_06: searchEdges() returns deduplicated RelationTriple[]
 * MGRAPH_07: upsertRelationship() creates User + entities + edge
 * MGRAPH_08: deleteRelationship() calls DELETE on matching edge
 * MGRAPH_09: getAll() returns triples filtered by internal rel types
 * MGRAPH_10: deleteAll() calls DETACH DELETE for all user entities
 * MGRAPH_11: getGraphStore() returns singleton instance
 * MGRAPH_12: getNeighborhood() calls traversal query
 * MGRAPH_13: getSubgraph() calls subgraph query
 */
jest.mock("@/lib/db/memgraph", () => ({
  runRead: jest.fn(),
  runWrite: jest.fn(),
}));

import { runRead, runWrite } from "@/lib/db/memgraph";
import { MemgraphGraphStore, getGraphStore } from "@/lib/graph/memgraph";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;

let store: MemgraphGraphStore;

beforeEach(() => {
  jest.clearAllMocks();
  store = new MemgraphGraphStore();
});

const USER_ID = "user_test_123";

describe("MemgraphGraphStore", () => {
  // ── Initialize ──────────────────────────────────────────────────────

  it("MGRAPH_01: initialize() resolves without DB calls (no-op)", async () => {
    await store.initialize();
    expect(mockRunRead).not.toHaveBeenCalled();
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  // ── Node CRUD ───────────────────────────────────────────────────────

  it("MGRAPH_02: searchNodes() passes correct params and maps results", async () => {
    mockRunRead.mockResolvedValueOnce([
      { id: "n1", name: "Alice", type: "PERSON", description: "A person", similarity: 0.9 },
      { id: "n2", name: "Bob", type: null, description: null, similarity: 0.7 },
    ]);

    const embedding = [0.1, 0.2, 0.3];
    const nodes = await store.searchNodes(embedding, USER_ID, 5, 0.5);

    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const [query, params] = mockRunRead.mock.calls[0];
    expect(query).toContain("vector_search.search");
    expect(query).toContain("entity_vectors");
    expect(params).toMatchObject({ queryEmbedding: embedding, userId: USER_ID });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual({
      id: "n1",
      name: "Alice",
      type: "PERSON",
      properties: { description: "A person" },
      score: 0.9,
    });
    expect(nodes[1]).toEqual({
      id: "n2",
      name: "Bob",
      type: undefined,
      properties: { description: "" },
      score: 0.7,
    });
  });

  it("MGRAPH_03: searchNodes() returns empty when no results above threshold", async () => {
    mockRunRead.mockResolvedValueOnce([]);

    const nodes = await store.searchNodes([0.1], USER_ID, 10, 0.9);
    expect(nodes).toEqual([]);
  });

  it("MGRAPH_04: getNode() returns node or null", async () => {
    mockRunRead.mockResolvedValueOnce([
      { id: "n1", name: "Alice", type: "PERSON", description: "desc", embedding: [0.1] },
    ]);

    const node = await store.getNode("n1", USER_ID);
    expect(node).not.toBeNull();
    expect(node!.id).toBe("n1");
    expect(node!.name).toBe("Alice");
    expect(node!.embedding).toEqual([0.1]);

    // No result case
    mockRunRead.mockResolvedValueOnce([]);
    const noNode = await store.getNode("missing", USER_ID);
    expect(noNode).toBeNull();
  });

  it("MGRAPH_05: deleteNode() calls DETACH DELETE with userId scope", async () => {
    mockRunWrite.mockResolvedValueOnce([]);

    await store.deleteNode("n1", USER_ID);

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [query, params] = mockRunWrite.mock.calls[0];
    expect(query).toContain("DETACH DELETE e");
    expect(query).toContain("HAS_ENTITY");
    expect(params).toMatchObject({ nodeId: "n1", userId: USER_ID });
  });

  // ── Edge / Relationship CRUD ────────────────────────────────────────

  it("MGRAPH_06: searchEdges() returns deduplicated triples", async () => {
    // searchEdges uses UNION, may return duplicates
    mockRunRead.mockResolvedValueOnce([
      { source: "Alice", relationship: "KNOWS", target: "Bob", similarity: 0.9 },
      { source: "Alice", relationship: "KNOWS", target: "Bob", similarity: 0.8 },
      { source: "Bob", relationship: "WORKS_AT", target: "Acme", similarity: 0.75 },
    ]);

    const triples = await store.searchEdges([0.1], USER_ID, 10, 0.5);

    // Should deduplicate the KNOWS triple
    expect(triples).toHaveLength(2);
    expect(triples[0]).toEqual({
      source: "Alice",
      relationship: "KNOWS",
      target: "Bob",
      score: 0.9,
    });
    expect(triples[1]).toEqual({
      source: "Bob",
      relationship: "WORKS_AT",
      target: "Acme",
      score: 0.75,
    });
  });

  it("MGRAPH_07: upsertRelationship() creates user + entities + edge", async () => {
    // Mock: MERGE user, MERGE source entity, MERGE target entity, MERGE edge
    mockRunWrite.mockResolvedValueOnce([]); // MERGE user
    mockRunWrite.mockResolvedValueOnce([{ srcId: "src-uuid" }]); // MERGE source
    mockRunWrite.mockResolvedValueOnce([{ tgtId: "tgt-uuid" }]); // MERGE target
    mockRunWrite.mockResolvedValueOnce([]); // MERGE relationship

    const edge = await store.upsertRelationship(
      {
        sourceName: "Alice",
        sourceType: "PERSON",
        targetName: "Acme Corp",
        targetType: "ORGANIZATION",
        relationship: "works_at",
      },
      { source: [0.1, 0.2], target: [0.3, 0.4] },
      USER_ID,
    );

    expect(mockRunWrite).toHaveBeenCalledTimes(4);
    expect(edge.sourceName).toBe("alice");
    expect(edge.targetName).toBe("acme_corp");
    expect(edge.relationship).toBe("WORKS_AT");

    // Verify the relationship MERGE uses dynamic type
    const relQuery = mockRunWrite.mock.calls[3][0];
    expect(relQuery).toContain("WORKS_AT");
  });

  it("MGRAPH_08: deleteRelationship() calls DELETE with normalized names", async () => {
    mockRunWrite.mockResolvedValueOnce([]);

    await store.deleteRelationship("Alice", "KNOWS", "Bob", USER_ID);

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [query, params] = mockRunWrite.mock.calls[0];
    expect(query).toContain("DELETE r");
    expect(query).toContain("KNOWS");
    expect(params).toMatchObject({ userId: USER_ID });
  });

  // ── Bulk ────────────────────────────────────────────────────────────

  it("MGRAPH_09: getAll() returns triples for a user", async () => {
    mockRunRead.mockResolvedValueOnce([
      { source: "alice", relationship: "KNOWS", target: "bob" },
      { source: "alice", relationship: "WORKS_AT", target: "acme" },
    ]);

    const triples = await store.getAll(USER_ID, 100);

    expect(triples).toHaveLength(2);
    expect(triples[0]).toEqual({ source: "alice", relationship: "KNOWS", target: "bob" });

    // Verify the query excludes internal relationship types
    const [query] = mockRunRead.mock.calls[0];
    expect(query).toContain("NOT type(r) IN");
    expect(query).toContain("HAS_ENTITY");
    expect(query).toContain("HAS_MEMORY");
  });

  it("MGRAPH_10: deleteAll() calls DETACH DELETE for all user entities", async () => {
    mockRunWrite.mockResolvedValueOnce([]);

    await store.deleteAll(USER_ID);

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [query, params] = mockRunWrite.mock.calls[0];
    expect(query).toContain("DETACH DELETE e");
    expect(params).toMatchObject({ userId: USER_ID });
  });

  // ── Traversal ───────────────────────────────────────────────────────

  it("MGRAPH_12: getNeighborhood() returns subgraph", async () => {
    mockRunRead.mockResolvedValueOnce([
      {
        neighborNodes: [
          { id: "n2", name: "Bob", type: "PERSON", description: "neighbor" },
        ],
        edgeList: [
          {
            id: "e1",
            srcId: "n1",
            srcName: "Alice",
            relType: "KNOWS",
            tgtId: "n2",
            tgtName: "Bob",
            properties: "{}",
          },
        ],
      },
    ]);

    const sg = await store.getNeighborhood("n1", USER_ID);

    expect(sg.nodes).toHaveLength(1);
    expect(sg.nodes[0].name).toBe("Bob");
    expect(sg.edges).toHaveLength(1);
    expect(sg.edges[0].relationship).toBe("KNOWS");
  });

  it("MGRAPH_12b: getNeighborhood() returns empty on no results", async () => {
    mockRunRead.mockResolvedValueOnce([]);

    const sg = await store.getNeighborhood("missing", USER_ID);
    expect(sg).toEqual({ nodes: [], edges: [] });
  });

  it("MGRAPH_13: getSubgraph() returns subgraph", async () => {
    mockRunRead.mockResolvedValueOnce([
      {
        subNodes: [
          { id: "n1", name: "Alice", type: "PERSON", description: "" },
          { id: "n2", name: "Bob", type: "PERSON", description: "" },
        ],
        subEdges: [
          {
            id: "e1",
            srcId: "n1",
            srcName: "Alice",
            relType: "KNOWS",
            tgtId: "n2",
            tgtName: "Bob",
            properties: "{}",
          },
        ],
      },
    ]);

    const sg = await store.getSubgraph("n1", USER_ID);

    expect(sg.nodes).toHaveLength(2);
    expect(sg.edges).toHaveLength(1);
    expect(sg.edges[0].properties).toEqual({});
  });

  it("MGRAPH_13b: getSubgraph() returns empty on no results", async () => {
    mockRunRead.mockResolvedValueOnce([]);

    const sg = await store.getSubgraph("missing", USER_ID);
    expect(sg).toEqual({ nodes: [], edges: [] });
  });

  // ── Singleton ───────────────────────────────────────────────────────

  it("MGRAPH_11: getGraphStore() returns singleton", () => {
    const a = getGraphStore();
    const b = getGraphStore();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(MemgraphGraphStore);
  });
});
