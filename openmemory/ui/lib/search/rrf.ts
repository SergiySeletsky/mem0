/**
 * Reciprocal Rank Fusion -- Spec 02
 *
 * Merges text-search and vector-search ranked lists into a single
 * combined ranking using the RRF formula:
 *   score(d) = sum over lists of  1 / (K + rank(d))
 *
 * where K=60 (standard constant) and rank is 1-based position in the list.
 * Documents absent from a list are excluded from that list's contribution.
 *
 * Reference: Cormack, Clarke, Buettcher (2009) — SIGIR.
 */

export interface RRFResult {
  id: string;
  rrfScore: number;
  /** 1-based rank in text_search list, or null if absent */
  textRank: number | null;
  /** 1-based rank in vector_search list, or null if absent */
  vectorRank: number | null;
}

/** Standard RRF constant — prevents very high rewards for rank-1 results */
const K = 60;

/**
 * Merge two ranked lists using Reciprocal Rank Fusion.
 *
 * @param textResults    Ranked list from full-text search (1-based rank)
 * @param vectorResults  Ranked list from vector similarity search (1-based rank)
 * @param topK           Maximum results to return (default 10)
 */
export function reciprocalRankFusion(
  textResults: { id: string; rank: number }[],
  vectorResults: { id: string; rank: number }[],
  topK = 10
): RRFResult[] {
  const scores = new Map<
    string,
    { textRank: number | null; vectorRank: number | null; score: number }
  >();

  for (const r of textResults) {
    const entry = scores.get(r.id) ?? { textRank: null, vectorRank: null, score: 0 };
    entry.textRank = r.rank;
    entry.score += 1 / (K + r.rank);
    scores.set(r.id, entry);
  }

  for (const r of vectorResults) {
    const entry = scores.get(r.id) ?? { textRank: null, vectorRank: null, score: 0 };
    entry.vectorRank = r.rank;
    entry.score += 1 / (K + r.rank);
    scores.set(r.id, entry);
  }

  return Array.from(scores.entries())
    .map(([id, data]) => ({
      id,
      rrfScore: data.score,
      textRank: data.textRank,
      vectorRank: data.vectorRank,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK);
}
