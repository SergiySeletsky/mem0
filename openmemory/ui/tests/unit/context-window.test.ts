export {};
/**
 * Unit tests — Ingestion Context Window (lib/memory/context.ts + addMemory integration)
 *
 * CTX_01: getRecentMemories returns correct number and order (most recent first)
 * CTX_02: getRecentMemories returns [] when user has no memories
 * CTX_03: buildContextPrefix([]) returns empty string
 * CTX_04: buildContextPrefix([m1, m2]) returns formatted prefix string
 * CTX_05: addMemory with context_window.size=0 → embed called with original text only
 * CTX_06: addMemory with context_window.enabled=false → embed called with original text only
 * CTX_07: addMemory with enabled=true + recent memories → embed called with context-enriched text
 */
import { getRecentMemories, buildContextPrefix } from "@/lib/memory/context";
import { addMemory } from "@/lib/memory/write";

jest.mock("@/lib/db/memgraph", () => ({ runRead: jest.fn(), runWrite: jest.fn() }));
jest.mock("@/lib/embeddings/openai", () => ({ embed: jest.fn() }));
jest.mock("@/lib/config/helpers", () => ({
  getDedupConfig: jest.fn().mockResolvedValue({ enabled: false, threshold: 0.92 }),
  getContextWindowConfig: jest.fn(),
}));

import { runRead, runWrite } from "@/lib/db/memgraph";
import { embed } from "@/lib/embeddings/openai";
import { getContextWindowConfig } from "@/lib/config/helpers";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;
const mockEmbed = embed as jest.MockedFunction<typeof embed>;
const mockGetContextWindowConfig = getContextWindowConfig as jest.MockedFunction<typeof getContextWindowConfig>;

const FAKE_EMBEDDING = Array(1536).fill(0);

beforeEach(() => {
  jest.clearAllMocks();
  mockEmbed.mockResolvedValue(FAKE_EMBEDDING);
  mockRunWrite.mockResolvedValue([{ id: "mem-test" }]);
});

describe("getRecentMemories", () => {
  it("CTX_01: returns correct number of memories in descending createdAt order", async () => {
    mockRunRead.mockResolvedValue([
      { id: "m5", content: "Memory 5", createdAt: "2026-01-05T00:00:00.000Z" },
      { id: "m4", content: "Memory 4", createdAt: "2026-01-04T00:00:00.000Z" },
      { id: "m3", content: "Memory 3", createdAt: "2026-01-03T00:00:00.000Z" },
    ]);

    const result = await getRecentMemories("user-1", 3);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("m5"); // most recent first
    // Verify Cypher uses correct filters
    const cypher = mockRunRead.mock.calls[0][0] as string;
    expect(cypher).toContain("invalidAt IS NULL");
    expect(cypher).toContain("ORDER BY m.createdAt DESC");
  });

  it("CTX_02: user has no memories → returns empty array", async () => {
    mockRunRead.mockResolvedValue([]);

    const result = await getRecentMemories("user-nobody", 10);
    expect(result).toHaveLength(0);
  });
});

describe("buildContextPrefix", () => {
  it("CTX_03: empty array → returns empty string", () => {
    expect(buildContextPrefix([])).toBe("");
  });

  it("CTX_04: non-empty array → returns formatted prefix with all memories", () => {
    const memories = [
      { id: "m1", content: "I prefer dark mode", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "m2", content: "I like TypeScript", createdAt: "2026-01-02T00:00:00.000Z" },
    ];

    const prefix = buildContextPrefix(memories);

    expect(prefix).toContain("I prefer dark mode");
    expect(prefix).toContain("I like TypeScript");
    expect(prefix.length).toBeGreaterThan(0);
    // Should end with a marker that separates context from new info
    expect(prefix).toContain("[New information");
  });
});

describe("addMemory context window integration", () => {
  it("CTX_05: size=0 → embed called with original text (no context prefix)", async () => {
    mockGetContextWindowConfig.mockResolvedValue({ enabled: true, size: 0 });
    mockRunRead.mockResolvedValue([]); // no prior memories

    await addMemory("I enjoy hiking", { userId: "user-1" });

    expect(mockEmbed).toHaveBeenCalledWith("I enjoy hiking");
  });

  it("CTX_06: enabled=false → embed called with original text (no context prefix)", async () => {
    mockGetContextWindowConfig.mockResolvedValue({ enabled: false, size: 10 });

    await addMemory("I enjoy hiking", { userId: "user-1" });

    expect(mockEmbed).toHaveBeenCalledWith("I enjoy hiking");
    // runRead should not have been called to fetch context
    expect(mockRunRead).not.toHaveBeenCalled();
  });

  it("CTX_07: enabled=true with recent memories → embed called with context-enriched text", async () => {
    mockGetContextWindowConfig.mockResolvedValue({ enabled: true, size: 5 });
    mockRunRead.mockResolvedValue([
      { id: "m1", content: "I hate spicy food", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    await addMemory("I love Thai food with extra chili", { userId: "user-1" });

    expect(mockEmbed).toHaveBeenCalledTimes(1);
    const embeddedText = mockEmbed.mock.calls[0][0] as string;
    // The text passed to embed should contain BOTH the context and the new memory
    expect(embeddedText).toContain("I hate spicy food");
    expect(embeddedText).toContain("I love Thai food with extra chili");
    // But the CONTENT stored in Memgraph should be the original text only
    const writeCalls = mockRunWrite.mock.calls.map(c => c[1] as Record<string, unknown>);
    const memoryWrite = writeCalls.find(p => p.content !== undefined);
    expect(memoryWrite?.content).toBe("I love Thai food with extra chili");
  });
});
