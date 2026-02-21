/**
 * lib/memory/bulk.ts — Bulk Ingestion — Spec 06
 *
 * Adds up to 500 memories in a single embedBatch() call + single Memgraph UNWIND transaction.
 *
 * Pipeline stages:
 *   1. In-batch exact dedup (case-insensitive text match)
 *   2. Cross-store near-dedup via checkDeduplication() with Semaphore concurrency cap
 *   3. Single embedBatch() for all surviving items
 *   4. Single UNWIND Cypher to create all Memory nodes in one transaction
 *   5. Fire-and-forget processEntityExtraction() per new node
 */

import { v4 as uuid } from "uuid";
import { embedBatch } from "@/lib/embeddings/openai";
import { runWrite } from "@/lib/db/memgraph";
import { checkDeduplication } from "@/lib/dedup";
import { processEntityExtraction } from "@/lib/entities/worker";
import { Semaphore } from "@/lib/mem0/semaphore";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BulkMemoryInput {
  text: string;
  metadata?: Record<string, unknown>;
  /** ISO-8601 timestamp. Defaults to now. Used for historical imports. */
  valid_at?: string;
}

export interface BulkAddOptions {
  userId: string;
  appName?: string;
  /** Max parallel dedup checks. Defaults to min(5, floor(RPM/20)). */
  concurrency?: number;
  /** Whether to run cross-store near-dedup. Defaults to true. */
  dedupEnabled?: boolean;
  /** Optional callback invoked after each item completes. */
  onProgress?: (completed: number, total: number) => void;
}

export type BulkMemoryResultStatus = "added" | "skipped_duplicate" | "failed";

export interface BulkMemoryResult {
  text: string;
  status: BulkMemoryResultStatus;
  id?: string;
  memoryId?: string; // kept for backwards compat
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getMaxConcurrency(): number {
  const rpmLimit = parseInt(process.env.OPENAI_REQUESTS_PER_MINUTE ?? "60");
  return Math.min(5, Math.floor(rpmLimit / 20));
}

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Add multiple memories to Memgraph using a single embedBatch() call and a single
 * UNWIND transaction. Returns a result for every input item.
 */
export async function bulkAddMemories(
  items: BulkMemoryInput[],
  opts: BulkAddOptions
): Promise<BulkMemoryResult[]> {
  const {
    userId,
    concurrency = getMaxConcurrency(),
    dedupEnabled = true,
    onProgress,
  } = opts;

  // Initialise results — will be mutated as items are classified.
  const results: BulkMemoryResult[] = items.map((item) => ({
    text: item.text,
    status: "added" as const,
  }));

  // ── Stage 1: In-batch exact dedup (case-insensitive) ──────────────────
  const seen = new Set<string>();
  const uniqueIndices: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const key = items[i].text.trim().toLowerCase();
    if (seen.has(key)) {
      results[i] = { text: items[i].text, status: "skipped_duplicate" };
    } else {
      seen.add(key);
      uniqueIndices.push(i);
    }
  }

  // ── Stage 2: Cross-store near-dedup ───────────────────────────────────
  const toProcess: number[] = [];

  if (dedupEnabled && uniqueIndices.length > 0) {
    const sem = new Semaphore(concurrency);
    await Promise.all(
      uniqueIndices.map((origIdx) =>
        sem.run(async () => {
          try {
            const outcome = await checkDeduplication(items[origIdx].text, userId);
            if (outcome.action === "skip" || outcome.action === "supersede") {
              results[origIdx] = {
                text: items[origIdx].text,
                status: "skipped_duplicate",
              };
            } else {
              toProcess.push(origIdx);
            }
          } catch {
            // Fail open: treat as unique if dedup check itself fails
            toProcess.push(origIdx);
          }
        })
      )
    );
    // Restore original order (Promise.all may resolve in any sequence)
    toProcess.sort((a, b) => a - b);
  } else {
    toProcess.push(...uniqueIndices);
  }

  if (toProcess.length === 0) return results;

  // ── Stage 3: Single embedBatch for all surviving items ────────────────
  const textsToEmbed = toProcess.map((i) => items[i].text);
  const embeddings = await embedBatch(textsToEmbed);

  // ── Stage 4: Prepare nodes ────────────────────────────────────────────
  const now = new Date().toISOString();

  interface MemoryWriteNode {
    id: string;
    content: string;
    embedding: number[];
    validAt: string;
    createdAt: string;
    state: string;
    origIdx: number; // NOT sent to Memgraph — for result mapping only
  }

  const memoriesForWrite: MemoryWriteNode[] = toProcess.map((origIdx, i) => ({
    id: uuid(),
    content: items[origIdx].text,
    embedding: embeddings[i],
    validAt: items[origIdx].valid_at ?? now,
    createdAt: now,
    state: "active",
    origIdx,
  }));

  // Ensure user node exists in Memgraph (idempotent MERGE)
  const userNow = new Date().toISOString();
  await runWrite(
    `MERGE (u:User {userId: $userId}) ON CREATE SET u.createdAt = $userNow`,
    { userId, userNow }
  );

  // ── Stage 5: Single UNWIND + CREATE transaction ───────────────────────
  const writeNodes = memoriesForWrite.map(
    ({ origIdx: _discarded, ...rest }) => rest
  );

  await runWrite(
    `
    UNWIND $memories AS mem
    MATCH (u:User {userId: $userId})
    CREATE (m:Memory {
      id:                  mem.id,
      content:             mem.content,
      embedding:           mem.embedding,
      validAt:             mem.validAt,
      invalidAt:           null,
      createdAt:           mem.createdAt,
      state:               mem.state,
      extractionStatus:    'pending',
      extractionAttempts:  0
    })
    CREATE (u)-[:HAS_MEMORY]->(m)
    `,
    { memories: writeNodes, userId }
  );

  // ── Stage 6: Update results + fire-and-forget entity extraction ───────
  let completed = items.length - toProcess.length; // already-skipped count
  for (const mem of memoriesForWrite) {
    results[mem.origIdx] = {
      text: items[mem.origIdx].text,
      status: "added",
      id: mem.id,
      memoryId: mem.id, // kept for backwards compat
    };
    completed++;
    onProgress?.(completed, items.length);
    processEntityExtraction(mem.id).catch((e) =>
      console.warn("[bulk entity worker]", e)
    );
  }

  return results;
}
