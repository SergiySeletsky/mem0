export {};
/**
 * Unit tests — summarize-entity.ts (lib/entities/summarize-entity.ts)
 *
 * ESUM_01: Entity not found → returns without LLM or write
 * ESUM_02: Fewer than SUMMARY_THRESHOLD memories → skips (no LLM)
 * ESUM_03: Enough memories → fetches context, calls LLM, writes summary
 * ESUM_04: LLM returns empty → no write
 * ESUM_05: getEntityMentionCount returns correct count
 * ESUM_06: Relationships included in prompt when present
 */
import { generateEntitySummary, getEntityMentionCount, SUMMARY_THRESHOLD } from "@/lib/entities/summarize-entity";

jest.mock("@/lib/db/memgraph", () => ({ runRead: jest.fn(), runWrite: jest.fn() }));
jest.mock("@/lib/ai/client");

import { runRead, runWrite } from "@/lib/db/memgraph";
import { getLLMClient } from "@/lib/ai/client";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;
const mockGetLLMClient = getLLMClient as jest.MockedFunction<typeof getLLMClient>;

const mockCreate = jest.fn();
mockGetLLMClient.mockReturnValue({
  chat: { completions: { create: mockCreate } },
} as unknown as ReturnType<typeof getLLMClient>);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLLMClient.mockReturnValue({
    chat: { completions: { create: mockCreate } },
  } as unknown as ReturnType<typeof getLLMClient>);
});

describe("getEntityMentionCount", () => {
  it("ESUM_05: returns numeric count of connected memories", async () => {
    mockRunRead.mockResolvedValueOnce([{ cnt: 5 }]);

    const count = await getEntityMentionCount("ent-1");

    expect(count).toBe(5);
    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const cypher = mockRunRead.mock.calls[0][0] as string;
    expect(cypher).toContain("MENTIONS");
    expect(cypher).toContain("invalidAt IS NULL");
  });

  it("ESUM_05b: returns 0 when entity has no mentions", async () => {
    mockRunRead.mockResolvedValueOnce([{ cnt: 0 }]);

    const count = await getEntityMentionCount("ent-none");
    expect(count).toBe(0);
  });
});

describe("generateEntitySummary", () => {
  it("ESUM_01: entity not found → returns without LLM or write", async () => {
    mockRunRead.mockResolvedValueOnce([]); // entity not found

    await generateEntitySummary("ent-missing");

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  it("ESUM_02: fewer than SUMMARY_THRESHOLD memories → skips", async () => {
    // Entity exists
    mockRunRead.mockResolvedValueOnce([{ name: "Alice", type: "PERSON", description: "Engineer" }]);
    // Only 2 memories (below threshold)
    mockRunRead.mockResolvedValueOnce([
      { content: "Alice is an engineer", createdAt: "2024-01-01" },
      { content: "Alice works at Acme", createdAt: "2024-01-02" },
    ]);

    await generateEntitySummary("ent-alice");

    // Should NOT call LLM or write — not enough context
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  it("ESUM_03: enough memories → calls LLM, writes summary", async () => {
    // Entity exists
    mockRunRead.mockResolvedValueOnce([{ name: "Alice", type: "PERSON", description: "Software engineer" }]);
    // 3 memories (at threshold)
    const memories = Array.from({ length: SUMMARY_THRESHOLD }, (_, i) => ({
      content: `Memory about Alice #${i + 1}`,
      createdAt: `2024-01-0${i + 1}`,
    }));
    mockRunRead.mockResolvedValueOnce(memories);
    // Relationships
    mockRunRead.mockResolvedValueOnce([
      { targetName: "Acme Corp", relType: "WORKS_AT", description: "Alice works at Acme Corp" },
    ]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Alice is a software engineer who works at Acme Corp. She has been working on multiple projects." } }],
    });

    await generateEntitySummary("ent-alice");

    // LLM called with prompt containing memories and relationships
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const msgs = mockCreate.mock.calls[0][0].messages as Array<{ content: string }>;
    expect(msgs[0].content).toContain("Alice");
    expect(msgs[0].content).toContain("Memory about Alice #1");
    expect(msgs[0].content).toContain("WORKS_AT");
    expect(msgs[0].content).toContain("Acme Corp");

    // Write summary to entity
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [cypher, params] = mockRunWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain("e.summary");
    expect(cypher).toContain("summaryUpdatedAt");
    expect(params.summary).toContain("Alice is a software engineer");
  });

  it("ESUM_04: LLM returns empty → no write", async () => {
    mockRunRead.mockResolvedValueOnce([{ name: "Bob", type: "PERSON", description: "" }]);
    mockRunRead.mockResolvedValueOnce([
      { content: "Bob joined the team", createdAt: "2024-01-01" },
      { content: "Bob handles backend", createdAt: "2024-01-02" },
      { content: "Bob deployed v2", createdAt: "2024-01-03" },
    ]);
    mockRunRead.mockResolvedValueOnce([]); // no relationships
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });

    await generateEntitySummary("ent-bob");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRunWrite).not.toHaveBeenCalled();
  });

  it("ESUM_06: no relationships → prompt shows (none)", async () => {
    mockRunRead.mockResolvedValueOnce([{ name: "Postgres", type: "DATABASE", description: "A relational database" }]);
    mockRunRead.mockResolvedValueOnce([
      { content: "We use Postgres", createdAt: "2024-01-01" },
      { content: "Postgres stores user data", createdAt: "2024-01-02" },
      { content: "Postgres replicated across 3 zones", createdAt: "2024-01-03" },
    ]);
    mockRunRead.mockResolvedValueOnce([]); // no relationships
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Postgres is the primary relational database." } }],
    });
    mockRunWrite.mockResolvedValue([]);

    await generateEntitySummary("ent-pg");

    const msgs = mockCreate.mock.calls[0][0].messages as Array<{ content: string }>;
    expect(msgs[0].content).toContain("(none)");
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
  });
});
