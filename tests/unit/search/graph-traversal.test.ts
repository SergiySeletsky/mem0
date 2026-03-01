/**
 * Unit tests — lib/search/graph-traversal.ts
 *
 * Tests the entity graph traversal search that complements hybrid search
 * by discovering memories through entity/relationship metadata.
 *
 * extractSearchTerms (async, LLM-based with regex fallback):
 *   TERMS_01:  LLM returns multi-word search terms
 *   TERMS_02:  LLM failure falls back to regex extraction
 *   TERMS_03:  LLM empty array falls back to regex extraction
 *   TERMS_04:  LLM returns terms lowercase
 *
 * extractSearchTermsRegex (sync, regex fallback):
 *   TERMS_REGEX_01:  filters common stop words
 *   TERMS_REGEX_02:  keeps meaningful terms >= 2 chars
 *   TERMS_REGEX_03:  handles punctuation
 *   TERMS_REGEX_04:  returns empty for all-stopword query
 *   TERMS_REGEX_05:  preserves alphanumeric terms like "5mg", "v2"
 *
 * traverseEntityGraph:
 *   GRAPH_01:  finds memory via entity name match (hop 0)
 *   GRAPH_02:  finds memory via entity metadata match (hop 0)
 *   GRAPH_03:  traverses RELATED_TO to find neighbor's memories (hop 1)
 *   GRAPH_04:  finds entities via relationship metadata match
 *   GRAPH_05:  returns empty when no entities match
 *   GRAPH_06:  returns empty for empty/stopword-only query (regex fallback)
 *   GRAPH_07:  deduplicates seed entities from both arms
 *   GRAPH_08:  respects limit parameter
 *   GRAPH_09:  relationship search failure doesn't break results
 *   GRAPH_10:  LLM failure falls back to regex terms
 *   GRAPH_11:  2-hop expansion discovers hop-2 neighbors
 *   GRAPH_12:  custom maxDepth option propagated to Cypher
 *   GRAPH_13:  minimum hop distance wins when entity reachable via multiple paths
 */

export {};

const mockRunRead = jest.fn();
const mockCreate = jest.fn();

jest.mock("@/lib/db/memgraph", () => ({
  runRead: (...args: unknown[]) => mockRunRead(...args),
}));

jest.mock("@/lib/ai/client", () => ({
  getLLMClient: () => ({
    chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } },
  }),
}));

import {
  extractSearchTerms,
  extractSearchTermsRegex,
  traverseEntityGraph,
} from "@/lib/search/graph-traversal";

const USER_ID = "test-user";

/** Helper: mock LLM to return a JSON array of terms */
function mockLLMTerms(terms: string[]) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(terms) } }],
  });
}

/** Helper: mock LLM failure (network error, rate limit, etc.) */
function mockLLMFailure() {
  mockCreate.mockRejectedValueOnce(new Error("LLM unavailable"));
}

describe("extractSearchTerms (LLM-based)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReset();
  });

  it("TERMS_01: LLM returns multi-word search terms", async () => {
    mockLLMTerms(["dr. john", "5mg", "ozempic"]);
    const terms = await extractSearchTerms("to whom dr. john gave 5mg ozempic?");
    expect(terms).toEqual(["dr. john", "5mg", "ozempic"]);
  });

  it("TERMS_02: LLM failure falls back to regex extraction", async () => {
    mockLLMFailure();
    const terms = await extractSearchTerms("dr. john gave 5mg ozempic");
    // Regex fallback: >= 3 chars, no stop-word filtering
    expect(terms).toContain("john");
    expect(terms).toContain("5mg");
    expect(terms).toContain("ozempic");
    expect(terms).toContain("gave");
  });

  it("TERMS_03: LLM empty array falls back to regex extraction", async () => {
    mockLLMTerms([]);
    const terms = await extractSearchTerms("ozempic prescription details");
    // LLM returned [], so regex fallback fires
    expect(terms).toContain("ozempic");
    expect(terms).toContain("prescription");
    expect(terms).toContain("details");
  });

  it("TERMS_04: LLM returns terms lowercase", async () => {
    mockLLMTerms(["Sarah", "ALLERGIES"]);
    const terms = await extractSearchTerms("what allergies does Sarah have?");
    // Terms should be lowercased
    expect(terms).toEqual(["sarah", "allergies"]);
  });

  it("TERMS_05: LLM result with markdown fences parsed correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n["intellias", "positions"]\n```' } }],
    });
    const terms = await extractSearchTerms("how many positions at intellias?");
    expect(terms).toEqual(["intellias", "positions"]);
  });

  it("TERMS_06: LLM returns non-array JSON falls back to regex", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"terms": ["a"]}' } }],
    });
    const terms = await extractSearchTerms("ozempic treatment");
    // JSON.parse succeeds but !Array → empty → regex fallback (>= 3 chars)
    expect(terms).toContain("ozempic");
    expect(terms).toContain("treatment");
  });
});

describe("extractSearchTermsRegex (fallback)", () => {
  it("TERMS_REGEX_01: filters tokens < 3 chars", () => {
    const terms = extractSearchTermsRegex("to whom did he give the medicine");
    // < 3 chars filtered: "to", "he"
    expect(terms).not.toContain("to");
    expect(terms).not.toContain("he");
    // >= 3 chars kept (no stop-word list)
    expect(terms).toContain("whom");
    expect(terms).toContain("did");
    expect(terms).toContain("the");
    expect(terms).toContain("medicine");
  });

  it("TERMS_REGEX_02: keeps terms >= 3 chars", () => {
    const terms = extractSearchTermsRegex("AI ml tools for JS apps");
    // 2-char tokens excluded
    expect(terms).not.toContain("ai");
    expect(terms).not.toContain("ml");
    expect(terms).not.toContain("js");
    // 3+ char tokens kept
    expect(terms).toContain("tools");
    expect(terms).toContain("for");
    expect(terms).toContain("apps");
  });

  it("TERMS_REGEX_03: handles punctuation", () => {
    const terms = extractSearchTermsRegex("dr. john gave 5mg ozempic?");
    expect(terms).toContain("john");
    expect(terms).toContain("5mg");
    expect(terms).toContain("ozempic");
    expect(terms).toContain("gave");
  });

  it("TERMS_REGEX_04: returns empty for all-short-token query", () => {
    const terms = extractSearchTermsRegex("an is it?");
    expect(terms).toEqual([]);
  });

  it("TERMS_REGEX_05: preserves alphanumeric terms like 5mg", () => {
    const terms = extractSearchTermsRegex("prescribed 5mg ozempic v2 protocol");
    expect(terms).toContain("5mg");
    expect(terms).toContain("ozempic");
    expect(terms).not.toContain("v2"); // 2 chars — excluded
    expect(terms).toContain("protocol");
    expect(terms).toContain("prescribed");
  });
});

describe("traverseEntityGraph", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunRead.mockReset();
    mockCreate.mockReset();
  });

  it("GRAPH_01: finds memory via entity name match (hop 0)", async () => {
    mockLLMTerms(["dr", "john", "treatment"]);
    // Step 1: seed entities — entity matched by name
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    // Step 1b: relationship search — no matches
    mockRunRead.mockResolvedValueOnce([]);
    // P4: community priming — no matches
    mockRunRead.mockResolvedValueOnce([]);
    // Step 2: expand — seed at hop 0 (no neighbors)
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1", hops: 0, avgWeight: 1.0 }]);
    // Step 3: memories connected to entities
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1", entityId: "e1" }]);

    const results = await traverseEntityGraph("dr john treatment", USER_ID);

    expect(results).toEqual([{ memoryId: "m1", hopDistance: 0, avgWeight: 1.0 }]);
    // Step 1 query should search name, description, AND metadata
    const step1Cypher = mockRunRead.mock.calls[0][0] as string;
    expect(step1Cypher).toContain("e.name");
    expect(step1Cypher).toContain("e.description");
    expect(step1Cypher).toContain("e.metadata");
  });

  it("GRAPH_02: finds memory via entity metadata match", async () => {
    mockLLMTerms(["5mg", "ozempic"]);
    // "5mg" matches in entity metadata (e.g., dosage info stored as JSON)
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-ozempic" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-ozempic", hops: 0, avgWeight: 1.0 }]);
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-prescription", entityId: "e-ozempic" }]);

    const results = await traverseEntityGraph("5mg ozempic", USER_ID);

    expect(results).toEqual([{ memoryId: "m-prescription", hopDistance: 0, avgWeight: 1.0 }]);
    // Verify terms are passed to the Cypher query
    const step1Params = mockRunRead.mock.calls[0][1] as Record<string, unknown>;
    expect(step1Params.terms).toContain("5mg");
    expect(step1Params.terms).toContain("ozempic");
  });

  it("GRAPH_03: traverses RELATED_TO to find neighbor's memories", async () => {
    mockLLMTerms(["dr. john"]);
    // Seed: entity "Dr. John" matched
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-john" }]);
    // No relationship metadata matches
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    // Expand: Dr. John at hop 0, neighbor "Patient Smith" at hop 1
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-john", hops: 0, avgWeight: 1.0 },
      { entityId: "e-smith", hops: 1, avgWeight: 0.8 },
    ]);
    // Memories from both entities — includes Smith's memory
    mockRunRead.mockResolvedValueOnce([
      { memoryId: "m-john-note", entityId: "e-john" },
      { memoryId: "m-smith-treatment", entityId: "e-smith" },
    ]);

    const results = await traverseEntityGraph("dr john", USER_ID);

    expect(results).toHaveLength(2);
    const smithResult = results.find((r) => r.memoryId === "m-smith-treatment");
    expect(smithResult).toBeDefined();
    expect(smithResult!.hopDistance).toBe(1);
    const johnResult = results.find((r) => r.memoryId === "m-john-note");
    expect(johnResult!.hopDistance).toBe(0);
  });

  it("GRAPH_04: finds entities via relationship metadata match", async () => {
    mockLLMTerms(["ozempic", "prescription"]);
    // No entity name/description/metadata matches
    mockRunRead.mockResolvedValueOnce([]);
    // Step 1b: relationship metadata matches — "ozempic" in relationship metadata
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-doctor" },
      { entityId: "e-patient" },
    ]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    // Expand: both entities + no new neighbors
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-doctor", hops: 0, avgWeight: 1.0 },
      { entityId: "e-patient", hops: 0, avgWeight: 1.0 },
    ]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-prescription", entityId: "e-doctor" }]);

    const results = await traverseEntityGraph("ozempic prescription", USER_ID);

    expect(results).toEqual([{ memoryId: "m-prescription", hopDistance: 0, avgWeight: 1.0 }]);
    // Step 1b query should search relationship type, description, and metadata
    const step1bCypher = mockRunRead.mock.calls[1][0] as string;
    expect(step1bCypher).toContain("r.type");
    expect(step1bCypher).toContain("r.description");
    expect(step1bCypher).toContain("r.metadata");
  });

  it("GRAPH_05: returns empty when no entities match", async () => {
    mockLLMTerms(["quantum", "blockchain"]);
    mockRunRead.mockResolvedValueOnce([]); // no entity matches
    mockRunRead.mockResolvedValueOnce([]); // no relationship matches
    mockRunRead.mockResolvedValueOnce([]); // community priming — no matches

    const results = await traverseEntityGraph("quantum blockchain", USER_ID);

    expect(results).toEqual([]);
    // Should NOT call Step 2 or Step 3 when no seeds found
    expect(mockRunRead).toHaveBeenCalledTimes(3);
  });

  it("GRAPH_06: returns empty for all-short-token query (regex fallback)", async () => {
    // LLM returns empty
    mockLLMTerms([]);
    // regex fallback: "an is it" → all < 3 chars → empty
    const results = await traverseEntityGraph("an is it?", USER_ID);

    expect(results).toEqual([]);
    // Should not call runRead at all
    expect(mockRunRead).not.toHaveBeenCalled();
  });

  it("GRAPH_07: deduplicates seed entities from both arms", async () => {
    mockLLMTerms(["test", "query", "terms"]);
    // Entity arm finds e1, e2
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e1" },
      { entityId: "e2" },
    ]);
    // Relationship arm also finds e2, e3
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e2" },
      { entityId: "e3" },
    ]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    // Expand: 3 unique entities (not 4)
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e1", hops: 0, avgWeight: 1.0 },
      { entityId: "e2", hops: 0, avgWeight: 1.0 },
      { entityId: "e3", hops: 0, avgWeight: 1.0 },
    ]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1", entityId: "e1" }]);

    const results = await traverseEntityGraph("test query terms", USER_ID);

    // Step 2 (expand) should receive 3 unique seed IDs, not 4
    const expandParams = mockRunRead.mock.calls[3][1] as Record<string, unknown>;
    const seedIds = expandParams.seedIds as string[];
    expect(seedIds).toHaveLength(3);
    expect(new Set(seedIds).size).toBe(3);
    expect(results).toEqual([{ memoryId: "m1", hopDistance: 0, avgWeight: 1.0 }]);
  });

  it("GRAPH_08: respects limit parameter", async () => {
    mockLLMTerms(["test", "query"]);
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1", hops: 0, avgWeight: 1.0 }]);
    mockRunRead.mockResolvedValueOnce([
      { memoryId: "m1", entityId: "e1" },
      { memoryId: "m2", entityId: "e1" },
    ]);

    const results = await traverseEntityGraph("test query", USER_ID, { limit: 5 });

    // Verify limit is passed to the final query
    const step3Params = mockRunRead.mock.calls[4][1] as Record<string, unknown>;
    expect(step3Params.limit).toBe(5);
    expect(results).toHaveLength(2);
  });

  it("GRAPH_09: relationship search failure doesn't break results", async () => {
    mockLLMTerms(["test", "terms"]);
    // Seed entities found
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    // Relationship search throws
    mockRunRead.mockRejectedValueOnce(new Error("Cypher error"));
    mockRunRead.mockResolvedValueOnce([]); // community priming
    // Expand still works with entity arm seeds
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1", hops: 0, avgWeight: 1.0 }]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1", entityId: "e1" }]);

    const results = await traverseEntityGraph("test terms", USER_ID);

    expect(results).toEqual([{ memoryId: "m1", hopDistance: 0, avgWeight: 1.0 }]);
  });

  it("GRAPH_10: LLM failure in traversal falls back to regex terms", async () => {
    mockLLMFailure();
    // Regex fallback produces ["ozempic", "prescription"]
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1", hops: 0, avgWeight: 1.0 }]);
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1", entityId: "e1" }]);

    const results = await traverseEntityGraph("ozempic prescription", USER_ID);

    expect(results).toEqual([{ memoryId: "m1", hopDistance: 0, avgWeight: 1.0 }]);
    // Verify regex-extracted terms were used
    const step1Params = mockRunRead.mock.calls[0][1] as Record<string, unknown>;
    expect(step1Params.terms).toContain("ozempic");
    expect(step1Params.terms).toContain("prescription");
  });

  it("GRAPH_11: 2-hop expansion discovers hop-2 neighbors", async () => {
    mockLLMTerms(["alice"]);
    // Seed: entity "Alice"
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-alice" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    // Expand: Alice at hop 0, Bob at hop 1, Charlie at hop 2
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-alice", hops: 0, avgWeight: 1.0 },
      { entityId: "e-bob", hops: 1, avgWeight: 0.8 },
      { entityId: "e-charlie", hops: 2, avgWeight: 0.6 },
    ]);
    // Memories from all 3 entities
    mockRunRead.mockResolvedValueOnce([
      { memoryId: "m-alice", entityId: "e-alice" },
      { memoryId: "m-bob", entityId: "e-bob" },
      { memoryId: "m-charlie", entityId: "e-charlie" },
    ]);

    const results = await traverseEntityGraph("alice", USER_ID);

    expect(results).toHaveLength(3);
    expect(results.find((r) => r.memoryId === "m-alice")!.hopDistance).toBe(0);
    expect(results.find((r) => r.memoryId === "m-bob")!.hopDistance).toBe(1);
    expect(results.find((r) => r.memoryId === "m-charlie")!.hopDistance).toBe(2);
    // Verify the expand Cypher uses variable-length path
    const expandCypher = mockRunRead.mock.calls[3][0] as string;
    expect(expandCypher).toContain("RELATED_TO*1..");
  });

  it("GRAPH_12: custom maxDepth option propagated to Cypher", async () => {
    mockLLMTerms(["test"]);
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1", hops: 0, avgWeight: 1.0 }]);
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1", entityId: "e1" }]);

    await traverseEntityGraph("test", USER_ID, { maxDepth: 3 });

    // The expand Cypher should contain *1..3
    const expandCypher = mockRunRead.mock.calls[3][0] as string;
    expect(expandCypher).toContain("*1..3");
  });

  it("GRAPH_13: minimum hop distance wins when entity reachable via multiple paths", async () => {
    mockLLMTerms(["network"]);
    // Two seed entities found
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-a" },
      { entityId: "e-b" },
    ]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([]); // community priming
    // Entity "e-shared" reachable at hop 1 from e-a and hop 2 from e-b
    // The UNION query returns both, but we keep the minimum
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-a", hops: 0, avgWeight: 1.0 },
      { entityId: "e-b", hops: 0, avgWeight: 1.0 },
      { entityId: "e-shared", hops: 1, avgWeight: 0.8 },
      { entityId: "e-shared", hops: 2, avgWeight: 0.5 },
    ]);
    // Memory connected to shared entity
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-shared", entityId: "e-shared" }]);

    const results = await traverseEntityGraph("network", USER_ID);

    const shared = results.find((r) => r.memoryId === "m-shared");
    expect(shared).toBeDefined();
    // Minimum hop distance (1) should win over 2
    expect(shared!.hopDistance).toBe(1);
  });

  // =====================================================================
  // Opt 1 — Vector seeding path (queryVector bypasses LLM term extraction)
  // =====================================================================

  it("GRAPH_VEC_01: queryVector provided → LLM NOT called, vector_search.search used for seeding", async () => {
    const queryVec = new Array(8).fill(0.1);

    // Step 1 (vector seed): returns seed entities
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-vec-1" }, { entityId: "e-vec-2" }]);
    // Community priming (vector): no matches
    mockRunRead.mockResolvedValueOnce([]);
    // Expand
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-vec-1", hops: 0, avgWeight: 1.0 },
      { entityId: "e-vec-2", hops: 0, avgWeight: 1.0 },
    ]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-vec", entityId: "e-vec-1" }]);

    const results = await traverseEntityGraph("find alice meetings", USER_ID, { queryVector: queryVec });

    expect(results).toEqual([{ memoryId: "m-vec", hopDistance: 0, avgWeight: 1.0 }]);
    // LLM must NOT be called when queryVector is provided
    expect(mockCreate).not.toHaveBeenCalled();
    // First runRead must use vector_search.search
    const step1Cypher = mockRunRead.mock.calls[0][0] as string;
    expect(step1Cypher).toContain("vector_search.search");
    expect(step1Cypher).toContain("MENTIONS");
  });

  it("GRAPH_VEC_02: community priming also uses vector_search.search when queryVector provided", async () => {
    const queryVec = new Array(8).fill(0.2);

    // Step 1 (vector seed)
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-a" }]);
    // Community priming (vector): returns extra entity via community
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-community" }]);
    // Expand — both direct + community seeds
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-a", hops: 0, avgWeight: 1.0 },
      { entityId: "e-community", hops: 0, avgWeight: 1.0 },
    ]);
    // Memories
    mockRunRead.mockResolvedValueOnce([
      { memoryId: "m-a", entityId: "e-a" },
      { memoryId: "m-com", entityId: "e-community" },
    ]);

    const results = await traverseEntityGraph("alice meetings", USER_ID, { queryVector: queryVec });

    expect(results).toHaveLength(2);
    // Community priming query should also use vector_search.search
    const communityCypher = mockRunRead.mock.calls[1][0] as string;
    expect(communityCypher).toContain("vector_search.search");
    expect(communityCypher).toContain("IN_COMMUNITY");
  });

  it("GRAPH_VEC_03: empty vector seed results → returns empty without calling expand", async () => {
    const queryVec = new Array(8).fill(0.3);

    // Step 1 (vector seed): no matches
    mockRunRead.mockResolvedValueOnce([]);
    // Community priming: no matches
    mockRunRead.mockResolvedValueOnce([]);

    const results = await traverseEntityGraph("obscure topic", USER_ID, { queryVector: queryVec });

    expect(results).toEqual([]);
    // Only 2 runRead calls (seed + community priming) — no expand or memory step
    expect(mockRunRead).toHaveBeenCalledTimes(2);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("GRAPH_VEC_04: queryVector params passed correctly to vector_search.search call", async () => {
    const queryVec = [0.5, 0.3, 0.7, 0.1];

    mockRunRead.mockResolvedValueOnce([{ entityId: "e-param" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-param", hops: 0, avgWeight: 1.0 }]);
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-param", entityId: "e-param" }]);

    await traverseEntityGraph("test query", USER_ID, { queryVector: queryVec });

    // Verify the vector seed call receives correct params
    const step1Params = mockRunRead.mock.calls[0][1] as Record<string, unknown>;
    expect(step1Params.queryVec).toEqual(queryVec);
    expect(step1Params.userId).toBe(USER_ID);
    expect(step1Params.topK).toBeGreaterThan(0);
  });
});
