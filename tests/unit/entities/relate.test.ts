export {};
/**
 * Unit tests — relate.ts (lib/entities/relate.ts)
 *
 * RELATE_01: No existing edge → creates new edge with validAt
 * RELATE_02: relType uppercased and spaces replaced with underscores
 * RELATE_03: default description is empty string
 * RELATE_04: P2 Fast-path → identical normalized desc → skip (no write)
 * RELATE_05: P0 Contradiction → LLM says CONTRADICTION → invalidates old, creates new
 * RELATE_06: P0 Update → LLM says UPDATE → invalidates old, creates new
 * RELATE_07: P0 Same → LLM says SAME → no change (no write)
 * RELATE_08: P0 LLM failure → fail-open → UPDATE behaviour (invalidate + create)
 * RELATE_09: classifyEdgeContradiction returns correct verdict types
 */
import { linkEntities, classifyEdgeContradiction } from "@/lib/entities/relate";

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

describe("linkEntities", () => {
  it("RELATE_01: no existing edge → creates new edge with validAt", async () => {
    mockRunRead.mockResolvedValueOnce([]); // no existing edge
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("ent-src", "ent-tgt", "WORKS_AT", "Alice works at Acme", "Alice", "Acme");

    // runRead called to check for existing edge
    expect(mockRunRead).toHaveBeenCalledTimes(1);
    const readCypher = mockRunRead.mock.calls[0][0] as string;
    expect(readCypher).toContain("RELATED_TO");
    expect(readCypher).toContain("invalidAt IS NULL");

    // Only one runWrite: CREATE new edge
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [cypher, params] = mockRunWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain("CREATE");
    expect(cypher).toContain("validAt");
    expect(params.sourceId).toBe("ent-src");
    expect(params.targetId).toBe("ent-tgt");
    expect(params.relType).toBe("WORKS_AT");
    expect(params.desc).toBe("Alice works at Acme");
  });

  it("RELATE_02: relType is uppercased and spaces become underscores", async () => {
    mockRunRead.mockResolvedValueOnce([]);
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("a", "b", "works at", "desc");

    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.relType).toBe("WORKS_AT");
  });

  it("RELATE_03: empty description default", async () => {
    mockRunRead.mockResolvedValueOnce([]);
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("a", "b", "TYPE");

    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.desc).toBe("");
  });

  it("RELATE_04 (P2): identical normalized description → increments confirmedCount (1 write)", async () => {
    // Existing edge with same description (different whitespace/casing)
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice works at Acme Corp", confirmedCount: 2 }]);
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("a", "b", "WORKS_AT", "alice works at acme corp");

    // No LLM call — but one write to increment confirmedCount
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [cypher] = mockRunWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain("confirmedCount");
    expect(cypher).toContain("SET");
  });

  it("RELATE_05 (P0): LLM says CONTRADICTION → invalidates old, creates new edge", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice works at Acme Corp" }]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "CONTRADICTION"}' } }],
    });

    await linkEntities("a", "b", "WORKS_AT", "Alice left Acme Corp", "Alice", "Acme Corp");

    // LLM called for contradiction detection
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Two writes: invalidate old + create new
    expect(mockRunWrite).toHaveBeenCalledTimes(2);

    const invalidateCypher = mockRunWrite.mock.calls[0][0] as string;
    expect(invalidateCypher).toContain("invalidAt");

    const createCypher = mockRunWrite.mock.calls[1][0] as string;
    expect(createCypher).toContain("CREATE");
    expect(createCypher).toContain("validAt");
  });

  it("RELATE_06 (P0): LLM says UPDATE → invalidates old, creates new edge", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice works at Acme" }]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "UPDATE"}' } }],
    });

    await linkEntities("a", "b", "WORKS_AT", "Alice works at Acme as a senior engineer", "Alice", "Acme");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRunWrite).toHaveBeenCalledTimes(2); // invalidate + create
  });

  it("RELATE_07 (P0): LLM says SAME → increments confirmedCount (1 write)", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice works at Acme Corp", confirmedCount: 1 }]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "SAME"}' } }],
    });

    await linkEntities("a", "b", "WORKS_AT", "Alice is employed at Acme Corp", "Alice", "Acme Corp");

    // LLM called, verdict SAME → 1 write to increment confirmedCount (no structural change)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const [cypher] = mockRunWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain("confirmedCount");
    expect(cypher).toContain("SET");
  });

  it("RELATE_08 (P0): LLM failure → fail-open UPDATE (invalidate + create)", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice works at OldCo" }]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockRejectedValueOnce(new Error("LLM timeout"));

    await linkEntities("a", "b", "WORKS_AT", "Alice works at NewCo", "Alice", "NewCo");

    // LLM failed → fail-open to UPDATE → 2 writes
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
  });

  it("RELATE_09: existing edge with empty desc, new desc has content → invalidate + create", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "" }]);
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("a", "b", "USES", "Postgres is the primary database", "Alice", "Postgres");

    // No LLM call needed (old desc empty) → invalidate old + create new
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
  });

  it("RELATE_12: new edge → confirmedCount starts at 1", async () => {
    mockRunRead.mockResolvedValueOnce([]); // no existing edge
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("src", "tgt", "KNOWS", "Alice knows Bob");

    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.confirmedCount).toBe(1);
  });

  it("RELATE_13: fast-path SET cypher increments confirmedCount by 1", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Same description", confirmedCount: 5 }]);
    mockRunWrite.mockResolvedValue([]);

    await linkEntities("a", "b", "TYPE", "Same description");

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const cypher = mockRunWrite.mock.calls[0][0] as string;
    // Cypher increments using coalesce + 1 (not a fixed value)
    expect(cypher).toContain("confirmedCount");
    expect(cypher).toContain("coalesce");
  });

  it("RELATE_14: UPDATE with existing confirmedCount:3 → new edge gets confirmedCount:4", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice works at Acme", confirmedCount: 3 }]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "UPDATE"}' } }],
    });

    await linkEntities("a", "b", "WORKS_AT", "Alice is VP at Acme", "Alice", "Acme");

    // invalidate (call 0) + create (call 1)
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    const createParams = mockRunWrite.mock.calls[1][1] as Record<string, unknown>;
    expect(createParams.confirmedCount).toBe(4); // existingCount(3) + 1
  });

  it("RELATE_15: SAME verdict SET cypher increments confirmedCount", async () => {
    mockRunRead.mockResolvedValueOnce([{ desc: "Alice is VP at Acme", confirmedCount: 4 }]);
    mockRunWrite.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "SAME"}' } }],
    });

    await linkEntities("a", "b", "WORKS_AT", "Alice is VP at Acme Corp", "Alice", "Acme");

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("confirmedCount");
    expect(cypher).toContain("SET");
  });
});

describe("classifyEdgeContradiction", () => {
  it("RELATE_10: returns correct verdict from LLM response", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "CONTRADICTION"}' } }],
    });

    const result = await classifyEdgeContradiction(
      "Alice works at Acme", "Alice left Acme", "WORKS_AT", "Alice", "Acme"
    );
    expect(result).toBe("CONTRADICTION");
  });

  it("RELATE_11: unrecognized verdict → falls back to UPDATE", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"verdict": "UNKNOWN"}' } }],
    });

    const result = await classifyEdgeContradiction(
      "old fact", "new fact", "TYPE", "A", "B"
    );
    expect(result).toBe("UPDATE");
  });
});
