/**
 * P5 — BM25 pure unit tests
 *
 * Covers: constructor IDF computation, search ranking, empty corpus edge case,
 *         single-doc corpus, multi-doc corpus, term not in vocabulary
 */

import { BM25 } from "../src/utils/bm25";

describe("BM25", () => {
  // ---- Corpus helpers ----
  const corpus = [
    ["the", "cat", "sat", "on", "the", "mat"],
    ["the", "dog", "sat", "on", "the", "log"],
    ["the", "cat", "ate", "the", "fish"],
    ["a", "quick", "brown", "fox"],
  ];

  test("BM25_01: constructor initializes without error", () => {
    const bm25 = new BM25(corpus);
    expect(bm25).toBeDefined();
  });

  test("BM25_02: search returns documents sorted by relevance", () => {
    const bm25 = new BM25(corpus);
    const result = bm25.search(["cat"]);
    // Documents 0 and 2 contain "cat" — they should rank higher than 1 and 3
    expect(result[0]).toEqual(expect.arrayContaining(["cat"]));
    expect(result[1]).toEqual(expect.arrayContaining(["cat"]));
    // The bottom results should NOT contain "cat"
    expect(result[3]).not.toEqual(expect.arrayContaining(["cat"]));
  });

  test("BM25_03: search with multi-term query", () => {
    const bm25 = new BM25(corpus);
    const result = bm25.search(["cat", "fish"]);
    // Document 2 "the cat ate the fish" has both terms — should rank first
    expect(result[0]).toEqual(expect.arrayContaining(["cat", "fish"]));
  });

  test("BM25_04: search with unknown term returns all docs (score 0)", () => {
    const bm25 = new BM25(corpus);
    const result = bm25.search(["xyz"]);
    expect(result).toHaveLength(corpus.length);
  });

  test("BM25_05: single-document corpus", () => {
    const bm25 = new BM25([["hello", "world"]]);
    const result = bm25.search(["hello"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(["hello", "world"]);
  });

  test("BM25_06: custom k1 and b parameters", () => {
    const bm25 = new BM25(corpus, 2.0, 0.5);
    const result = bm25.search(["dog"]);
    // Document 1 is the only one with "dog" → should rank first
    expect(result[0]).toEqual(expect.arrayContaining(["dog"]));
  });

  test("BM25_07: all documents returned (no filtering, just ranking)", () => {
    const bm25 = new BM25(corpus);
    const result = bm25.search(["mat"]);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(expect.arrayContaining(["mat"]));
  });

  test("BM25_08: empty query returns all docs (all score 0)", () => {
    const bm25 = new BM25(corpus);
    const result = bm25.search([]);
    expect(result).toHaveLength(corpus.length);
  });

  test("BM25_09: IDF computed correctly — rare terms have higher IDF", () => {
    const bm25 = new BM25(corpus);
    // "fox" appears in 1 doc; "the" appears in 3 docs
    // Searching for "fox" should rank the fox doc first
    const result = bm25.search(["fox"]);
    expect(result[0]).toEqual(expect.arrayContaining(["fox"]));
  });

  test("BM25_10: documents with higher term frequency rank higher", () => {
    const corpus2 = [
      ["apple"],
      ["apple", "apple", "apple"],
      ["apple", "banana"],
    ];
    const bm25 = new BM25(corpus2);
    const result = bm25.search(["apple"]);
    // Doc 1 has 3 occurrences of "apple" — should rank highest
    expect(result[0]).toEqual(["apple", "apple", "apple"]);
  });
});
