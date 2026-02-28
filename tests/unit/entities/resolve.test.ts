export {};
/**
 * Unit tests — resolveEntity (lib/entities/resolve.ts)
 *
 * After the atomicity + read-session fix:
 *  - Step 2 (normalizedName lookup) now uses runRead (not runWrite)
 *  - Entity creation is one atomic runWrite (MERGE Entity via (u)-[:HAS_ENTITY] pattern)
 *
 * New call pattern for "create new PERSON entity":
 *   runWrite[0]  User MERGE
 *   runRead[0]   normalizedName exact lookup  → empty
 *   runRead[1]   alias lookup (PERSON only)   → empty
 *   runWrite[1]  MERGE (u)-[:HAS_ENTITY]->(e:Entity {normalizedName, userId}) ON CREATE SET ...
 *
 * RESOLVE_01: First call creates a new Entity, returns an id
 * RESOLVE_02: Second call with same name returns the SAME id (normalizedName dedup)
 * RESOLVE_03: Same name but different type → SAME entity (type dedup), upgrades type if more specific
 * RESOLVE_04: Longer description on re-resolve updates the description
 * RESOLVE_08-11: Name-alias resolution for PERSON entities (Eval v4 Finding 2)
 * RESOLVE_12: normalizedName dedup — "Order Service" == "OrderService" (whitespace stripped)
 * RESOLVE_13: Semantic dedup — embedding match + LLM confirms merge
 * RESOLVE_14: Semantic dedup — LLM rejects merge → creates new entity
 * RESOLVE_15: Semantic dedup — embed fails → graceful fallback → creates new entity
 * RESOLVE_16: Domain-specific type "SERVICE" upgrades "CONCEPT" (open ontology)
 * RESOLVE_ATOMIC: entity creation is a single User-anchored write (atomicity fix)
 * RESOLVE_READ_ONLY: Step 2 uses read session (runRead), not write session
 * RESOLVE_DUP_SAFE: MERGE returns existing entity id when concurrent writer beats us (ENTITY-DUP-FIX)
 */
import { resolveEntity } from "@/lib/entities/resolve";

jest.mock("@/lib/db/memgraph", () => ({ runRead: jest.fn(), runWrite: jest.fn() }));
import { runRead, runWrite } from "@/lib/db/memgraph";

jest.mock("@/lib/embeddings/openai", () => ({ embed: jest.fn() }));
import { embed } from "@/lib/embeddings/openai";

jest.mock("@/lib/ai/client", () => ({ getLLMClient: jest.fn() }));
import { getLLMClient } from "@/lib/ai/client";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;
const mockEmbed = embed as jest.MockedFunction<typeof embed>;
const mockGetLLMClient = getLLMClient as jest.MockedFunction<typeof getLLMClient>;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: embed fails → findEntityBySemantic returns null (no semantic dedup side-effects)
  mockEmbed.mockRejectedValue(new Error("No API key in tests"));
});

describe("resolveEntity", () => {
  it("RESOLVE_01: creates a new entity and returns an id string", async () => {
    // New flow for PERSON entity:
    //   runWrite[0] ensure User (MERGE u:User)
    //   runRead[0]  normalizedName exact lookup → empty
    //   runRead[1]  alias lookup (PERSON only)  → empty
    //   runWrite[1] atomic CREATE Entity + CREATE HAS_ENTITY
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE + HAS_ENTITY
    mockRunRead
      .mockResolvedValueOnce([])     // normalizedName exact lookup → no match
      .mockResolvedValueOnce([]);    // alias lookup → no match

    const id = await resolveEntity(
      { name: "Alice", type: "PERSON", description: "A colleague" },
      "user-1"
    );

    expect(typeof id).toBe("string");
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    expect(mockRunRead).toHaveBeenCalledTimes(2);

    // runRead[0] is the exact lookup — uses normalizedName
    const lookupCypher = mockRunRead.mock.calls[0][0] as string;
    expect(lookupCypher).toContain("normalizedName");

    // runWrite[1] is the atomic CREATE — creating the new entity AND the HAS_ENTITY edge
    const createCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(createCypher).toContain("CREATE");
    expect(createCypher).toContain(":Entity");
    expect(createCypher).toContain("HAS_ENTITY");
  });

  it("RESOLVE_02: same name returns same id — case-insensitive dedup", async () => {
    // First call: creates new entity (PERSON)
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE
    mockRunRead
      .mockResolvedValueOnce([])     // normalizedName lookup → empty
      .mockResolvedValueOnce([]);    // alias lookup → empty

    const id1 = await resolveEntity({ name: "Alice", type: "PERSON", description: "A colleague" }, "user-1");

    // Second call: "alice" normalizes same as "Alice" → finds existing via runRead
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead.mockResolvedValueOnce([{ id: id1, name: "Alice", type: "PERSON", description: "A colleague" }]);

    const id2 = await resolveEntity({ name: "alice", type: "PERSON", description: "Alice again" }, "user-1");

    // Both calls return the same id
    expect(id1).toBe(id2);
  });

  it("RESOLVE_03: same name different type → SAME entity with type upgrade", async () => {
    // First call: creates entity as OTHER (not PERSON → no alias lookup)
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE
    mockRunRead.mockResolvedValueOnce([]); // normalizedName lookup → empty (no alias for OTHER)

    const id1 = await resolveEntity({ name: "Alice", type: "OTHER", description: "" }, "user-1");

    // Second call: same name, PERSON type (more specific) → should find existing, upgrade type
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // Type upgrade SET
    mockRunRead.mockResolvedValueOnce([{ id: id1, name: "Alice", type: "OTHER", description: "" }]); // Found

    const id2 = await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");

    expect(id1).toBe(id2);

    // The SET call (4th write call overall, index 3) upgrades type
    const setCypher = mockRunWrite.mock.calls[3][0] as string;
    expect(setCypher).toContain("SET");
  });

  it("RESOLVE_04: longer description triggers update", async () => {
    // First call: creates entity (PERSON)
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE
    mockRunRead
      .mockResolvedValueOnce([])     // normalizedName lookup → empty
      .mockResolvedValueOnce([]);    // alias lookup → empty

    const id1 = await resolveEntity({ name: "Alice", type: "PERSON", description: "Short" }, "user-1");

    // Second call: longer description → should update (exact match → no alias)
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // Description update SET
    mockRunRead.mockResolvedValueOnce([{ id: id1, name: "Alice", type: "PERSON", description: "Short" }]);

    await resolveEntity({ name: "Alice", type: "PERSON", description: "A more detailed description of Alice" }, "user-1");

    // The SET call (4th write call overall, index 3) updates description
    const setCypher = mockRunWrite.mock.calls[3][0] as string;
    expect(setCypher).toContain("SET");
    expect(setCypher).toContain("newDesc");
  });

  it("RESOLVE_05: type priority ordering — PERSON > ORGANIZATION > LOCATION > PRODUCT > CONCEPT > OTHER", async () => {
    const priority = ["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "CONCEPT", "OTHER"];
    for (let i = 0; i < priority.length - 1; i++) {
      jest.clearAllMocks();
      // Exact lookup returns existing entity with LOWER priority type
      mockRunWrite
        .mockResolvedValueOnce([{}])   // User MERGE
        .mockResolvedValueOnce([{}]);  // SET upgrade
      mockRunRead.mockResolvedValueOnce([{
        id: "existing-id", name: "Test", type: priority[i + 1], description: "",
      }]);

      await resolveEntity({ name: "Test", type: priority[i], description: "" }, "user-1");

      // 2 runWrite: MERGE + SET upgrade
      expect(mockRunWrite).toHaveBeenCalledTimes(2);
      const setParams = mockRunWrite.mock.calls[1][1] as Record<string, unknown>;
      expect(setParams.shouldUpgradeType).toBe(true);
      expect(setParams.newType).toBe(priority[i]);
    }
  });

  it("RESOLVE_06: lower-priority type does NOT downgrade existing", async () => {
    // Entity is PERSON, new extraction says CONCEPT → no upgrade
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead.mockResolvedValueOnce([{ id: "existing-id", name: "Alice", type: "PERSON", description: "A colleague" }]);

    await resolveEntity({ name: "Alice", type: "CONCEPT", description: "" }, "user-1");

    // Only 1 runWrite (User MERGE) + 1 runRead (lookup). No SET.
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    expect(mockRunRead).toHaveBeenCalledTimes(1);
  });

  it("RESOLVE_07: same-priority type does NOT trigger upgrade", async () => {
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead.mockResolvedValueOnce([{ id: "existing-id", name: "Alice", type: "PERSON", description: "A colleague" }]);

    await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");

    // Only 1 runWrite + 1 runRead, no SET triggered
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    expect(mockRunRead).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Name-alias resolution (Eval v4 Finding 2)
  // ---------------------------------------------------------------------------

  it("RESOLVE_08: 'Alice' matches existing 'Alice Chen' (PERSON prefix alias)", async () => {
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead
      .mockResolvedValueOnce([])              // exact normalizedName lookup → empty
      .mockResolvedValueOnce([{              // alias lookup → finds "Alice Chen"
        id: "existing-alice-chen", name: "Alice Chen", type: "PERSON", description: "Lead engineer",
      }]);
    // No name upgrade — existing name is longer, so incoming "Alice" doesn't trigger upgrade

    const id = await resolveEntity({ name: "Alice", type: "PERSON", description: "" }, "user-1");

    expect(id).toBe("existing-alice-chen");
    expect(mockRunWrite).toHaveBeenCalledTimes(1); // Only User MERGE — no new entity created
    expect(mockRunRead).toHaveBeenCalledTimes(2);  // Exact lookup + alias lookup
    const aliasCypher = mockRunRead.mock.calls[1][0] as string;
    expect(aliasCypher).toContain("STARTS WITH");
    expect(aliasCypher).toContain("PERSON");
  });

  it("RESOLVE_09: 'Alice Chen' upgrades existing 'Alice' PERSON name", async () => {
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // name upgrade SET
    mockRunRead
      .mockResolvedValueOnce([])     // exact normalizedName lookup → empty (no "alicechen")
      .mockResolvedValueOnce([{     // alias lookup → finds "Alice"
        id: "existing-alice", name: "Alice", type: "PERSON", description: "Teammate",
      }]);

    const id = await resolveEntity({ name: "Alice Chen", type: "PERSON", description: "" }, "user-1");

    expect(id).toBe("existing-alice");
    // 2 runWrite: User MERGE + name upgrade SET
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    expect(mockRunRead).toHaveBeenCalledTimes(2);
    const nameCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(nameCypher).toContain("SET e.name");
    const nameParams = mockRunWrite.mock.calls[1][1] as Record<string, unknown>;
    expect(nameParams.longerName).toBe("Alice Chen");
  });

  it("RESOLVE_10: alias matching only applies to PERSON entities", async () => {
    // CONCEPT type → no alias lookup → goes straight to creating new entity
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE + HAS_ENTITY
    mockRunRead.mockResolvedValueOnce([]); // exact lookup → empty

    const id = await resolveEntity({ name: "React", type: "CONCEPT", description: "UI library" }, "user-1");

    expect(typeof id).toBe("string");
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    // NO second runRead — alias lookup only fires for PERSON
    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const createCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(createCypher).toContain("CREATE");
  });

  it("RESOLVE_11: alias match only fires when exact match fails", async () => {
    // Exact match succeeds → alias resolution is NOT attempted
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead.mockResolvedValueOnce([{
      id: "exact-id", name: "Alice Chen", type: "PERSON", description: "",
    }]);

    const id = await resolveEntity({ name: "Alice Chen", type: "PERSON", description: "" }, "user-1");

    expect(id).toBe("exact-id");
    // Only 1 runWrite (MERGE) + 1 runRead (exact lookup); no alias query
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    expect(mockRunRead).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // normalizedName dedup (RESOLVE_12)
  // ---------------------------------------------------------------------------

  it("RESOLVE_12: 'Order Service' and 'OrderService' resolve to the SAME entity (normalizedName)", async () => {
    // First call: creates "OrderService" as SERVICE type (no alias for SERVICE)
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE (stores normalizedName: "orderservice")
    mockRunRead.mockResolvedValueOnce([]); // normalizedName "orderservice" lookup → empty

    const id1 = await resolveEntity({ name: "OrderService", type: "SERVICE", description: "Order microservice" }, "user-1");

    // Second call: "Order Service" normalizes to "orderservice" — should find existing
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead.mockResolvedValueOnce([{      // normalizedName "orderservice" lookup → HIT
      id: id1, name: "OrderService", type: "SERVICE", description: "Order microservice",
    }]);

    const id2 = await resolveEntity({ name: "Order Service", type: "SERVICE", description: "" }, "user-1");

    expect(id1).toBe(id2);

    // Verify the atomic CREATE stored normalizedName
    const createParams = mockRunWrite.mock.calls[1][1] as Record<string, unknown>;
    expect(createParams.normalizedName).toBe("orderservice");

    // Verify the second lookup used normalizedName (runRead[1] is the second call's lookup)
    const secondLookupCypher = mockRunRead.mock.calls[1][0] as string;
    expect(secondLookupCypher).toContain("normalizedName");
  });

  // ---------------------------------------------------------------------------
  // Semantic dedup (RESOLVE_13, RESOLVE_14, RESOLVE_15)
  // ---------------------------------------------------------------------------

  it("RESOLVE_13: semantic dedup — embedding match + LLM confirms merge → reuses existing entity", async () => {
    // Exact normalizedName lookup fails, alias skipped (CONCEPT type)
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead
      .mockResolvedValueOnce([])              // normalizedName lookup → empty
      .mockResolvedValueOnce([{              // vector_search result
        id: "redis-entity-id",
        name: "Redis",
        type: "DATABASE",
        description: "In-memory data store",
        similarity: 0.92,
      }]);

    const fakeVector = Array.from({ length: 1536 }, () => 0.01);
    mockEmbed.mockResolvedValueOnce(fakeVector); // once only

    // LLM confirms the merge
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"same":true}' } }],
    });
    mockGetLLMClient.mockReturnValue({ chat: { completions: { create: mockCreate } } } as any);

    const id = await resolveEntity(
      { name: "Redis Cache", type: "DATABASE", description: "Redis caching layer" },
      "user-1"
    );

    // Returns the existing entity id, does NOT create new
    expect(id).toBe("redis-entity-id");
    // Only 1 runWrite: User MERGE (no creation)
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    // 2 runRead: normalizedName lookup + vector search
    expect(mockRunRead).toHaveBeenCalledTimes(2);
    const vectorCypher = mockRunRead.mock.calls[1][0] as string;
    expect(vectorCypher).toContain("vector_search.search");
    expect(vectorCypher).toContain("entity_vectors");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("RESOLVE_14: semantic dedup — LLM rejects merge → creates new entity", async () => {
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE
    mockRunRead
      .mockResolvedValueOnce([])     // normalizedName lookup → empty
      .mockResolvedValueOnce([{     // vector search → candidate
        id: "different-entity",
        name: "Valkey",
        type: "DATABASE",
        description: "Fork of Redis",
        similarity: 0.91,
      }]);

    const fakeVector = Array.from({ length: 1536 }, () => 0.01);
    mockEmbed.mockResolvedValueOnce(fakeVector);

    // LLM REJECTS the merge
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"same":false}' } }],
    });
    mockGetLLMClient.mockReturnValue({ chat: { completions: { create: mockCreate } } } as any);

    const id = await resolveEntity(
      { name: "Redis", type: "DATABASE", description: "In-memory data store" },
      "user-1"
    );

    // Creates a brand-new entity (not merged with Valkey)
    expect(id).not.toBe("different-entity");
    // 2 runWrite: MERGE + atomic CREATE
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    // 2 runRead: normalizedName lookup + vector search
    expect(mockRunRead).toHaveBeenCalledTimes(2);
    const createCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(createCypher).toContain("CREATE");
  });

  it("RESOLVE_15: semantic dedup — embed fails → graceful fallback → creates new entity", async () => {
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // atomic CREATE
    mockRunRead.mockResolvedValueOnce([]); // normalizedName lookup → empty

    // embed already mocked to reject in beforeEach — no override needed

    const id = await resolveEntity(
      { name: "Kafka", type: "SERVICE", description: "Message broker" },
      "user-1"
    );

    expect(typeof id).toBe("string");
    // 2 runWrite: MERGE + CREATE; embed failed silently → no vector search runRead
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    expect(mockRunRead).toHaveBeenCalledTimes(1); // Only normalizedName lookup
    const createCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(createCypher).toContain("CREATE");
  });

  // ---------------------------------------------------------------------------
  // Open ontology type upgrade (RESOLVE_16)
  // ---------------------------------------------------------------------------

  it("RESOLVE_16: domain-specific type 'SERVICE' upgrades 'CONCEPT' (open ontology priority)", async () => {
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // SET type upgrade
    mockRunRead.mockResolvedValueOnce([{  // Found existing as CONCEPT
      id: "svc-id", name: "AuthService", type: "CONCEPT", description: "",
    }]);

    const id = await resolveEntity({ name: "AuthService", type: "SERVICE", description: "Auth service" }, "user-1");

    expect(id).toBe("svc-id");
    // 2 runWrite: MERGE + SET upgrade; 1 runRead: lookup
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const setParams = mockRunWrite.mock.calls[1][1] as Record<string, unknown>;
    expect(setParams.shouldUpgradeType).toBe(true);
    expect(setParams.newType).toBe("SERVICE");
  });

  // ---------------------------------------------------------------------------
  // Atomicity + read-session correctness (new reliability tests)
  // ---------------------------------------------------------------------------

  it("RESOLVE_ATOMIC: entity creation is a single User-anchored atomic write (no orphan risk)", async () => {
    // PERSON type: User MERGE + (exact lookup + alias lookup both empty) + MERGE entity
    mockRunWrite
      .mockResolvedValueOnce([{}])   // User MERGE
      .mockResolvedValueOnce([{}]);  // MERGE entity (ENTITY-DUP-FIX: was CREATE)
    mockRunRead
      .mockResolvedValueOnce([])     // exact lookup
      .mockResolvedValueOnce([]);    // alias lookup

    await resolveEntity({ name: "NewPerson", type: "PERSON", description: "" }, "user-1");

    // Exactly 2 write calls (no separate HAS_ENTITY call)
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    const createCall = mockRunWrite.mock.calls[1][0] as string;
    const createParams = mockRunWrite.mock.calls[1][1] as Record<string, unknown>;

    // Single call creates Entity AND HAS_ENTITY edge (via MERGE pattern)
    expect(createCall).toContain("MERGE");
    expect(createCall).toContain(":Entity");
    expect(createCall).toContain("HAS_ENTITY");
    // Anchored through User for namespace isolation
    expect(createCall).toContain("User {userId: $userId}");
    expect(createParams.userId).toBe("user-1");
  });

  it("RESOLVE_DUP_SAFE: MERGE returns existing entityId when a concurrent writer beat us (ENTITY-DUP-FIX)", async () => {
    // Simulates the race: 3-tier lookup returned empty (no existing entity),
    // but by the time our MERGE fires, another writer already created the node.
    // Memgraph's MERGE finds it and returns the existing id — we use that id.
    // CONCEPT type: only 1 runRead (normalizedName exact lookup, no alias lookup).
    mockRunRead.mockResolvedValueOnce([]);   // normalizedName exact lookup → empty
    mockRunWrite
      .mockResolvedValueOnce([{}])                               // User MERGE
      .mockResolvedValueOnce([{ entityId: "concurrent-id" }]);  // MERGE: concurrent writer's node returned

    const id = await resolveEntity(
      { name: "SharedEntity", type: "CONCEPT", description: "" },
      "user-1"
    );

    // Must use the id returned by MERGE (the concurrent writer's entity), not our generated UUID
    expect(id).toBe("concurrent-id");
  });

  it("RESOLVE_READ_ONLY: Step 2 normalizedName lookup uses runRead (not runWrite)", async () => {
    // Simulate an entity that was found by lookup
    mockRunWrite.mockResolvedValueOnce([{}]); // User MERGE
    mockRunRead.mockResolvedValueOnce([{
      id: "found-id", name: "ExistingTopic", type: "CONCEPT", description: "Some concept",
    }]);

    const id = await resolveEntity({ name: "ExistingTopic", type: "CONCEPT", description: "" }, "user-1");

    expect(id).toBe("found-id");
    // runRead was called for the lookup (not runWrite)
    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const lookupCypher = mockRunRead.mock.calls[0][0] as string;
    expect(lookupCypher).toContain("normalizedName");
    expect(lookupCypher).toContain("MATCH");
    // Only 1 runWrite (User MERGE) — lookup did NOT consume a write session
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
  });
});

