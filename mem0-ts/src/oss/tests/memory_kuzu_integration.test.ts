/// <reference types="jest" />
/**
 * KuzuDB Integration Tests
 *
 * Exercises the full Memory pipeline (add → search → get → update → delete →
 * history → getAll → reset) with:
 *   - LLM + Embedder: MOCKED (no OpenAI API key needed)
 *   - Vector store:   REAL KuzuDB (in-process, no server)
 *   - History store:  REAL KuzuDB (in-process, no server)
 *
 * This catches real Cypher/KuzuDB bugs that unit tests with MemoryVectorStore miss.
 */

// ── Mock OpenAI before any imports ──────────────────────────────────────────
const mockChatCreate = jest.fn();
const mockEmbedCreate = jest.fn();

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
    embeddings: { create: mockEmbedCreate },
  }));
});

import { Memory } from "../src";
import { SearchResult } from "../src/types";

jest.setTimeout(30_000);

// ── Helpers ─────────────────────────────────────────────────────────────────

const DIM = 128;

/** Deterministic embedding vector — same text → same vector.
 *  Uses Math.abs(sin) so all components are non-negative, guaranteeing
 *  cosine similarity >= 0 between any two vectors (required because
 *  KuzuVectorStore.search() defaults to minScore = 0). */
function textToVec(text: string): number[] {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Array.from({ length: DIM }, (_, i) =>
    Math.abs(Math.sin(hash + i * 0.1)),
  );
}

/**
 * Mock the embedder to return a deterministic vector based on the input text.
 * Captures the input text and returns textToVec(text).
 */
function mockEmbedding(): void {
  mockEmbedCreate.mockImplementation(
    (args: { input: string | string[] }) => {
      const inputs = Array.isArray(args.input) ? args.input : [args.input];
      return Promise.resolve({
        data: inputs.map((text) => ({ embedding: textToVec(text) })),
      });
    },
  );
}

/**
 * Configure the LLM mock for a standard add() flow:
 *   1st call → fact extraction (returns `facts`)
 *   2nd call → memory update decisions (returns ADD actions for each fact)
 */
function mockLLMForAdd(facts: string[]): void {
  mockChatCreate
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ facts }),
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              memory: facts.map((f) => ({
                id: "new",
                event: "ADD",
                text: f,
                old_memory: "",
                new_memory: f,
              })),
            }),
          },
        },
      ],
    });
}

/**
 * Configure the LLM mock for an add() that deduplicates (NOOP / UPDATE).
 * Accepts a list of actions the LLM "decides" to take.
 */
function mockLLMForDedup(
  facts: string[],
  actions: Array<{ id: string; event: string; text: string; old_memory?: string }>,
): void {
  mockChatCreate
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ facts }),
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              memory: actions.map((a) => ({
                id: a.id,
                event: a.event,
                text: a.text,
                old_memory: a.old_memory ?? "",
                new_memory: a.text,
              })),
            }),
          },
        },
      ],
    });
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe("KuzuDB Integration — full Memory pipeline", () => {
  let memory: Memory;

  // Each test uses a unique userId to avoid cross-contamination without
  // needing reset() (which re-creates KuzuDB instances and triggers native crashes).
  let testUserId: string;
  let testCounter = 0;
  function freshUserId(): string {
    testCounter++;
    return `integ-kuzu-${Date.now()}-${testCounter}`;
  }

  beforeAll(async () => {
    mockEmbedding();

    // Create ONE Memory instance for the entire suite — KuzuDB 0.9 native
    // addon crashes (STATUS_HEAP_CORRUPTION) when multiple Database objects
    // are created and GC'd in the same process.
    memory = new Memory({
      version: "v1.1",
      embedder: {
        provider: "openai",
        config: { apiKey: "test-key", model: "text-embedding-3-small" },
      },
      vectorStore: {
        provider: "kuzu",
        config: {
          collectionName: "integ_kuzu_test",
          dimension: DIM,
          dbPath: ":memory:",
        },
      },
      llm: {
        provider: "openai",
        config: { apiKey: "test-key", model: "gpt-4" },
      },
      historyStore: {
        provider: "kuzu",
        config: { dbPath: ":memory:" },
      },
    });
  });

  beforeEach(() => {
    mockChatCreate.mockReset();
    mockEmbedding();
    testUserId = freshUserId();
  });

  // ─── add() ──────────────────────────────────────────────────────────────

  it("should add a single memory and return it", async () => {
    mockLLMForAdd(["John is a software engineer"]);

    const result = (await memory.add(
      "Hi, my name is John and I am a software engineer.",
      { userId: testUserId },
    )) as SearchResult;

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBeDefined();
    expect(result.results[0].memory).toBe("John is a software engineer");
  });

  it("should add multiple facts from one message", async () => {
    mockLLMForAdd(["Loves Python", "Lives in Berlin"]);

    const result = (await memory.add(
      "I love Python and I live in Berlin.",
      { userId: testUserId },
    )) as SearchResult;

    expect(result.results.length).toBe(2);
    const memories = result.results.map((r) => r.memory);
    expect(memories).toContain("Loves Python");
    expect(memories).toContain("Lives in Berlin");
  });

  it("should add from array messages (conversation)", async () => {
    mockLLMForAdd(["User's favorite city is Paris"]);

    const result = (await memory.add(
      [
        { role: "user", content: "What is your favorite city?" },
        { role: "assistant", content: "I love Paris, it is my favorite city." },
      ],
      { userId: testUserId },
    )) as SearchResult;

    expect(result.results.length).toBe(1);
  });

  it("should handle empty facts gracefully", async () => {
    // 1st LLM call: fact extraction returns empty facts
    // 2nd LLM call: update decisions (still called even with 0 facts)
    mockChatCreate
      .mockResolvedValueOnce({
        choices: [
          { message: { role: "assistant", content: JSON.stringify({ facts: [] }) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { role: "assistant", content: JSON.stringify({ memory: [] }) } },
        ],
      });

    const result = (await memory.add("random noise", { userId: testUserId })) as SearchResult;
    expect(result).toBeDefined();
    expect(result.results).toEqual([]);
  });

  it("should reject add() without userId/agentId/runId", async () => {
    await expect(memory.add("test", {} as any)).rejects.toThrow(
      "One of the filters: userId, agentId or runId is required!",
    );
  });

  // ─── search() ───────────────────────────────────────────────────────────

  it("should search and find similar memories", async () => {
    mockLLMForAdd(["Loves programming in TypeScript"]);
    await memory.add("I love programming in TypeScript", { userId: testUserId });

    mockLLMForAdd(["Enjoys hiking in mountains"]);
    await memory.add("I enjoy hiking in the mountains", { userId: testUserId });

    const result = (await memory.search("What programming languages?", {
      userId: testUserId,
    })) as SearchResult;

    expect(result.results.length).toBeGreaterThan(0);
    // With our deterministic embeddings, at least one result should come back
  });

  it("should filter search by userId", async () => {
    const user1 = `integ-kuzu-u1-${Date.now()}`;
    const user2 = `integ-kuzu-u2-${Date.now()}`;

    mockLLMForAdd(["User1 likes cats"]);
    await memory.add("I like cats", { userId: user1 });

    mockLLMForAdd(["User2 likes dogs"]);
    await memory.add("I like dogs", { userId: user2 });

    const result = (await memory.search("animals", {
      userId: user1,
    })) as SearchResult;

    // All returned results should belong to user1
    for (const r of result.results) {
      expect((r as any).userId).toBe(user1);
    }
  });

  it("should reject search() without userId/agentId/runId", async () => {
    await expect(memory.search("test", {} as any)).rejects.toThrow(
      "One of the filters: userId, agentId or runId is required!",
    );
  });

  // ─── get() ──────────────────────────────────────────────────────────────

  it("should get a memory by ID", async () => {
    mockLLMForAdd(["Prefers dark mode"]);
    const addResult = (await memory.add("I prefer dark mode", {
      userId: testUserId,
    })) as SearchResult;
    const memoryId = addResult.results[0].id;

    const mem = await memory.get(memoryId);

    expect(mem).not.toBeNull();
    expect(mem!.id).toBe(memoryId);
    expect(mem!.memory).toBe("Prefers dark mode");
  });

  it("should return null for nonexistent ID", async () => {
    const mem = await memory.get("nonexistent-uuid");
    expect(mem).toBeNull();
  });

  // ─── getAll() ───────────────────────────────────────────────────────────

  it("should return all memories for a user", async () => {
    mockLLMForAdd(["Fact A"]);
    await memory.add("Fact A content", { userId: testUserId });

    mockLLMForAdd(["Fact B"]);
    await memory.add("Fact B content", { userId: testUserId });

    const result = (await memory.getAll({ userId: testUserId })) as SearchResult;

    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });

  it("should return empty for a user with no memories", async () => {
    const result = (await memory.getAll({
      userId: `nobody-${Date.now()}`,
    })) as SearchResult;
    expect(result.results).toEqual([]);
  });

  // ─── update() ─────────────────────────────────────────────────────────

  it("should update a memory's content", async () => {
    mockLLMForAdd(["Original fact"]);
    const addResult = (await memory.add("Original fact", {
      userId: testUserId,
    })) as SearchResult;
    const memoryId = addResult.results[0].id;

    await memory.update(memoryId, "Updated fact");

    const updated = await memory.get(memoryId);
    expect(updated).not.toBeNull();
    expect(updated!.memory).toBe("Updated fact");
  });

  // ─── delete() ─────────────────────────────────────────────────────────

  it("should delete a memory", async () => {
    mockLLMForAdd(["Temporary fact"]);
    const addResult = (await memory.add("Temporary fact", {
      userId: testUserId,
    })) as SearchResult;
    const memoryId = addResult.results[0].id;

    await memory.delete(memoryId);

    const deleted = await memory.get(memoryId);
    expect(deleted).toBeNull();
  });

  it("should throw when deleting nonexistent memory", async () => {
    await expect(memory.delete("nonexistent-uuid")).rejects.toThrow();
  });

  // ─── history() ────────────────────────────────────────────────────────

  it("should track ADD history", async () => {
    mockLLMForAdd(["History test fact"]);
    const addResult = (await memory.add("History test fact", {
      userId: testUserId,
    })) as SearchResult;
    const memoryId = addResult.results[0].id;

    const history = await memory.history(memoryId);

    expect(history.length).toBeGreaterThanOrEqual(1);
    // KuzuHistoryManager returns objects with action field
    const addEntry = history.find(
      (h: any) => h.action === "ADD" || h.action === "add",
    );
    expect(addEntry).toBeDefined();
  });

  it("should track UPDATE history", async () => {
    mockLLMForAdd(["Before update"]);
    const addResult = (await memory.add("Before update", {
      userId: testUserId,
    })) as SearchResult;
    const memoryId = addResult.results[0].id;

    await memory.update(memoryId, "After update");

    const history = await memory.history(memoryId);
    expect(history.length).toBeGreaterThanOrEqual(2);

    const updateEntry = history.find(
      (h: any) => h.action === "UPDATE" || h.action === "update",
    );
    expect(updateEntry).toBeDefined();
  });

  it("should track DELETE history", async () => {
    mockLLMForAdd(["Will be deleted"]);
    const addResult = (await memory.add("Will be deleted", {
      userId: testUserId,
    })) as SearchResult;
    const memoryId = addResult.results[0].id;

    await memory.delete(memoryId);

    const history = await memory.history(memoryId);
    const deleteEntry = history.find(
      (h: any) => h.action === "DELETE" || h.action === "delete",
    );
    expect(deleteEntry).toBeDefined();
  });

  it("should return empty history for unknown memory", async () => {
    const history = await memory.history("nonexistent-id");
    expect(history).toEqual([]);
  });

  // ─── deleteAll() — used in place of reset() ────────────────────────────

  it("should clear all memories for a user via deleteAll", async () => {
    // NOTE: We test deleteAll() instead of reset() because Memory.reset()
    // re-creates KuzuDB instances, and KuzuDB 0.9 crashes when multiple
    // Database objects are created/GC'd in the same process.
    mockLLMForAdd(["Reset test fact"]);
    await memory.add("Reset test fact", { userId: testUserId });

    await memory.deleteAll({ userId: testUserId });

    const result = (await memory.getAll({ userId: testUserId })) as SearchResult;
    expect(result.results).toEqual([]);
  });

  // ─── dedup / UPDATE flow ──────────────────────────────────────────────

  it("should handle UPDATE action from LLM (dedup scenario)", async () => {
    // Step 1: Add initial memory
    mockLLMForAdd(["Likes Java"]);
    const addResult = (await memory.add("I like Java", {
      userId: testUserId,
    })) as SearchResult;
    expect(addResult.results.length).toBe(1);

    // Step 2: Add another message; LLM decides to UPDATE existing memory
    // The dedup flow: LLM sees the existing memory and returns an UPDATE action
    // with id "0" (temp UUID mapped to the real one)
    mockLLMForDedup(["Likes TypeScript now"], [
      {
        id: "0",
        event: "UPDATE",
        text: "Likes TypeScript now (was Java)",
        old_memory: "Likes Java",
      },
    ]);

    const updateResult = (await memory.add(
      "Actually I switched to TypeScript",
      { userId: testUserId },
    )) as SearchResult;

    expect(updateResult.results.length).toBe(1);
    expect(updateResult.results[0].metadata?.event).toBe("UPDATE");
  });

  // ─── deleteAll() ──────────────────────────────────────────────────────

  it("should delete all memories for a specific user", async () => {
    mockLLMForAdd(["Fact to bulk-delete"]);
    await memory.add("Fact to bulk-delete", { userId: testUserId });

    mockLLMForAdd(["Another fact to bulk-delete"]);
    await memory.add("Another fact", { userId: testUserId });

    await memory.deleteAll({ userId: testUserId });

    const result = (await memory.getAll({ userId: testUserId })) as SearchResult;
    expect(result.results).toEqual([]);
  });

  // ─── agentId / runId support ──────────────────────────────────────────

  it("should add and search by agentId", async () => {
    const agentId = `agent-kuzu-${Date.now()}`;
    mockLLMForAdd(["Agent memory fact"]);

    const result = (await memory.add("Agent memory", {
      agentId,
    })) as SearchResult;
    expect(result.results.length).toBe(1);

    const search = (await memory.search("agent", { agentId })) as SearchResult;
    expect(search.results.length).toBeGreaterThan(0);
  });
});
