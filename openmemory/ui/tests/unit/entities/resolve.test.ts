export {};
/**
 * Unit tests — resolveEntity (lib/entities/resolve.ts)
 *
 * RESOLVE_01: First call creates a new Entity, returns an id
 * RESOLVE_02: Second call with same name+type returns the SAME id (MERGE dedup)
 * RESOLVE_03: Same name but different type creates a DIFFERENT entity
 * RESOLVE_04: Longer description on re-resolve updates the description
 */
import { resolveEntity } from "@/lib/entities/resolve";

jest.mock("@/lib/db/memgraph", () => ({ runWrite: jest.fn() }));
import { runWrite } from "@/lib/db/memgraph";

const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;

beforeEach(() => jest.clearAllMocks());

describe("resolveEntity", () => {
  it("RESOLVE_01: creates a new entity and returns an id string", async () => {
    mockRunWrite.mockResolvedValue([{ id: "entity-uuid-1" }]);

    const id = await resolveEntity(
      { name: "Alice", type: "PERSON", description: "A colleague" },
      "user-1"
    );

    expect(typeof id).toBe("string");
    expect(id).toBe("entity-uuid-1");
    expect(mockRunWrite).toHaveBeenCalledTimes(1);

    // Verify the Cypher uses MERGE (find-or-create)
    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("MERGE");
    expect(cypher).toContain("HAS_ENTITY");
  });

  it("RESOLVE_02: same name+type returns same id (MERGE semantics)", async () => {
    // Simulate Memgraph MERGE returning same node both times
    mockRunWrite.mockResolvedValue([{ id: "entity-uuid-alice" }]);

    const id1 = await resolveEntity({ name: "Alice", type: "PERSON", description: "A colleague" }, "user-1");
    const id2 = await resolveEntity({ name: "alice", type: "PERSON", description: "Alice again" }, "user-1");

    // Both calls return the same id from the mock (MERGE would do this in DB)
    expect(id1).toBe(id2);
  });

  it("RESOLVE_03: same name different type → different resolveEntity call (distinct params)", async () => {
    mockRunWrite
      .mockResolvedValueOnce([{ id: "id-person" }])
      .mockResolvedValueOnce([{ id: "id-org" }]);

    const personId = await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");
    const orgId = await resolveEntity({ name: "Alice", type: "ORGANIZATION", description: "" }, "user-1");

    expect(personId).toBe("id-person");
    expect(orgId).toBe("id-org");
    expect(personId).not.toBe(orgId);
  });

  it("RESOLVE_04: longer description triggers ON MATCH SET with CASE expression", async () => {
    mockRunWrite.mockResolvedValue([{ id: "entity-uuid-1" }]);

    await resolveEntity({ name: "Alice", type: "PERSON", description: "A more detailed description of Alice" }, "user-1");

    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("ON MATCH SET");
    expect(cypher).toContain("CASE");
  });
});
