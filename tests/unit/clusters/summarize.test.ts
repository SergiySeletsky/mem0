export {};

/**
 * Unit tests for lib/clusters/summarize.ts — Spec 07
 *
 * SUMM_01 — LLM throws → returns default name/summary/rank/findings, no rethrow
 * SUMM_02 — LLM returns malformed JSON → returns fallback, no rethrow
 * SUMM_03 — LLM returns valid rank + findings → parsed correctly
 * SUMM_04 — rank out of range (>10 or <1) → clamped to 10 / 1
 */

const mockCreate = jest.fn();

jest.mock("@/lib/ai/client", () => ({
  getLLMClient: jest.fn().mockReturnValue({
    chat: { completions: { create: mockCreate } },
  }),
  resetLLMClient: jest.fn(),
}));

// Import AFTER mock is registered
import { summarizeCluster, _resetOpenAIClient } from "@/lib/clusters/summarize";

beforeEach(() => {
  jest.clearAllMocks();
  // getLLMClient mock is stateless — no singleton to reset, but keep _resetOpenAIClient
  // exported so external callers don't break.
});

describe("summarizeCluster", () => {
  test("SUMM_01: LLM throws → returns fallback without re-throwing", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI rate limit"));

    const result = await summarizeCluster(["memory A", "memory B"]);

    expect(result.name).toBe("Memory Community");
    expect(result.summary).toBe("A collection of related memories.");
    expect(result.rank).toBe(5);
    expect(result.findings).toEqual([]);
  });

  test("SUMM_02: LLM returns malformed JSON → returns fallback", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json {{{" } }],
    });

    const result = await summarizeCluster(["memory A", "memory B"]);

    expect(typeof result.name).toBe("string");
    expect(typeof result.summary).toBe("string");
    expect(result.name.length).toBeGreaterThan(0);
    expect(result.rank).toBe(5);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  test("SUMM_03: LLM returns valid rank + findings → parsed correctly", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            name: "Tech Preferences",
            summary: "User's software and tool preferences.",
            rank: 8,
            findings: ["Prefers TypeScript", "Uses VS Code", "Favors functional patterns"],
          }),
        },
      }],
    });

    const result = await summarizeCluster(["Uses TypeScript", "Uses VS Code"]);

    expect(result.name).toBe("Tech Preferences");
    expect(result.rank).toBe(8);
    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]).toBe("Prefers TypeScript");
  });

  test("SUMM_04: rank out of range → clamped (15 → 10, 0 → 1)", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ name: "X", summary: "Y", rank: 15, findings: [] }) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ name: "X", summary: "Y", rank: 0, findings: [] }) } }],
      });

    const high = await summarizeCluster(["a"]);
    expect(high.rank).toBe(10);

    const low = await summarizeCluster(["a"]);
    expect(low.rank).toBe(1);
  });
});


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
    expect(result.rank).toBe(5);
    expect(result.findings).toEqual([]);
  });

  test("SUMM_02: LLM returns malformed JSON → returns fallback", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json {{{" } }],
    });

    const result = await summarizeCluster(["memory A", "memory B"]);

    expect(typeof result.name).toBe("string");
    expect(typeof result.summary).toBe("string");
    expect(result.name.length).toBeGreaterThan(0);
    expect(result.rank).toBe(5);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  test("SUMM_03: LLM returns valid rank + findings → parsed correctly", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            name: "Tech Preferences",
            summary: "User\'s software and tool preferences.",
            rank: 8,
            findings: ["Prefers TypeScript", "Uses VS Code", "Favors functional patterns"],
          }),
        },
      }],
    });

    const result = await summarizeCluster(["Uses TypeScript", "Uses VS Code"]);

    expect(result.name).toBe("Tech Preferences");
    expect(result.rank).toBe(8);
    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]).toBe("Prefers TypeScript");
  });

  test("SUMM_04: rank out of range → clamped (15 → 10, 0 → 1)", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ name: "X", summary: "Y", rank: 15, findings: [] }) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ name: "X", summary: "Y", rank: 0, findings: [] }) } }],
      });

    const high = await summarizeCluster(["a"]);
    expect(high.rank).toBe(10);

    _resetOpenAIClient();
    const low = await summarizeCluster(["a"]);
    expect(low.rank).toBe(1);
  });
});
