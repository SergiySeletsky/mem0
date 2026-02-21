/**
 * UNIT TESTS -- Spec 02: Text Search Wrapper
 *
 * Tests for lib/search/text.ts (Memgraph text_search.search wrapper).
 * These FAIL before Spec 02 (module does not exist) and PASS after.
 *
 *   TEXT_01 -- textSearch calls text_search.search with the provided query
 *   TEXT_02 -- textSearch is user-scoped (WHERE u.userId = $userId)
 *   TEXT_03 -- textSearch returns 1-based rank values
 *   TEXT_04 -- textSearch filters by invalidAt IS NULL (current memories only)
 */

// Make this a TypeScript module (avoids TS2451)
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

function makeRecord(data: Record<string, any>) {
  return {
    keys: Object.keys(data),
    get: (k: string) => data[k],
    toObject: () => data,
  };
}

function allCypher(): string {
  return mockSession.run.mock.calls.map((c: any[]) => c[0] as string).join("\n");
}

// ---------------------------------------------------------------------------
describe("SPEC 02: Text Search Wrapper", () => {
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
  });

  // -------------------------------------------------------------------------
  test("TEXT_01: textSearch invokes text_search.search with the query string", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "m1" }), makeRecord({ id: "m2" })],
      summary: {},
    });

    const { textSearch } = require("@/lib/search/text");
    await textSearch("IBAN number", "alice");

    const cypher = allCypher();
    expect(cypher).toContain("text_search.search");
    expect(cypher).toContain("memory_text");
  });

  // -------------------------------------------------------------------------
  test("TEXT_02: textSearch is user-scoped", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { textSearch } = require("@/lib/search/text");
    await textSearch("test", "alice");

    const cypher = allCypher();
    expect(cypher).toContain("userId");
  });

  // -------------------------------------------------------------------------
  test("TEXT_03: textSearch assigns 1-based rank by result position", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "first" }), makeRecord({ id: "second" })],
      summary: {},
    });

    const { textSearch } = require("@/lib/search/text");
    const results = await textSearch("test", "alice");

    expect(results[0].rank).toBe(1);
    expect(results[1].rank).toBe(2);
  });

  // -------------------------------------------------------------------------
  test("TEXT_04: textSearch Cypher filters by invalidAt IS NULL", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { textSearch } = require("@/lib/search/text");
    await textSearch("test", "alice");

    const cypher = allCypher();
    expect(cypher).toContain("invalidAt IS NULL");
  });
});
