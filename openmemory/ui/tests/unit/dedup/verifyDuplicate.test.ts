export {};
/**
 * Unit tests — verifyDuplicate (Stage 2 LLM verification) + cache
 *
 * VERIFY_01: Identical meaning → DUPLICATE
 * VERIFY_02: Update/contradiction → SUPERSEDES
 * VERIFY_03: Distinct facts → DIFFERENT
 * VERIFY_04: Cache hit — second call for same pair uses cache (LLM called only once)
 *
 * Enhanced scenarios (from oss fact-comparison prompt):
 * VERIFY_05: Minor wording paraphrase → DUPLICATE
 * VERIFY_06: Same topic with enriched detail → SUPERSEDES
 * VERIFY_07: Same topic preference changed → SUPERSEDES
 * VERIFY_08: Direct contradiction / preference reversal → SUPERSEDES
 * VERIFY_09: Unrelated topics → DIFFERENT
 * VERIFY_10: VERIFY_PROMPT is exported for inspection
 */

const mockCreate = jest.fn();

// Mock the LLM client factory so we never check Azure credentials
jest.mock("@/lib/ai/client", () => ({
  getLLMClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
  resetLLMClient: jest.fn(),
}));

import { verifyDuplicate, VERIFY_PROMPT } from "@/lib/dedup/verifyDuplicate";
import { pairHash, getCached, setCached } from "@/lib/dedup/cache";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("verifyDuplicate", () => {
  it("VERIFY_01: same meaning returns DUPLICATE", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "DUPLICATE" } }],
    });

    const result = await verifyDuplicate("I prefer dark mode", "dark theme is my preference");
    expect(result).toBe("DUPLICATE");
  });

  it("VERIFY_02: update/contradiction returns SUPERSEDES", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "SUPERSEDES" } }],
    });

    const result = await verifyDuplicate("I moved to London", "I live in NYC");
    expect(result).toBe("SUPERSEDES");
  });

  it("VERIFY_03: distinct facts returns DIFFERENT", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "DIFFERENT" } }],
    });

    const result = await verifyDuplicate("I like dogs", "I like cats");
    expect(result).toBe("DIFFERENT");
  });

  it("VERIFY_04: unknown LLM output defaults to DIFFERENT", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "UNRELATED_RESPONSE" } }],
    });

    const result = await verifyDuplicate("some text", "other text");
    expect(result).toBe("DIFFERENT");
  });

  // ── Few-shot example scenarios (from oss comparison prompt) ────────────
  it("VERIFY_05: minor wording paraphrase → DUPLICATE (e.g. 'Likes' vs 'Loves' same thing)", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "DUPLICATE" } }],
    });

    const result = await verifyDuplicate("Loves cheese pizza", "Likes cheese pizza");
    expect(result).toBe("DUPLICATE");
  });

  it("VERIFY_06: same topic with enriched detail → SUPERSEDES (e.g. 'with friends' added)", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "SUPERSEDES" } }],
    });

    const result = await verifyDuplicate(
      "Loves to play cricket with friends",
      "User likes to play cricket"
    );
    expect(result).toBe("SUPERSEDES");
  });

  it("VERIFY_07: same topic but preference changed → SUPERSEDES (cheese→chicken)", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "SUPERSEDES" } }],
    });

    const result = await verifyDuplicate("Loves chicken pizza", "I really like cheese pizza");
    expect(result).toBe("SUPERSEDES");
  });

  it("VERIFY_08: direct contradiction / preference reversal → SUPERSEDES", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "SUPERSEDES" } }],
    });

    const result = await verifyDuplicate("Dislikes cheese pizza", "Loves cheese pizza");
    expect(result).toBe("SUPERSEDES");
  });

  it("VERIFY_09: unrelated topics → DIFFERENT (identity vs food)", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "DIFFERENT" } }],
    });

    const result = await verifyDuplicate("Loves cheese pizza", "Name is John");
    expect(result).toBe("DIFFERENT");
  });

  it("VERIFY_10: VERIFY_PROMPT is exported and contains few-shot examples", () => {
    expect(VERIFY_PROMPT).toBeDefined();
    expect(VERIFY_PROMPT).toContain("Few-Shot Examples");
    expect(VERIFY_PROMPT).toContain("DUPLICATE");
    expect(VERIFY_PROMPT).toContain("SUPERSEDES");
    expect(VERIFY_PROMPT).toContain("DIFFERENT");
    // Verify key oss-inspired examples are present
    expect(VERIFY_PROMPT).toContain("cheese pizza");
    expect(VERIFY_PROMPT).toContain("cricket");
    expect(VERIFY_PROMPT).toContain("dark mode");
  });

  it("VERIFY_11: passes correct message structure to LLM", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "DIFFERENT" } }],
    });

    await verifyDuplicate("new fact", "old fact");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe("system");
    expect(callArgs.messages[0].content).toBe(VERIFY_PROMPT);
    expect(callArgs.messages[1].role).toBe("user");
    expect(callArgs.messages[1].content).toContain("Statement A (existing): old fact");
    expect(callArgs.messages[1].content).toContain("Statement B (new): new fact");
    expect(callArgs.temperature).toBe(0);
  });

  it("VERIFY_12: null/empty LLM response defaults to DIFFERENT", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const result = await verifyDuplicate("a", "b");
    expect(result).toBe("DIFFERENT");
  });
});

describe("cache", () => {
  it("CACHE_01: stores and retrieves results by pair hash", () => {
    const h = pairHash("memory A", "memory B");
    expect(getCached(h)).toBeNull();

    setCached(h, "DUPLICATE");
    expect(getCached(h)).toBe("DUPLICATE");
  });

  it("CACHE_02: pair hash is order-independent (canonical)", () => {
    const h1 = pairHash("alpha", "beta");
    const h2 = pairHash("beta", "alpha");
    expect(h1).toBe(h2);
  });
});
