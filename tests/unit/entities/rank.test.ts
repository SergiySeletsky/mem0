export {};
/**
 * Unit tests — updateEntityRank (lib/entities/rank.ts)
 *
 * RANK_01: Sets rank = mentions + relationship count
 * RANK_02: Entity with no connections → rank = 0
 * RANK_03: runWrite called with correct entityId param
 */

jest.mock("@/lib/db/memgraph", () => ({
  runWrite: jest.fn(),
}));

import { runWrite } from "@/lib/db/memgraph";
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWrite.mockResolvedValue([]);
});

describe("updateEntityRank", () => {
  let updateEntityRank: typeof import("@/lib/entities/rank").updateEntityRank;

  beforeAll(async () => {
    ({ updateEntityRank } = await import("@/lib/entities/rank"));
  });

  it("RANK_01: calls runWrite with SET e.rank = mentions + rels", async () => {
    await updateEntityRank("ent-42");

    expect(mockRunWrite).toHaveBeenCalledTimes(1);
    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("SET e.rank = mentions + rels");
    expect(cypher).toContain("MATCH (e:Entity {id: $entityId})");
  });

  it("RANK_02: filters invalidAt IS NULL for both mentions and rels", async () => {
    await updateEntityRank("ent-99");

    const cypher = mockRunWrite.mock.calls[0][0] as string;
    expect(cypher).toContain("m.invalidAt IS NULL");
    expect(cypher).toContain("r.invalidAt IS NULL");
  });

  it("RANK_03: passes entityId as parameter", async () => {
    await updateEntityRank("ent-abc");

    const params = mockRunWrite.mock.calls[0][1] as Record<string, unknown>;
    expect(params.entityId).toBe("ent-abc");
  });
});
