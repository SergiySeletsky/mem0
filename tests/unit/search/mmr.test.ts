export {};

/**
 * Unit tests for lib/search/mmr.ts — Spec 08
 *
 * MMR_01 — candidates <= topK → returns all unchanged
 * MMR_02 — lambda=1.0 → degenerates to pure relevance ranking
 * MMR_03 — lambda=0.0 → prefers diversity over relevance
 */

import { mmrRerank } from "@/lib/search/mmr";

// Helper: unit vector in direction i for 4-dimensional space
function makeVec(dominantIdx: number): number[] {
  const v = [0, 0, 0, 0];
  v[dominantIdx] = 1;
  return v;
}

describe("mmrRerank", () => {
  test("MMR_01: fewer than topK candidates → returned as-is", () => {
    const candidates = [
      { id: "a", content: "A", vectorScore: 0.9 },
      { id: "b", content: "B", vectorScore: 0.7 },
    ];
    const result = mmrRerank(candidates, 5);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a");
  });

  test("MMR_02: lambda=1.0 is pure relevance ranking", () => {
    // Provide identical embeddings so diversity term has no effect
    const candidates = [
      { id: "a", content: "A", vectorScore: 0.9, embedding: [1, 0] },
      { id: "b", content: "B", vectorScore: 0.7, embedding: [1, 0] },
      { id: "c", content: "C", vectorScore: 0.5, embedding: [1, 0] },
    ];
    const result = mmrRerank(candidates, 3, 1.0);
    // With lambda=1, MMR = relevance score → same order as sorted by vectorScore
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("MMR_03: lambda=0.0 selects diverse items over high-relevance duplicates", () => {
    // a and b are very similar (same direction), c is orthogonal
    // a has highest relevance but b is near-duplicate; c is diverse
    const candidates = [
      { id: "a", content: "A", vectorScore: 0.9, embedding: makeVec(0) },
      { id: "b", content: "B (near-dupe of a)", vectorScore: 0.85, embedding: makeVec(0) },
      { id: "c", content: "C (diverse)", vectorScore: 0.5, embedding: makeVec(2) },
    ];
    const result = mmrRerank(candidates, 2, 0.0);
    // First is always highest relevance = "a"
    expect(result[0].id).toBe("a");
    // With lambda=0, second should be the diverse item "c", not "b" (near-dupe)
    expect(result[1].id).toBe("c");
  });
});
