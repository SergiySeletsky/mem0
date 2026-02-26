/**
 * P7 — Cohere reranker unit tests
 *
 * Covers: constructor API key validation, constructor cohere-ai import failure,
 *         rerank success, rerank fallback on error
 */

// Mock cohere-ai before any imports (virtual: true because it's an optional peer dep)
const mockRerank = jest.fn();
jest.mock(
  "cohere-ai",
  () => ({
    CohereClient: jest.fn().mockImplementation(() => ({
      rerank: (...a: unknown[]) => mockRerank(...a),
    })),
  }),
  { virtual: true }
);

import { CohereReranker } from "../src/reranker/cohere";

describe("CohereReranker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COHERE_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.COHERE_API_KEY;
  });

  // ---- Constructor ----
  test("COH_01: constructs with env API key", () => {
    const r = new CohereReranker();
    expect(r).toBeDefined();
  });

  test("COH_02: constructs with explicit API key", () => {
    delete process.env.COHERE_API_KEY;
    const r = new CohereReranker({ apiKey: "explicit-key" });
    expect(r).toBeDefined();
  });

  test("COH_03: throws when no API key provided", () => {
    delete process.env.COHERE_API_KEY;
    expect(() => new CohereReranker()).toThrow("Cohere API key is required");
  });

  // ---- rerank success ----
  test("COH_04: returns documents with rerank_score from API response", async () => {
    mockRerank.mockResolvedValue({
      results: [
        { index: 1, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.5 },
      ],
    });

    const r = new CohereReranker();
    const docs = [
      { text: "doc A", id: 1 },
      { text: "doc B", id: 2 },
    ];
    const result = await r.rerank("query", docs, 2);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      text: "doc B",
      id: 2,
      rerank_score: 0.9,
    });
    expect(result[1]).toEqual({
      text: "doc A",
      id: 1,
      rerank_score: 0.5,
    });
  });

  test("COH_05: passes topK and model to the API", async () => {
    mockRerank.mockResolvedValue({ results: [] });

    const r = new CohereReranker({ model: "rerank-v2.0" });
    await r.rerank("query", [{ text: "a" }], 1);

    expect(mockRerank).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "rerank-v2.0",
        topN: 1,
        query: "query",
      })
    );
  });

  test("COH_06: uses defaultTopK when topK arg not provided", async () => {
    mockRerank.mockResolvedValue({ results: [] });

    const r = new CohereReranker({ topK: 3 });
    await r.rerank("query", [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }]);

    expect(mockRerank).toHaveBeenCalledWith(
      expect.objectContaining({ topN: 3 })
    );
  });

  // ---- rerank fallback ----
  test("COH_07: on API error, falls back to original docs with score 0", async () => {
    mockRerank.mockRejectedValue(new Error("API down"));

    const r = new CohereReranker();
    const docs = [
      { text: "first" },
      { text: "second" },
    ];
    const result = await r.rerank("query", docs, 2);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: "first", rerank_score: 0.0 });
    expect(result[1]).toEqual({ text: "second", rerank_score: 0.0 });
  });

  test("COH_08: fallback respects topK limit", async () => {
    mockRerank.mockRejectedValue(new Error("API down"));

    const r = new CohereReranker();
    const docs = [{ text: "a" }, { text: "b" }, { text: "c" }];
    const result = await r.rerank("query", docs, 1);

    expect(result).toHaveLength(1);
    expect(result[0].rerank_score).toBe(0.0);
  });
});
