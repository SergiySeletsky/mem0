/**
 * P2 — lib/memory/categorize.ts unit tests
 *
 * Covers: LLM-based categorization (valid JSON, malformed JSON, invalid cats,
 *         LLM error, non-array response)
 */
export {};

// ---- Mocks ----
const mockRunWrite = jest.fn();
jest.mock("@/lib/db/memgraph", () => ({
  runWrite: (...args: unknown[]) => mockRunWrite(...args),
}));

const mockCreate = jest.fn();
jest.mock("@/lib/ai/client", () => ({
  getLLMClient: () => ({
    chat: {
      completions: { create: (...a: unknown[]) => mockCreate(...a) },
    },
  }),
}));

import { categorizeMemory } from "@/lib/memory/categorize";

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWrite.mockResolvedValue([]);
});

function llmReply(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

// ==========================================================================
describe("categorizeMemory", () => {
  test("CAT_01: writes HAS_CATEGORY edges for valid categories", async () => {
    mockCreate.mockResolvedValue(llmReply('["Personal","Work"]'));
    await categorizeMemory("mem-1", "meeting notes");

    // Single UNWIND batch write for all valid categories
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const firstCypher = mockRunWrite.mock.calls[0][0] as string;
    expect(firstCypher).toContain(":Category");
    expect(firstCypher).toContain("HAS_CATEGORY");
    expect(firstCypher).toContain("UNWIND");
    const firstParams = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(firstParams.names).toEqual(["Personal", "Work"]);
  });

  test("CAT_02: filters out invalid category names", async () => {
    mockCreate.mockResolvedValue(llmReply('["Personal","InvalidCat","Travel"]'));
    await categorizeMemory("mem-1", "trip plans");

    // Only Personal + Travel are valid — single batch call
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.names).toEqual(["Personal", "Travel"]);
  });

  test("CAT_03: handles JSON wrapped in extra text", async () => {
    mockCreate.mockResolvedValue(
      llmReply('Here are the categories: ["Technology","Education"]')
    );
    await categorizeMemory("mem-1", "ai course");

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.names).toEqual(["Technology", "Education"]);
  });

  test("CAT_04: non-array response → no categories written", async () => {
    mockCreate.mockResolvedValue(llmReply('"Personal"'));
    await categorizeMemory("mem-1", "single string");

    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  test("CAT_05: LLM error → does not throw (fire-and-forget safety)", async () => {
    mockCreate.mockRejectedValue(new Error("LLM unavailable"));
    // Should not throw
    await expect(
      categorizeMemory("mem-1", "whatever")
    ).resolves.toBeUndefined();
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  test("CAT_06: completely unparseable response → no crash", async () => {
    mockCreate.mockResolvedValue(llmReply("not json at all"));
    await expect(
      categorizeMemory("mem-1", "broken")
    ).resolves.toBeUndefined();
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  test("CAT_07: empty array → no categories written", async () => {
    mockCreate.mockResolvedValue(llmReply("[]"));
    await categorizeMemory("mem-1", "nothing");
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  test("CAT_08: null/empty LLM content defaults to empty array", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });
    await categorizeMemory("mem-1", "null content");
    expect(mockRunWrite).not.toHaveBeenCalled();
  });
});
