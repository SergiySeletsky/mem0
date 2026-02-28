export {};

/**
 * Unit tests for lib/clusters/summarize.ts — Spec 07
 *
 * SUMM_01 — LLM throws → returns default name/summary, no rethrow
 * SUMM_02 — LLM returns malformed JSON → returns fallback, no rethrow
 */

const mockCreate = jest.fn();

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// Import AFTER mock is registered
import {
  summarizeCluster,
  _resetOpenAIClient,
} from "@/lib/clusters/summarize";

beforeEach(() => {
  jest.clearAllMocks();
  // Reset singleton so each test gets a fresh mock instance
  _resetOpenAIClient();
});

describe("summarizeCluster", () => {
  test("SUMM_01: LLM throws → returns fallback without re-throwing", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI rate limit"));

    const result = await summarizeCluster(["memory A", "memory B"]);

    expect(result.name).toBe("Memory Community");
    expect(result.summary).toBe("A collection of related memories.");
  });

  test("SUMM_02: LLM returns malformed JSON → returns fallback", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json {{{" } }],
    });

    const result = await summarizeCluster(["memory A", "memory B"]);

    expect(typeof result.name).toBe("string");
    expect(typeof result.summary).toBe("string");
    expect(result.name.length).toBeGreaterThan(0);
  });
});
