export {};
/**
 * Unit tests — findNearDuplicates (Stage 1 vector similarity)
 *
 * FIND_01: Returns candidates above threshold
 * FIND_02: Returns [] when no candidates above threshold
 * FIND_03: threshold=1.0 filters candidates with score < 1
 * FIND_04: runRead() throws — returns [] gracefully (fail-open)
 */
import { findNearDuplicates } from "@/lib/dedup/findNearDuplicates";

jest.mock("@/lib/db/memgraph", () => ({
  runRead: jest.fn(),
}));
jest.mock("@/lib/embeddings/openai", () => ({
  embed: jest.fn(),
}));

import { runRead } from "@/lib/db/memgraph";
import { embed } from "@/lib/embeddings/openai";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockEmbed = embed as jest.MockedFunction<typeof embed>;

const FAKE_EMBEDDING = Array(1536).fill(0.1);

beforeEach(() => {
  jest.clearAllMocks();
  mockEmbed.mockResolvedValue(FAKE_EMBEDDING);
});

describe("findNearDuplicates", () => {
  it("FIND_01: returns candidates with score >= threshold", async () => {
    mockRunRead.mockResolvedValue([
      { id: "mem-aaa", content: "I prefer dark mode", similarity: 0.95 },
      { id: "mem-bbb", content: "dark theme is preferred", similarity: 0.93 },
    ]);

    const results = await findNearDuplicates("I like dark mode", "user-1");

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("mem-aaa");
    expect(results[0].score).toBeGreaterThanOrEqual(0.92);
    expect(results[1].score).toBeGreaterThanOrEqual(0.92);
  });

  it("FIND_02: returns [] when no results from vector search", async () => {
    mockRunRead.mockResolvedValue([]);

    const results = await findNearDuplicates("completely unrelated text", "user-1");

    expect(results).toHaveLength(0);
  });

  it("FIND_03: respects custom threshold (1.0 = near-exact only)", async () => {
    // Memgraph WHERE clause in query filters by threshold; we simulate it returning nothing
    mockRunRead.mockResolvedValue([]);

    const results = await findNearDuplicates("I prefer dark mode", "user-1", 1.0);

    expect(results).toHaveLength(0);
    // Verify threshold was passed in the query params
    const callArgs = mockRunRead.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs.threshold).toBe(1.0);
  });

  it("FIND_04: runRead() throws — returns [] without crashing (fail-open)", async () => {
    mockRunRead.mockRejectedValue(new Error("Memgraph connection refused"));

    const results = await findNearDuplicates("any text", "user-1");

    expect(results).toHaveLength(0);
  });
});
