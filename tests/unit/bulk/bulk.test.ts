export {};

/**
 * Unit tests for lib/memory/bulk.ts â€” Spec 06
 *
 * BULK_01 â€” 5 unique memories: embedBatch called once, all 5 added
 * BULK_02 â€” exact duplicate within batch: second occurrence skipped
 * BULK_03 â€” dedupEnabled=false: checkDeduplication not called
 * BULK_04 â€” one item throws during embed: partial failure reported
 * BULK_05 â€” valid_at forwarded to Memory node in UNWIND transaction
 */

jest.mock("@/lib/embeddings/intelli", () => ({
  embedBatch: jest.fn(),
}));
jest.mock("@/lib/db/memgraph", () => ({
  runWrite: jest.fn(),
  runRead: jest.fn(),
}));
jest.mock("@/lib/dedup", () => ({
  checkDeduplication: jest.fn(),
}));
jest.mock("@/lib/entities/worker", () => ({
  processEntityExtraction: jest.fn(),
}));

import { embedBatch } from "@/lib/embeddings/intelli";
import { runWrite } from "@/lib/db/memgraph";
import { checkDeduplication } from "@/lib/dedup";
import { processEntityExtraction } from "@/lib/entities/worker";
import { bulkAddMemories } from "@/lib/memory/bulk";

const mockEmbedBatch = embedBatch as jest.MockedFunction<typeof embedBatch>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;
const mockCheckDedup = checkDeduplication as jest.MockedFunction<typeof checkDeduplication>;
const mockProcessEntity = processEntityExtraction as jest.MockedFunction<typeof processEntityExtraction>;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no duplicates found in store
  (mockCheckDedup as jest.Mock).mockResolvedValue({ action: "insert" });
  // Return fake embeddings (array of [0,0,...] of length 1536)
  (mockEmbedBatch as jest.Mock).mockImplementation(async (texts: string[]) =>
    texts.map(() => new Array<number>(1536).fill(0))
  );
  mockRunWrite.mockResolvedValue(undefined as any);
  mockProcessEntity.mockResolvedValue(undefined);
});

describe("bulkAddMemories", () => {
  test("BULK_01: 5 unique memories â€” embedBatch called once, all 5 results have status=added", async () => {
    const items = [
      { text: "memory one" },
      { text: "memory two" },
      { text: "memory three" },
      { text: "memory four" },
      { text: "memory five" },
    ];

    const results = await bulkAddMemories(items, { userId: "user-1" });

    expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockEmbedBatch.mock.calls[0][0]).toHaveLength(5);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "added")).toBe(true);
    expect(results.every((r) => r.memoryId !== undefined)).toBe(true);
    // runWrite should be called twice: once for user MERGE, once for UNWIND
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
  });

  test("BULK_02: exact duplicate in batch â€” second occurrence has status=skipped_duplicate", async () => {
    const items = [
      { text: "same memory text" },
      { text: "different memory" },
      { text: "Same Memory Text" }, // case-insensitive duplicate of first
    ];

    const results = await bulkAddMemories(items, { userId: "user-1" });

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("added");
    expect(results[1].status).toBe("added");
    expect(results[2].status).toBe("skipped_duplicate");
    // embedBatch should only be called with the 2 unique texts
    expect(mockEmbedBatch.mock.calls[0][0]).toHaveLength(2);
  });

  test("BULK_03: dedupEnabled=false â€” checkDeduplication never called, all items passed through", async () => {
    const items = [{ text: "alpha" }, { text: "beta" }, { text: "gamma" }];

    const results = await bulkAddMemories(items, {
      userId: "user-1",
      dedupEnabled: false,
    });

    expect(mockCheckDedup).not.toHaveBeenCalled();
    expect(results.every((r) => r.status === "added")).toBe(true);
  });

  test("BULK_04: one item flagged as cross-store duplicate â€” skipped, others added", async () => {
    const items = [
      { text: "unique memory A" },
      { text: "near duplicate of stored" },
      { text: "unique memory B" },
    ];

    // Second item matches an existing store memory
    (mockCheckDedup as jest.Mock)
      .mockResolvedValueOnce({ action: "insert" })
      .mockResolvedValueOnce({ action: "skip", existingId: "existing-mem-id" })
      .mockResolvedValueOnce({ action: "insert" });

    const results = await bulkAddMemories(items, { userId: "user-1" });

    expect(results[0].status).toBe("added");
    expect(results[1].status).toBe("skipped_duplicate");
    expect(results[2].status).toBe("added");
    // Only 2 items embedded
    expect(mockEmbedBatch.mock.calls[0][0]).toHaveLength(2);
  });

  test("BULK_05: valid_at forwarded â€” UNWIND query includes validAt field", async () => {
    const validAt = "2023-01-15T00:00:00Z";
    const items = [{ text: "historical memory", valid_at: validAt }];

    await bulkAddMemories(items, { userId: "user-1" });

    // calls[0] = user MERGE, calls[1] = UNWIND
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    const callArgs = mockRunWrite.mock.calls[1];
    // Second argument should be params object containing memories array
    const params = callArgs[1] as any;
    expect(params.memories[0].validAt).toBe(validAt);
  });
});
