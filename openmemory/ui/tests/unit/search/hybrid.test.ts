/**
 * UNIT TESTS -- Spec 02: Hybrid Search Orchestrator
 *
 * Tests for lib/search/hybrid.ts.
 * These FAIL before Spec 02 (modules do not exist) and PASS after.
 *
 *   HYBRID_01 -- mode=hybrid calls both text and vector arms
 *   HYBRID_02 -- mode=text calls only text arm (vector is skipped)
 *   HYBRID_03 -- mode=vector calls only vector arm (text is skipped)
 *   HYBRID_04 -- results are hydrated with content from Memgraph
 *   HYBRID_05 -- results are ordered by RRF score (best match first)
 */

// Make this a TypeScript module (avoids TS2451)
export {};

// ---------------------------------------------------------------------------
// Neo4j mock (needed for the hydration Cypher call in hybrid.ts)
// ---------------------------------------------------------------------------
const mockSession = {
  run: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockDriver = {
  session: jest.fn().mockReturnValue(mockSession),
  close: jest.fn().mockResolvedValue(undefined),
  verifyConnectivity: jest.fn().mockResolvedValue(undefined),
};
jest.mock("neo4j-driver", () => ({
  __esModule: true,
  default: {
    driver: jest.fn().mockReturnValue(mockDriver),
    auth: { basic: jest.fn().mockReturnValue({ scheme: "basic" }) },
    integer: { toNumber: (n: any) => (typeof n === "object" ? n.low ?? n : n) },
    types: { Node: class {}, Relationship: class {} },
  },
}));

// ---------------------------------------------------------------------------
// Mock the search sub-modules so tests don't touch the DB or OpenAI
// ---------------------------------------------------------------------------
const mockTextSearch = jest.fn().mockResolvedValue([
  { id: "text-match", rank: 1 },
]);
const mockVectorSearch = jest.fn().mockResolvedValue([
  { id: "vector-match", rank: 1, score: 0.92 },
]);

jest.mock("@/lib/search/text", () => ({ textSearch: mockTextSearch }));
jest.mock("@/lib/search/vector", () => ({ vectorSearch: mockVectorSearch }));

// ---------------------------------------------------------------------------
function makeRecord(data: Record<string, any>) {
  return {
    keys: Object.keys(data),
    get: (k: string) => data[k],
    toObject: () => data,
  };
}

// ---------------------------------------------------------------------------
describe("SPEC 02: Hybrid Search Orchestrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.mock("neo4j-driver", () => ({
      __esModule: true,
      default: {
        driver: jest.fn().mockReturnValue(mockDriver),
        auth: { basic: jest.fn().mockReturnValue({ scheme: "basic" }) },
        integer: { toNumber: (n: any) => (typeof n === "object" ? n.low ?? n : n) },
        types: { Node: class {}, Relationship: class {} },
      },
    }));
    jest.mock("@/lib/search/text", () => ({
      textSearch: mockTextSearch,
    }));
    jest.mock("@/lib/search/vector", () => ({
      vectorSearch: mockVectorSearch,
    }));
    // Reset search mock return values after resetModules
    mockTextSearch.mockResolvedValue([{ id: "text-match", rank: 1 }]);
    mockVectorSearch.mockResolvedValue([{ id: "vector-match", rank: 1, score: 0.92 }]);
  });

  // -------------------------------------------------------------------------
  test("HYBRID_01: mode=hybrid calls both text and vector arms", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { hybridSearch } = require("@/lib/search/hybrid");
    await hybridSearch("python developer", { userId: "alice", topK: 5, mode: "hybrid" });

    expect(mockTextSearch).toHaveBeenCalledWith("python developer", "alice", expect.any(Number));
    expect(mockVectorSearch).toHaveBeenCalledWith("python developer", "alice", expect.any(Number));
  });

  // -------------------------------------------------------------------------
  test("HYBRID_02: mode=text skips vector search entirely", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { hybridSearch } = require("@/lib/search/hybrid");
    await hybridSearch("python developer", { userId: "alice", topK: 5, mode: "text" });

    expect(mockTextSearch).toHaveBeenCalled();
    expect(mockVectorSearch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  test("HYBRID_03: mode=vector skips text search entirely", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { hybridSearch } = require("@/lib/search/hybrid");
    await hybridSearch("python developer", { userId: "alice", topK: 5, mode: "vector" });

    expect(mockTextSearch).not.toHaveBeenCalled();
    expect(mockVectorSearch).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  test("HYBRID_04: results are hydrated with content, categories, and appName", async () => {
    // text and vector both return same "m1"
    mockTextSearch.mockResolvedValue([{ id: "m1", rank: 1 }]);
    mockVectorSearch.mockResolvedValue([{ id: "m1", rank: 1, score: 0.85 }]);

    // Hydration Cypher returns content for "m1"
    mockSession.run.mockResolvedValueOnce({
      records: [
        makeRecord({
          id: "m1",
          content: "I am a Python developer",
          createdAt: "2024-01-01T00:00:00Z",
          appName: "test-app",
          categories: ["career"],
        }),
      ],
      summary: {},
    });

    const { hybridSearch } = require("@/lib/search/hybrid");
    const results = await hybridSearch("python developer", {
      userId: "alice",
      topK: 5,
      mode: "hybrid",
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("m1");
    expect(results[0].content).toBe("I am a Python developer");
    expect(results[0].categories).toContain("career");
  });

  // -------------------------------------------------------------------------
  test("HYBRID_05: document in both lists has higher rrfScore than single-list documents", async () => {
    // "shared" appears in both, "text-only" and "vector-only" in one each
    mockTextSearch.mockResolvedValue([
      { id: "shared", rank: 1 },
      { id: "text-only", rank: 2 },
    ]);
    mockVectorSearch.mockResolvedValue([
      { id: "shared", rank: 1 },
      { id: "vector-only", rank: 2, score: 0.8 },
    ]);

    // Hydration returns all three
    mockSession.run.mockResolvedValueOnce({
      records: [
        makeRecord({ id: "shared", content: "shared memory", createdAt: "", appName: null, categories: [] }),
        makeRecord({ id: "text-only", content: "text only", createdAt: "", appName: null, categories: [] }),
        makeRecord({ id: "vector-only", content: "vector only", createdAt: "", appName: null, categories: [] }),
      ],
      summary: {},
    });

    const { hybridSearch } = require("@/lib/search/hybrid");
    const results = await hybridSearch("test", { userId: "alice", topK: 5, mode: "hybrid" });

    // "shared" (present in both lists) must be ranked first
    expect(results[0].id).toBe("shared");
    expect(results[0].rrfScore).toBeGreaterThan(results[1].rrfScore);
  });
});
