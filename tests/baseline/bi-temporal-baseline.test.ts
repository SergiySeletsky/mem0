/**
 * BASELINE TESTS -- Spec 01 pre-bi-temporal
 *
 * These document the state of the write-path BEFORE and AFTER implementing
 * the bi-temporal model.  Issues marked [RESOLVED - Spec 01] have been fixed.
 *
 *   BITEMPORAL_ISSUE_01 [RESOLVED] -- addMemory now sets validAt/invalidAt
 *   BITEMPORAL_ISSUE_02           -- updateMemory still does in-place SET
 *                                    (by design; callers use supersedeMemory directly)
 *   BITEMPORAL_ISSUE_03 [RESOLVED] -- deleteMemory now sets invalidAt
 */

// Make this a TypeScript module to scope declarations (avoids TS2451)
export {};

// ---------------------------------------------------------------------------
// Neo4j mock (same pattern as tests/unit/memgraph.test.ts)
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
// Embed mock -- returns a fixed 1536-dim vector without calling OpenAI
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

/** Collect all Cypher strings sent to session.run after an operation. */
function allCypher(): string {
  return mockSession.run.mock.calls.map((c: any[]) => c[0] as string).join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BASELINE: Bi-temporal (pre-Spec 01)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Re-apply mocks after resetModules so dynamic require() in each test
    // receives fresh-but-mocked modules.
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
  test("BITEMPORAL_ISSUE_01 [RESOLVED Spec 01]: addMemory now sets validAt (invalidAt absent = null)", async () => {
    // Original issue: addMemory had NO validAt/invalidAt
    // Status: RESOLVED -- Spec 01 added bi-temporal validAt to CREATE.
    // invalidAt is NOT set explicitly on new nodes; Memgraph rejects null literals
    // in CREATE/MERGE property maps. An absent property IS null in Cypher semantics
    // so WHERE m.invalidAt IS NULL correctly selects live nodes.
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { addMemory } = require("@/lib/memory/write");
    await addMemory("I live in NYC", { userId: "alice", appName: "test-app" });

    const cypher = allCypher();
    // RESOLVED: validAt is set; invalidAt is intentionally absent (null by default)
    expect(cypher).toContain("validAt");
    // invalidAt must NOT be in the CREATE literal â€” Memgraph forbids null property literals
    expect(cypher).not.toContain("invalidAt: null");
  });

  // -------------------------------------------------------------------------
  test("BITEMPORAL_ISSUE_02: updateMemory does in-place SET (no SUPERSEDES edge)", async () => {
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "mem-1" })],
      summary: {},
    });

    const { updateMemory } = require("@/lib/memory/write");
    await updateMemory("mem-1", "I live in London", { userId: "alice" });

    const cypher = allCypher();
    // ISSUE: direct mutation, no temporal history
    expect(cypher).not.toContain("SUPERSEDES");
    expect(cypher).not.toContain("invalidAt");
    // Confirm it uses in-place SET
    expect(cypher).toContain("SET m.content");
  });

  // -------------------------------------------------------------------------
  test("BITEMPORAL_ISSUE_03 [RESOLVED Spec 01]: deleteMemory now sets invalidAt", async () => {
    // Original issue: deleteMemory only set state = 'deleted', no invalidAt
    // Status: RESOLVED -- Spec 01 adds invalidAt to the soft-delete SET
    mockSession.run.mockResolvedValue({
      records: [makeRecord({ id: "mem-1" })],
      summary: {},
    });

    const { deleteMemory } = require("@/lib/memory/write");
    await deleteMemory("mem-1", "alice");

    const cypher = allCypher();
    // RESOLVED: invalidAt is now set on soft-delete
    expect(cypher).toContain("invalidAt");
    expect(cypher).toContain("state");
  });
});
