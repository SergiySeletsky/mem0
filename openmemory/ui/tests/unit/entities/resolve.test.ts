export {};
/**
 * Unit tests — resolveEntity (lib/entities/resolve.ts)
 *
 * RESOLVE_01: First call creates a new Entity, returns an id
 * RESOLVE_02: Second call with same name returns the SAME id (case-insensitive)
 * RESOLVE_03: Same name but different type → SAME entity (type dedup), upgrades type if more specific
 * RESOLVE_04: Longer description on re-resolve updates the description
 * RESOLVE_08-11: Name-alias resolution for PERSON entities (Eval v4 Finding 2)
 */
import { resolveEntity } from "@/lib/entities/resolve";

jest.mock("@/lib/db/memgraph", () => ({ runRead: jest.fn(), runWrite: jest.fn() }));
import { runRead, runWrite } from "@/lib/db/memgraph";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;

beforeEach(() => jest.clearAllMocks());

describe("resolveEntity", () => {
  it("RESOLVE_01: creates a new entity and returns an id string", async () => {
    // resolveEntity flow for new PERSON entity:
    //   runWrite[0] ensure User (MERGE u:User)
    //   runWrite[1] find existing entity → empty (no match)
    //   runRead[0]  alias lookup (PERSON, no exact match) → empty
    //   runWrite[2] CREATE Entity
    //   runWrite[3] MERGE HAS_ENTITY relationship
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([])                      // No existing entity found
      .mockResolvedValueOnce([{}])                    // CREATE Entity
      .mockResolvedValueOnce([{}]);                   // HAS_ENTITY MERGE
    mockRunRead.mockResolvedValueOnce([]);            // Alias lookup → no match

    const id = await resolveEntity(
      { name: "Alice", type: "PERSON", description: "A colleague" },
      "user-1"
    );

    expect(typeof id).toBe("string");
    expect(mockRunWrite).toHaveBeenCalledTimes(4);
    expect(mockRunRead).toHaveBeenCalledTimes(1);

    // calls[1] is the entity lookup — it uses toLower() for case-insensitive matching
    const lookupCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(lookupCypher).toContain("toLower");
    // calls[2] is the CREATE — creating the new entity
    const createCypher = mockRunWrite.mock.calls[2][0] as string;
    expect(createCypher).toContain("CREATE");
    // calls[3] is the HAS_ENTITY MERGE
    const relCypher = mockRunWrite.mock.calls[3][0] as string;
    expect(relCypher).toContain("HAS_ENTITY");
  });

  it("RESOLVE_02: same name returns same id — case-insensitive dedup", async () => {
    // First call: creates new entity (PERSON, no exact match → alias lookup → no match → create)
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([])                      // No existing entity
      .mockResolvedValueOnce([{}])                    // CREATE
      .mockResolvedValueOnce([{}]);                   // HAS_ENTITY
    mockRunRead.mockResolvedValueOnce([]);            // Alias lookup → no match

    const id1 = await resolveEntity({ name: "Alice", type: "PERSON", description: "A colleague" }, "user-1");

    // Second call: finds existing entity by exact name → no alias lookup needed
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([{ id: id1, name: "Alice", type: "PERSON", description: "A colleague" }]); // Found existing

    const id2 = await resolveEntity({ name: "alice", type: "PERSON", description: "Alice again" }, "user-1");

    // Both calls return the same id
    expect(id1).toBe(id2);
  });

  it("RESOLVE_03: same name different type → SAME entity with type upgrade", async () => {
    // First call: creates entity as OTHER
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([])                      // No existing entity
      .mockResolvedValueOnce([{}])                    // CREATE
      .mockResolvedValueOnce([{}]);                   // HAS_ENTITY

    const id1 = await resolveEntity({ name: "Alice", type: "OTHER", description: "" }, "user-1");

    // Second call: same name, PERSON type (more specific) → should find existing, upgrade type
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([{ id: id1, name: "Alice", type: "OTHER", description: "" }]) // Found existing
      .mockResolvedValueOnce([{}]);                   // Type upgrade SET

    const id2 = await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");

    expect(id1).toBe(id2);

    // The SET call should upgrade type from OTHER to PERSON
    const setCypher = mockRunWrite.mock.calls[6][0] as string;
    expect(setCypher).toContain("SET");
  });

  it("RESOLVE_04: longer description triggers update", async () => {
    // First call: creates entity (PERSON, no exact match → alias lookup → no match → create)
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([])                      // No existing entity
      .mockResolvedValueOnce([{}])                    // CREATE
      .mockResolvedValueOnce([{}]);                   // HAS_ENTITY
    mockRunRead.mockResolvedValueOnce([]);            // Alias lookup → no match

    const id1 = await resolveEntity({ name: "Alice", type: "PERSON", description: "Short" }, "user-1");

    // Second call: longer description → should update (exact match → no alias)
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([{ id: id1, name: "Alice", type: "PERSON", description: "Short" }]) // Found existing
      .mockResolvedValueOnce([{}]);                   // Description update SET

    await resolveEntity({ name: "Alice", type: "PERSON", description: "A more detailed description of Alice" }, "user-1");

    // The SET call should update description
    const setCypher = mockRunWrite.mock.calls[6][0] as string;
    expect(setCypher).toContain("SET");
    expect(setCypher).toContain("newDesc");
  });

  it("RESOLVE_05: type priority ordering — PERSON > ORGANIZATION > LOCATION > PRODUCT > CONCEPT > OTHER", async () => {
    // Verify all 6 priority pairs in descending specificity
    const priority = ["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "CONCEPT", "OTHER"];
    for (let i = 0; i < priority.length - 1; i++) {
      jest.clearAllMocks();
      // Simulate entity exists as the LESS specific type
      mockRunWrite
        .mockResolvedValueOnce([{}])   // User MERGE
        .mockResolvedValueOnce([{      // Found existing with lower priority
          id: "existing-id", name: "Test", type: priority[i + 1], description: "",
        }])
        .mockResolvedValueOnce([{}]);  // SET upgrade

      await resolveEntity({ name: "Test", type: priority[i], description: "" }, "user-1");

      // Should trigger an upgrade SET because priority[i] < priority[i+1]
      expect(mockRunWrite).toHaveBeenCalledTimes(3);
      const setParams = mockRunWrite.mock.calls[2][1] as Record<string, unknown>;
      expect(setParams.shouldUpgradeType).toBe(true);
      expect(setParams.newType).toBe(priority[i]);
    }
  });

  it("RESOLVE_06: lower-priority type does NOT downgrade existing", async () => {
    // Entity is PERSON, new extraction says CONCEPT → should NOT upgrade
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([{                       // Found existing as PERSON
        id: "existing-id", name: "Alice", type: "PERSON", description: "A colleague",
      }]);

    await resolveEntity({ name: "Alice", type: "CONCEPT", description: "" }, "user-1");

    // Only 2 calls: User MERGE + entity lookup. No SET because no upgrade needed.
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
  });

  it("RESOLVE_07: same-priority type does NOT trigger upgrade", async () => {
    // Entity is PERSON, new extraction also says PERSON → no upgrade needed
    mockRunWrite
      .mockResolvedValueOnce([{}])                    // User MERGE
      .mockResolvedValueOnce([{
        id: "existing-id", name: "Alice", type: "PERSON", description: "A colleague",
      }]);

    await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");

    // Only 2 calls: no SET triggered
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Name-alias resolution (Eval v4 Finding 2)
  // ---------------------------------------------------------------------------

  it("RESOLVE_08: 'Alice' matches existing 'Alice Chen' (PERSON prefix alias)", async () => {
    // runWrite[0] User MERGE
    mockRunWrite.mockResolvedValueOnce([{}]);
    // runWrite[1] exact name match → empty (no "Alice" entity)
    mockRunWrite.mockResolvedValueOnce([]);
    // runRead[0] partial name match (alias) → finds "Alice Chen"
    mockRunRead.mockResolvedValueOnce([{
      id: "existing-alice-chen", name: "Alice Chen", type: "PERSON", description: "Lead engineer",
    }]);
    // No name upgrade because existing name is longer — no extra SET

    const id = await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");

    expect(id).toBe("existing-alice-chen");
    expect(mockRunWrite).toHaveBeenCalledTimes(2); // MERGE + exact lookup only
    expect(mockRunRead).toHaveBeenCalledTimes(1); // Alias lookup
    // Alias query should check STARTS WITH
    const aliasCypher = mockRunRead.mock.calls[0][0] as string;
    expect(aliasCypher).toContain("STARTS WITH");
    expect(aliasCypher).toContain("PERSON");
  });

  it("RESOLVE_09: 'Alice Chen' upgrades existing 'Alice' PERSON name", async () => {
    // runWrite[0] User MERGE
    mockRunWrite.mockResolvedValueOnce([{}]);
    // runWrite[1] exact name match → empty (no "Alice Chen")
    mockRunWrite.mockResolvedValueOnce([]);
    // runRead[0] partial name match (alias) → finds "Alice"
    mockRunRead.mockResolvedValueOnce([{
      id: "existing-alice", name: "Alice", type: "PERSON", description: "Teammate",
    }]);
    // runWrite[2] name upgrade: "Alice Chen" is longer, so upgrade the stored name
    mockRunWrite.mockResolvedValueOnce([{}]);

    const id = await resolveEntity({ name: "Alice Chen", type: "PERSON", description: "" }, "user-1");

    expect(id).toBe("existing-alice");
    // 3 runWrite calls: MERGE + exact lookup + name upgrade SET
    expect(mockRunWrite).toHaveBeenCalledTimes(3);
    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const nameCypher = mockRunWrite.mock.calls[2][0] as string;
    expect(nameCypher).toContain("SET e.name");
    const nameParams = mockRunWrite.mock.calls[2][1] as Record<string, unknown>;
    expect(nameParams.longerName).toBe("Alice Chen");
  });

  it("RESOLVE_10: alias matching only applies to PERSON entities", async () => {
    // For CONCEPT entities, no alias matching — only exact
    mockRunWrite
      .mockResolvedValueOnce([{}])     // MERGE User
      .mockResolvedValueOnce([])       // exact lookup → empty
      .mockResolvedValueOnce([{}])     // CREATE Entity
      .mockResolvedValueOnce([{}]);    // HAS_ENTITY

    const id = await resolveEntity({ name: "React", type: "CONCEPT", description: "UI library" }, "user-1");

    // Should create new entity, NOT try alias matching
    expect(typeof id).toBe("string");
    expect(mockRunWrite).toHaveBeenCalledTimes(4);
    // Verify NO runRead was called (runRead is only used for alias lookup)
    expect(mockRunRead).not.toHaveBeenCalled();
    const createCypher = mockRunWrite.mock.calls[2][0] as string;
    expect(createCypher).toContain("CREATE");
  });

  it("RESOLVE_11: alias match only fires when exact match fails", async () => {
    // Exact match succeeds → alias resolution is NOT attempted
    mockRunWrite
      .mockResolvedValueOnce([{}])     // User MERGE
      .mockResolvedValueOnce([{
        id: "exact-id", name: "Alice Chen", type: "PERSON", description: "",
      }]);

    const id = await resolveEntity({ name: "Alice Chen", type: "PERSON", description: "" }, "user-1");

    expect(id).toBe("exact-id");
    // Only 2 runWrite calls — exact match found, no alias query
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    expect(mockRunRead).not.toHaveBeenCalled();
  });
});
