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

/**
 * Run the deduplication pipeline for a new memory text.
 * Returns the outcome action for the caller to act on.
 */
export async function checkDeduplication(
  newText: string,
  userId: string
): Promise<DedupOutcome> {
  const config = await getDedupConfig();
  if (!config.enabled) return { action: "insert" };

  // Stage 1: Find near-duplicates by vector similarity
  const candidates = await findNearDuplicates(newText, userId, config.threshold);
  if (candidates.length === 0) return { action: "insert" };

  // Stage 2: LLM verification for top candidate (highest cosine score)
  const top = candidates[0];
  const hash = pairHash(newText, top.content);

  let result: VerificationResult;
  const cached = getCached(hash);
  if (cached) {
    result = cached as VerificationResult;
  } else {
    try {
      result = await verifyDuplicate(newText, top.content);
      setCached(hash, result);
    } catch (e) {
      console.warn("[dedup] LLM verification failed, proceeding with insert:", e);
      return { action: "insert" };
    }
  }

  if (result === "DUPLICATE") return { action: "skip", existingId: top.id };
  if (result === "SUPERSEDES") return { action: "supersede", existingId: top.id };
  return { action: "insert" };
}
