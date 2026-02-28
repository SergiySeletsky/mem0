/**
 * BASELINE TESTS -- Spec 02 pre-hybrid-search
 *
 * Documents the current search behaviour BEFORE and AFTER implementing
 * hybrid search.
 *
 *   SEARCH_ISSUE_01          -- searchMemories() uses vector-only (no text_search)
 *                              (deliberately kept as-is; hybrid is in hybridSearch())
 *   SEARCH_ISSUE_02 [RESOLVED] -- lib/search/rrf module now exists
 */

// Make this a TypeScript module (avoids TS2451 duplicate declarations)
export {};

// ---------------------------------------------------------------------------
// Neo4j mock
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

// Embed mock
jest.mock("@/lib/embeddings/openai", () => ({
  embed: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
}));

function allCypher(): string {
  return mockSession.run.mock.calls.map((c: any[]) => c[0] as string).join("\n");
}

// ---------------------------------------------------------------------------
describe("BASELINE: Hybrid Search (pre-Spec 02)", () => {
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
    jest.mock("@/lib/embeddings/openai", () => ({
      embed: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    }));
  });

  // -------------------------------------------------------------------------
  test("SEARCH_ISSUE_01: searchMemories() uses vector_search only (no text_search)", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { searchMemories } = require("@/lib/memory/search");
    await searchMemories("python developer", "alice").catch(() => {});

    const cypher = allCypher();
    // ISSUE: only vector search, no full-text arm
    expect(cypher).toContain("vector_search");
    expect(cypher).not.toContain("text_search.search");
  });

  // -------------------------------------------------------------------------
  test("SEARCH_ISSUE_02 [RESOLVED Spec 02]: lib/search/rrf module now exists and exports reciprocalRankFusion", () => {
    // Original issue: RRF module did not exist
    // Status: RESOLVED -- lib/search/rrf.ts created in Spec 02
    const { reciprocalRankFusion } = require("@/lib/search/rrf");
    expect(typeof reciprocalRankFusion).toBe("function");
  });
});
