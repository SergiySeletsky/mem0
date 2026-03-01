/**
 * lib/dedup/index.ts — Deduplication orchestrator
 *
 * Three-stage pipeline applied BEFORE every Memgraph memory write:
 *   Stage 1: findNearDuplicates() — vector similarity search
 *   Stage 2: verifyDuplicate() — LLM pair classification (with cache)
 *
 * Outcomes:
 *   insert    — proceed normally with addMemory()
 *   skip      — exact/verified duplicate; return existingId instead of writing
 *   supersede — new memory supersedes old; hand off to supersedeMemory()
 *
 * Fails open: any error in Stage 1 or 2 falls through to { action: "insert" }.
 */
import { findNearDuplicates } from "./findNearDuplicates";
import { verifyDuplicate, VerificationResult } from "./verifyDuplicate";
import { pairHash, getCached, setCached } from "./cache";
import { getDedupConfig } from "@/lib/config/helpers";

export type DedupOutcome =
  | { action: "insert" }
  | { action: "skip"; existingId: string }
  | { action: "supersede"; existingId: string };

// ── BM25 lexical negation safety (Spec-03 Run-11 finding) ────────────────────
// Dense cosine similarity cannot distinguish a fact from its negation (negGap ≈ 0).
// This lightweight lexical gate blocks dedup when one text asserts a fact and the
// other negates it, preventing false-merge of contradictory memories.
const NEGATION_TOKENS = new Set([
  "not", "no", "never", "nobody", "nothing", "neither", "nor",
  "don't", "doesn't", "didn't", "isn't", "aren't",
  "wasn't", "weren't", "won't", "wouldn't",
  "can't", "cannot", "shouldn't", "couldn't",
  "haven't", "hasn't", "hadn't",
]);

function tokenizeWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[\u2018\u2019']/g, "'")  // normalize apostrophes
      .split(/[\s,;.!?:]+/)              // split on whitespace + punctuation
      .map(t => t.replace(/[^a-z']/g, ""))
      .filter(Boolean)
  );
}

/** Returns false when texts have asymmetric negation — i.e. one affirms, the other denies. */
function isNegationSafe(textA: string, textB: string): boolean {
  return hasNegation(tokenizeWords(textA)) === hasNegation(tokenizeWords(textB));
}

function hasNegation(tokens: Set<string>): boolean {
  for (const neg of NEGATION_TOKENS) {
    if (tokens.has(neg)) return true;
  }
  return false;
}

/**
 * Run the deduplication pipeline for a new memory text.
 * Returns the outcome action for the caller to act on.
 *
 * When `tags` is provided, candidates sharing at least one tag are boosted
 * to the front of the candidate list (tag-aware dedup). This prevents
 * cross-domain interference where a memory from domain A supersedes
 * an unrelated memory from domain B just because of high embedding similarity.
 */
export async function checkDeduplication(
  newText: string,
  userId: string,
  tags?: string[]
): Promise<DedupOutcome> {
  const config = await getDedupConfig();
  if (!config.enabled) return { action: "insert" };

  // Detect active embedding provider to apply provider-specific cosine threshold.
  // Azure text-embedding-3-small scores supSim=0.613 on updated personal facts —
  // well below the 0.75 default — so a lower threshold is required to catch updates.
  // intelli-embed-v3 scores supSim=0.580 — even lower — use its own dedicated threshold.
  const _provider = (process.env.EMBEDDING_PROVIDER ?? "intelli").toLowerCase();
  const _hasAzureKey = !!process.env.EMBEDDING_AZURE_OPENAI_API_KEY;
  const isAzure = _provider === "azure" && _hasAzureKey;
  const isIntelli = _provider === "intelli" || (_provider !== "azure" && _provider !== "nomic");
  const effectiveThreshold = isAzure
    ? config.azureThreshold
    : isIntelli
      ? config.intelliThreshold
      : config.threshold;

  // Stage 1: Find near-duplicates by vector similarity (with provider-aware threshold)
  const candidates = await findNearDuplicates(newText, userId, effectiveThreshold);
  if (candidates.length === 0) return { action: "insert" };

  // Tag-aware dedup boosting: when the new memory has tags, prefer candidates
  // that share at least one tag. This prevents cross-domain interference where
  // e.g. a health memory supersedes an unrelated finance memory with similar embeddings.
  // Candidates with shared tags are promoted to the front; within each group,
  // original cosine ordering is preserved.
  if (tags && tags.length > 0 && candidates.length > 1) {
    const tagSet = new Set(tags.map(t => t.toLowerCase()));
    const hasSharedTag = (c: typeof candidates[0]) =>
      c.tags.some(t => tagSet.has(t.toLowerCase()));
    const withTag = candidates.filter(hasSharedTag);
    const withoutTag = candidates.filter(c => !hasSharedTag(c));
    candidates.splice(0, candidates.length, ...withTag, ...withoutTag);
  }

  // Stage 2: LLM verification for top candidate (highest cosine score)
  // When #2 candidate is within 0.05 of #1, verify both — the true duplicate
  // may rank slightly lower due to vector noise in large stores.
  const top = candidates[0];
  const runner = candidates[1];
  const verifyRunner = runner && (top.score - runner.score) < 0.05;

  /**
   * Verify a single candidate against the new text.
   * Returns the cache-aware LLM result, or null on error (fail-open).
   */
  async function verifySingle(
    candidate: typeof top
  ): Promise<{ result: VerificationResult; id: string } | null> {
    const hash = pairHash(newText, candidate.content);
    const cached = getCached(hash);
    if (cached) return { result: cached as VerificationResult, id: candidate.id };

    try {
      const result = await verifyDuplicate(newText, candidate.content);
      setCached(hash, result);
      return { result, id: candidate.id };
    } catch (e) {
      console.warn("[dedup] LLM verification failed for candidate", candidate.id, e);
      return null;
    }
  }

  // Verify top candidate first
  const topVerification = await verifySingle(top);
  if (!topVerification) return { action: "insert" };

  // If top is DIFFERENT and runner-up is close enough, try the runner-up
  if (topVerification.result === "DIFFERENT" && verifyRunner) {
    const runnerVerification = await verifySingle(runner);
    if (runnerVerification) {
      if (runnerVerification.result === "DUPLICATE") {
        if (!isNegationSafe(newText, runner.content)) {
          console.debug("[dedup] negation gate on runner-up — treating as insert");
          return { action: "insert" };
        }
        return { action: "skip", existingId: runner.id };
      }
      if (runnerVerification.result === "SUPERSEDES") {
        return { action: "supersede", existingId: runner.id };
      }
    }
    return { action: "insert" };
  }

  const result = topVerification.result;

  if (result === "DUPLICATE") {
    // Stage 2b — BM25 negation safety: prevent false-positive DUPLICATE merges when one
    // text contains a negation token the other lacks ("coffee" ↔ "no coffee").
    // Dense cosine cannot distinguish negation (Run-11: negGap ≈ 0 across all models).
    // SUPERSEDE is deliberately exempt — temporal updates legitimately use negation
    // ("I moved to London, no longer in NYC" should still supersede "I live in NYC").
    if (!isNegationSafe(newText, top.content)) {
      console.debug("[dedup] negation gate: asymmetric negation — treating DUPLICATE as insert to avoid false merge");
      return { action: "insert" };
    }
    return { action: "skip", existingId: top.id };
  }
  if (result === "SUPERSEDES") return { action: "supersede", existingId: top.id };
  return { action: "insert" };
}
