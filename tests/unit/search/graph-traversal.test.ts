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
 *   GRAPH_01:  finds memory via entity name match
 *   GRAPH_02:  finds memory via entity metadata match
 *   GRAPH_03:  traverses RELATED_TO to find neighbor's memories
 *   GRAPH_04:  finds entities via relationship metadata match
 *   GRAPH_05:  returns empty when no entities match
 *   GRAPH_06:  returns empty for empty/stopword-only query (regex fallback)
 *   GRAPH_07:  deduplicates seed entities from both arms
 *   GRAPH_08:  respects limit parameter
 *   GRAPH_09:  relationship search failure doesn't break results
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

  it("GRAPH_01: finds memory via entity name match", async () => {
    mockLLMTerms(["dr", "john", "treatment"]);
    // Step 1: seed entities — entity matched by name
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    // Step 1b: relationship search — no matches
    mockRunRead.mockResolvedValueOnce([]);
    // Step 2: expand — seed only (no neighbors)
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    // Step 3: memories connected to entities
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1" }]);

    const results = await traverseEntityGraph("dr john treatment", USER_ID);

    expect(results).toEqual([{ memoryId: "m1" }]);
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
    mockRunRead.mockResolvedValueOnce([{ entityId: "e-ozempic" }]);
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-prescription" }]);

    const results = await traverseEntityGraph("5mg ozempic", USER_ID);

    expect(results).toEqual([{ memoryId: "m-prescription" }]);
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
    // Expand: Dr. John + neighbor "Patient Smith"
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-john" },
      { entityId: "e-smith" },
    ]);
    // Memories from both entities — includes Smith's memory
    mockRunRead.mockResolvedValueOnce([
      { memoryId: "m-john-note" },
      { memoryId: "m-smith-treatment" },
    ]);

    const results = await traverseEntityGraph("dr john", USER_ID);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.memoryId)).toContain("m-smith-treatment");
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
    // Expand: both entities + no new neighbors
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e-doctor" },
      { entityId: "e-patient" },
    ]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m-prescription" }]);

    const results = await traverseEntityGraph("ozempic prescription", USER_ID);

    expect(results).toEqual([{ memoryId: "m-prescription" }]);
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

    const results = await traverseEntityGraph("quantum blockchain", USER_ID);

    expect(results).toEqual([]);
    // Should NOT call Step 2 or Step 3 when no seeds found
    expect(mockRunRead).toHaveBeenCalledTimes(2);
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
    // Expand: 3 unique entities (not 4)
    mockRunRead.mockResolvedValueOnce([
      { entityId: "e1" },
      { entityId: "e2" },
      { entityId: "e3" },
    ]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1" }]);

    const results = await traverseEntityGraph("test query terms", USER_ID);

    // Step 2 (expand) should receive 3 unique seed IDs, not 4
    const expandParams = mockRunRead.mock.calls[2][1] as Record<string, unknown>;
    const seedIds = expandParams.seedIds as string[];
    expect(seedIds).toHaveLength(3);
    expect(new Set(seedIds).size).toBe(3);
    expect(results).toEqual([{ memoryId: "m1" }]);
  });

  it("GRAPH_08: respects limit parameter", async () => {
    mockLLMTerms(["test", "query"]);
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([
      { memoryId: "m1" },
      { memoryId: "m2" },
    ]);

    const results = await traverseEntityGraph("test query", USER_ID, { limit: 5 });

    // Verify limit is passed to the final query
    const step3Params = mockRunRead.mock.calls[3][1] as Record<string, unknown>;
    expect(step3Params.limit).toBe(5);
    expect(results).toHaveLength(2);
  });

  it("GRAPH_09: relationship search failure doesn't break results", async () => {
    mockLLMTerms(["test", "terms"]);
    // Seed entities found
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    // Relationship search throws
    mockRunRead.mockRejectedValueOnce(new Error("Cypher error"));
    // Expand still works with entity arm seeds
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    // Memories
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1" }]);

    const results = await traverseEntityGraph("test terms", USER_ID);

    expect(results).toEqual([{ memoryId: "m1" }]);
  });

  it("GRAPH_10: LLM failure in traversal falls back to regex terms", async () => {
    mockLLMFailure();
    // Regex fallback produces ["ozempic", "prescription"]
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([]);
    mockRunRead.mockResolvedValueOnce([{ entityId: "e1" }]);
    mockRunRead.mockResolvedValueOnce([{ memoryId: "m1" }]);

    const results = await traverseEntityGraph("ozempic prescription", USER_ID);

    expect(results).toEqual([{ memoryId: "m1" }]);
    // Verify regex-extracted terms were used
    const step1Params = mockRunRead.mock.calls[0][1] as Record<string, unknown>;
    expect(step1Params.terms).toContain("ozempic");
    expect(step1Params.terms).toContain("prescription");
  });
});
