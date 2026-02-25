export {};
/**
 * Unit tests — extractEntitiesFromMemory (lib/entities/extract.ts)
 *
 * EXTRACT_01: Named entities returned with correct shape
 * EXTRACT_02: Memory with no named entities → empty array
 * EXTRACT_03: LLM error → returns [] without throwing (fail-open)
 * EXTRACT_04: Invalid JSON from LLM → returns [] without throwing
 */
import { extractEntitiesFromMemory } from "@/lib/entities/extract";

jest.mock("@/lib/ai/client", () => ({ getLLMClient: jest.fn() }));
import { getLLMClient } from "@/lib/ai/client";
const mockGetLLMClient = getLLMClient as jest.MockedFunction<typeof getLLMClient>;

const mockCreate = jest.fn();
// Wire up the mock client before each test
beforeEach(() => {
  jest.clearAllMocks();
  mockGetLLMClient.mockReturnValue({
    chat: { completions: { create: mockCreate } },
  } as any);
});

describe("extractEntitiesFromMemory", () => {
  it("EXTRACT_01: returns entities with name/type/description", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              entities: [
                { name: "Alice", type: "PERSON", description: "A colleague" },
                { name: "Acme Corp", type: "ORGANIZATION", description: "Employer" },
                { name: "San Francisco", type: "LOCATION", description: "City" },
              ],
            }),
          },
        },
      ],
    });

    const result = await extractEntitiesFromMemory(
      "Alice works at Acme Corp in San Francisco"
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ name: "Alice", type: "PERSON" });
    expect(result[1]).toMatchObject({ name: "Acme Corp", type: "ORGANIZATION" });
    expect(result[2]).toMatchObject({ name: "San Francisco", type: "LOCATION" });
  });

  it("EXTRACT_02: memory with no named entities → empty array", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ entities: [] }) } }],
    });

    const result = await extractEntitiesFromMemory("I prefer dark mode");
    expect(result).toHaveLength(0);
  });

  it("EXTRACT_03: LLM error → returns [] without throwing", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI quota exceeded"));

    await expect(
      extractEntitiesFromMemory("Alice works at Acme Corp")
    ).resolves.toEqual([]);
  });

  it("EXTRACT_04: invalid JSON from LLM → returns [] without throwing", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not valid json {{{" } }],
    });

    await expect(
      extractEntitiesFromMemory("Alice works at Acme Corp")
    ).resolves.toEqual([]);
  });
});
