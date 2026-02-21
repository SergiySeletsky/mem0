/**
 * lib/search/mmr.ts — Maximal Marginal Relevance — Spec 08
 *
 * Re-sorts search results to balance relevance vs diversity.
 * Useful when top K candidates are near-duplicates of each other.
 *
 * Formula: MMR(d) = λ · relevance(d, q) - (1-λ) · max_{s ∈ selected} sim(d, s)
 *
 * λ=1.0 → pure relevance ordering
 * λ=0.0 → pure diversity (maximally different set)
 * λ=0.7 → default: mostly relevance with some diversity
 */

export interface MMRCandidate {
  id: string;
  content: string;
  vectorScore: number;
  embedding?: number[];
}

/**
 * Select topK items using Maximal Marginal Relevance.
 * If candidates.length ≤ topK, returns them sorted by vectorScore.
 */
export function mmrRerank<T extends MMRCandidate>(
  candidates: T[],
  topK: number,
  lambda: number = 0.7
): T[] {
  if (candidates.length <= topK) {
    return [...candidates].sort((a, b) => b.vectorScore - a.vectorScore);
  }

  const selected: T[] = [];
  const remaining = [...candidates].sort((a, b) => b.vectorScore - a.vectorScore);

  // First pick: highest relevance (deterministic)
  selected.push(remaining.shift()!);

  while (selected.length < topK && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const relevance = r.vectorScore;

      // Compute max similarity to already-selected items
      let maxSim: number;
      if (r.embedding && selected.some((s) => s.embedding)) {
        maxSim = Math.max(
          ...selected.map((s) =>
            s.embedding ? cosineSimilarity(r.embedding!, s.embedding!) : 0
          )
        );
      } else {
        // No embeddings: use a rank-based similarity proxy
        // Items closer to the top of the relevance list are more likely to be similar
        maxSim = (candidates.length - i) / candidates.length * 0.3;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
  const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (normA * normB || 1);
}
