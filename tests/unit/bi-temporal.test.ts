/**
 * UNIT TESTS -- Spec 01: Bi-Temporal Memory Model
 *
 * These define the contract for bi-temporal behaviour.
 * They FAIL before Spec 01 is implemented and PASS after.
 *
 * Covered:
 *   BT_01 -- addMemory sets validAt and invalidAt: null on every new Memory node
 *   BT_02 -- supersedeMemory invalidates old node (sets invalidAt) and creates new
 *   BT_03 -- supersedeMemory creates a [:SUPERSEDES] relationship
 *   BT_04 -- deleteMemory sets invalidAt (in addition to state = 'deleted')
 *   BT_05 -- initSchema creates indexes on :Memory(validAt) and :Memory(invalidAt)
 *   BT_06 -- listMemories default query filters by invalidAt IS NULL
 *   BT_07 -- listMemories with includeSuperseeded=true omits invalidAt IS NULL
 *   BT_08 -- listMemories with asOf uses point-in-time filter
 */

// Make this a TypeScript module to scope declarations (avoids TS2451)
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
    auth: {
      basic: jest
        .fn()
        .mockReturnValue({ scheme: "basic", principal: "neo4j", credentials: "" }),
    },
    integer: { toNumber: (n: any) => (typeof n === "object" ? n.low ?? n : n) },
    types: { Node: class {}, Relationship: class {} },
  },
}));

// ---------------------------------------------------------------------------
// Embed mock
// ---------------------------------------------------------------------------
jest.mock("@/lib/embeddings/intelli", () => ({
  embed: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRecord(data: Record<string, any>) {
  return {
    keys: Object.keys(data),
    get: (k: string) => data[k],
    toObject: () => data,
  };
}

/** All Cypher strings sent to session.run after the last clearAllMocks(). */
function allCypher(): string {
  return mockSession.run.mock.calls.map((c: any[]) => c[0] as string).join("\n");
}

/** All params objects sent to session.run. */
function allParams(): Record<string, unknown>[] {
  return mockSession.run.mock.calls.map((c: any[]) => c[1] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SPEC 01: Bi-Temporal Memory Model", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    jest.mock("neo4j-driver", () => ({
      __esModule: true,
      default: {
        driver: jest.fn().mockReturnValue(mockDriver),
        auth: {
          basic: jest
            .fn()
            .mockReturnValue({ scheme: "basic", principal: "neo4j", credentials: "" }),
        },
        integer: { toNumber: (n: any) => (typeof n === "object" ? n.low ?? n : n) },
        types: { Node: class {}, Relationship: class {} },
      },
    }));
    jest.mock("@/lib/embeddings/intelli", () => ({
      embed: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    }));
  });

  // -------------------------------------------------------------------------
  test("BT_01: addMemory includes validAt in the Memory CREATE (invalidAt absent = null)", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { addMemory } = require("@/lib/memory/write");
    await addMemory("I live in NYC", { userId: "alice", appName: "test-app" });

    const cypher = allCypher();
    // After Spec 01: validAt must appear in the CREATE statement
    expect(cypher).toContain("validAt");

    // invalidAt must NOT be set as a null literal â€” Memgraph forbids null property literals
    // in CREATE/MERGE. An absent property IS semantically null; WHERE m.invalidAt IS NULL
    // correctly selects live nodes.
    expect(cypher).not.toContain("invalidAt: null");
    // Should NOT be in the addMemory CREATE params either (only set during soft-delete / supersede)
    const params = allParams();
    const hasInvalidAtParam = params.some((p) => "invalidAt" in p && p.invalidAt === null);
    expect(hasInvalidAtParam).toBe(false);
  });

  // -------------------------------------------------------------------------
  test("BT_02: supersedeMemory sets old.invalidAt and creates new Memory with validAt", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { supersedeMemory } = require("@/lib/memory/write");
    expect(typeof supersedeMemory).toBe("function");

    await supersedeMemory("old-mem-id", "I live in London", "alice", "test-app");

    const cypher = allCypher();
    // Old node must be invalidated
    expect(cypher).toContain("invalidAt");
    // New node must have validAt
    expect(cypher).toContain("validAt");
    // The operation must reference the old memory id
    expect(cypher).toContain("old");
  });

  // -------------------------------------------------------------------------
  test("BT_03: supersedeMemory creates a [:SUPERSEDES] relationship", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { supersedeMemory } = require("@/lib/memory/write");
    await supersedeMemory("old-mem-id", "I live in London", "alice", "test-app");

    const cypher = allCypher();
    expect(cypher).toContain("SUPERSEDES");
  });

  // -------------------------------------------------------------------------
  test("BT_04: deleteMemory sets invalidAt in addition to state = 'deleted'", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "mem-1" })],
      summary: {},
    });

    const { deleteMemory } = require("@/lib/memory/write");
    await deleteMemory("mem-1", "alice");

    const cypher = allCypher();
    // Temporal soft-delete: must set both state and invalidAt
    expect(cypher).toContain("state");
    expect(cypher).toContain("invalidAt");
  });

  // -------------------------------------------------------------------------
  test("BT_05: initSchema creates indexes on :Memory(validAt) and :Memory(invalidAt)", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { initSchema } = require("@/lib/db/memgraph");
    await initSchema();

    const cypher = allCypher();
    // Both temporal property indexes must be bootstrapped
    expect(cypher).toContain("validAt");
    expect(cypher).toContain("invalidAt");
    // They must be index statements
    const lines = cypher.split("\n");
    const validAtIndex = lines.find(
      (l) => l.toUpperCase().includes("INDEX") && l.includes("validAt")
    );
    const invalidAtIndex = lines.find(
      (l) => l.toUpperCase().includes("INDEX") && l.includes("invalidAt")
    );
    expect(validAtIndex).toBeDefined();
    expect(invalidAtIndex).toBeDefined();
  });

  // -------------------------------------------------------------------------
  test("BT_06: listMemories default query filters by invalidAt IS NULL", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "m1", content: "test", state: "active",
        createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
        userId: "alice", appName: null })],
      summary: {},
    });

    const { listMemories } = require("@/lib/memory/search");
    await listMemories({ userId: "alice" });

    const cypher = allCypher();
    // Default list must exclude superseded memories
    expect(cypher).toContain("invalidAt IS NULL");
  });

  // -------------------------------------------------------------------------
  test("BT_07: listMemories with includeSuperseeded=true does NOT filter by invalidAt IS NULL", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "m1", content: "test", state: "active",
        createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
        userId: "alice", appName: null })],
      summary: {},
    });

    const { listMemories } = require("@/lib/memory/search");
    await listMemories({ userId: "alice", includeSuperseeded: true });

    const cypher = allCypher();
    // Should NOT have the invalidAt IS NULL restriction
    expect(cypher).not.toContain("invalidAt IS NULL");
  });

  // -------------------------------------------------------------------------
  test("BT_08: listMemories with asOf uses point-in-time filter", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "m1", content: "old", state: "active",
        createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
        userId: "alice", appName: null })],
      summary: {},
    });

    const asOfTs = "2024-06-01T00:00:00.000Z";

    const { listMemories } = require("@/lib/memory/search");
    await listMemories({ userId: "alice", asOf: asOfTs });

    const cypher = allCypher();
    // Point-in-time filter: validAt <= asOfIso AND (invalidAt IS NULL OR invalidAt > asOfIso)
    expect(cypher).toContain("validAt");
    expect(cypher).toContain("asOfIso");
    expect(cypher).toContain("invalidAt");
  });
});
