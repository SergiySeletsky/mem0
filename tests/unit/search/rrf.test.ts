/**
 * UNIT TESTS -- Spec 02: Reciprocal Rank Fusion (RRF)
 *
 * Pure algorithm tests -- no DB or network mocking required.
 * These FAIL before Spec 02 (lib/search/rrf.ts does not exist)
 * and PASS after implementation.
 *
 *   RRF_01 -- document in both result lists scores higher than single-list documents
 *   RRF_02 -- document ranked 1st in one list, absent in other, scores correctly
 *   RRF_03 -- topK parameter truncates output to correct length
 *   RRF_04 -- empty input lists produce empty output
 *   RRF_05 -- textRank and vectorRank fields are populated correctly per result
 */

// Make this a TypeScript module (avoids TS2451)
export {};

describe("SPEC 02: Reciprocal Rank Fusion", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  // -------------------------------------------------------------------------
  test("RRF_01: document in both result lists scores higher than single-list documents", () => {
    const { reciprocalRankFusion } = require("@/lib/search/rrf");

    // "a" appears in both, "b" only in text, "c" only in vector
    const textResults = [
      { id: "a", rank: 1 },
      { id: "b", rank: 2 },
    ];
    const vectorResults = [
      { id: "a", rank: 1 },
      { id: "c", rank: 2 },
    ];

    const result = reciprocalRankFusion(textResults, vectorResults, 5);

    // "a" (in both lists) must be ranked first
    expect(result[0].id).toBe("a");
    // "a" score must be higher than either single-list document
    expect(result[0].rrfScore).toBeGreaterThan(result[1].rrfScore);
  });

  // -------------------------------------------------------------------------
  test("RRF_02: formula uses 1 / (K + rank) where K=60", () => {
    const { reciprocalRankFusion } = require("@/lib/search/rrf");

    const textResults = [{ id: "solo-text", rank: 1 }];
    const vectorResults = [{ id: "solo-vector", rank: 1 }];

    const [r] = reciprocalRankFusion(textResults, vectorResults, 5);
    // Both ranked 1 in their list, absent in other list
    // Expected score for each: 1/(60+1) = 1/61 ≈ 0.01639
    expect(r.rrfScore).toBeCloseTo(1 / 61, 6);
  });

  // -------------------------------------------------------------------------
  test("RRF_03: topK parameter truncates output to correct length", () => {
    const { reciprocalRankFusion } = require("@/lib/search/rrf");

    const textResults = [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, rank: i }));
    const vectorResults = [1, 2, 3, 4, 5].map((i) => ({ id: `v${i}`, rank: i }));

    const result = reciprocalRankFusion(textResults, vectorResults, 3);
    expect(result).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  test("RRF_04: empty input lists produce empty output", () => {
    const { reciprocalRankFusion } = require("@/lib/search/rrf");

    const result = reciprocalRankFusion([], [], 10);
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  test("RRF_05: textRank and vectorRank fields reflect source list membership", () => {
    const { reciprocalRankFusion } = require("@/lib/search/rrf");

    const textResults = [{ id: "text-only", rank: 2 }];
    const vectorResults = [{ id: "vector-only", rank: 3 }];

    const results = reciprocalRankFusion(textResults, vectorResults, 5);
    const textOnly = results.find((r: any) => r.id === "text-only");
    const vectorOnly = results.find((r: any) => r.id === "vector-only");

    expect(textOnly?.textRank).toBe(2);
    expect(textOnly?.vectorRank).toBeNull();
    expect(vectorOnly?.textRank).toBeNull();
    expect(vectorOnly?.vectorRank).toBe(3);
  });
});
