/**
 * lib/dedup/cache.ts — Lightweight LRU cache for verified memory pairs
 *
 * Avoids re-calling the LLM for the same (A, B) pair.
 * Order-independent: pairHash("a","b") === pairHash("b","a").
 */
import crypto from "crypto";

const CACHE_SIZE = 1000;
const cache = new Map<string, { result: string; ts: number }>();

/**
 * Canonical order-independent hash for a pair of strings.
 */
export function pairHash(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return crypto.createHash("md5").update(x + "|||" + y).digest("hex");
}

/**
 * Return cached result for a pair hash, or null if not cached.
 */
export function getCached(hash: string): string | null {
  const entry = cache.get(hash);
  return entry ? entry.result : null;
}

/**
 * Store a result in the cache. Evicts the oldest entry when full.
 */
export function setCached(hash: string, result: string): void {
  if (cache.size >= CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(hash, { result, ts: Date.now() });
}
