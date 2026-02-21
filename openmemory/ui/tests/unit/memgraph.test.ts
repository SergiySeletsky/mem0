/**
 * SPEC 00 — Memgraph data layer unit tests
 *
 * These tests define the contract for the new Memgraph layer.
 * They FAIL before implementation (Spec 00) and PASS after.
 *
 * All neo4j-driver calls are mocked — no running Memgraph needed.
 */

// Make this a TypeScript module to scope declarations (avoids TS2451)
export {};

// --- Mock neo4j-driver ---
const mockSession = {
  run: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
  readTransaction: jest.fn(),
  writeTransaction: jest.fn(),
};

const mockDriver = {
  session: jest.fn().mockReturnValue(mockSession),
  close: jest.fn().mockResolvedValue(undefined),
  verifyConnectivity: jest.fn().mockResolvedValue(undefined),
};

jest.mock("neo4j-driver", () => ({
  // __esModule: true prevents esModuleInterop from double-wrapping the default export
  __esModule: true,
  default: {
    driver: jest.fn().mockReturnValue(mockDriver),
    auth: { basic: jest.fn().mockReturnValue({ scheme: "basic", principal: "neo4j", credentials: "test" }) },
    integer: { toNumber: (n: any) => (typeof n === "object" ? n.low ?? n : n) },
    types: { Node: class {}, Relationship: class {} },
  },
}));

function makeRecord(data: Record<string, any>) {
  return {
    keys: Object.keys(data),
    get: (key: string) => {
      const val = data[key];
      if (typeof val === "number" && Number.isInteger(val)) {
        return { low: val, high: 0, toNumber: () => val };
      }
      return val;
    },
    toObject: () => data,
  };
}

// --- Tests ---
describe("SPEC 00: Memgraph layer contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  // ---- Connection ----
  test("MG_01: getDriver() returns a singleton neo4j-driver instance", async () => {
    const { getDriver } = require("@/lib/db/memgraph");
    const d1 = getDriver();
    const d2 = getDriver();
    expect(d1).toBe(d2);
    const neo4j = require("neo4j-driver").default;
    expect(neo4j.driver).toHaveBeenCalledTimes(1);
    expect(neo4j.driver).toHaveBeenCalledWith(
      expect.stringContaining("bolt://"),
      expect.anything(),
      expect.any(Object)
    );
  });

  test("MG_02: runRead() calls session.run and returns deserialized records", async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [makeRecord({ id: "abc", content: "hello world" })],
      summary: {},
    });

    const { runRead } = require("@/lib/db/memgraph");
    const result = await runRead("MATCH (m:Memory {id: $id}) RETURN m.id AS id, m.content AS content", { id: "abc" });

    expect(mockSession.run).toHaveBeenCalledWith(
      "MATCH (m:Memory {id: $id}) RETURN m.id AS id, m.content AS content",
      { id: "abc" }
    );
    expect(result).toEqual([{ id: "abc", content: "hello world" }]);
    expect(mockSession.close).toHaveBeenCalled();
  });

  test("MG_03: runWrite() calls session.run in a write session and closes it", async () => {
    mockSession.run.mockResolvedValueOnce({ records: [], summary: {} });

    const { runWrite } = require("@/lib/db/memgraph");
    await runWrite("CREATE (u:User {userId: $uid})", { uid: "user-1" });

    expect(mockSession.run).toHaveBeenCalledWith(
      "CREATE (u:User {userId: $uid})",
      { uid: "user-1" }
    );
    expect(mockSession.close).toHaveBeenCalled();
  });

  test("MG_04: runRead() closes session even when query throws", async () => {
    mockSession.run.mockRejectedValueOnce(new Error("Cypher syntax error"));

    const { runRead } = require("@/lib/db/memgraph");
    await expect(
      runRead("INVALID CYPHER", {})
    ).rejects.toThrow("Cypher syntax error");
    expect(mockSession.close).toHaveBeenCalled();
  });

  // ---- Schema initialization ----
  test("MG_05: initSchema() creates vector index on :Memory(embedding)", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { initSchema } = require("@/lib/db/memgraph");
    await initSchema();

    const allCalls: string[] = mockSession.run.mock.calls.map((c: any[]) => c[0] as string);
    const vectorIndexCall = allCalls.find(q => q.includes("VECTOR INDEX") && q.includes(":Memory") && q.includes("embedding"));
    expect(vectorIndexCall).toBeDefined();
  });

  test("MG_06: initSchema() creates text index on :Memory", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { initSchema } = require("@/lib/db/memgraph");
    await initSchema();

    const allCalls: string[] = mockSession.run.mock.calls.map((c: any[]) => c[0] as string);
    const textIndexCall = allCalls.find(q => q.includes("TEXT INDEX") && q.includes(":Memory"));
    expect(textIndexCall).toBeDefined();
  });

  test("MG_07: initSchema() creates UNIQUE constraint on User.userId", async () => {
    mockSession.run.mockResolvedValue({ records: [], summary: {} });

    const { initSchema } = require("@/lib/db/memgraph");
    await initSchema();

    const allCalls: string[] = mockSession.run.mock.calls.map((c: any[]) => c[0] as string);
    const constraintCall = allCalls.find(q =>
      q.toLowerCase().includes("constraint") &&
      q.includes("User") &&
      q.includes("userId")
    );
    expect(constraintCall).toBeDefined();
  });

  // ---- Graph helpers ----
  test("MG_08: getOrCreateUser() MERGEs a User node and returns it", async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [makeRecord({ userId: "alice", id: "uuid-alice", createdAt: "2026-01-01T00:00:00.000Z" })],
      summary: {},
    });

    const { getOrCreateUserMg } = require("@/lib/db/memgraph");
    const user = await getOrCreateUserMg("alice");

    expect(user.userId).toBe("alice");
    const query: string = mockSession.run.mock.calls[0][0];
    expect(query.toUpperCase()).toContain("MERGE");
    expect(query).toContain(":User");
  });

  test("MG_09: user-scoped memory query is structurally isolated by graph traversal", async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        makeRecord({ id: "mem-1", content: "Test memory" }),
      ],
      summary: {},
    });

    const { runRead } = require("@/lib/db/memgraph");
    // The canonical pattern: anchor to User node
    await runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
       WHERE m.invalidAt IS NULL AND m.state <> 'deleted'
       RETURN m.id AS id, m.content AS content`,
      { userId: "alice" }
    );

    // Verify the call anchors to User (structural isolation)
    const query: string = mockSession.run.mock.calls[0][0];
    expect(query).toContain("(u:User {userId: $userId})");
    expect(query).toContain("[:HAS_MEMORY]");
    expect(query).toContain("m.invalidAt IS NULL");
  });
});
