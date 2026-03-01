export {};

/**
 * Unit tests for lib/clusters/build.ts — Spec 07
 *
 * BUILD_01 — < 5 memories → returns early, no writes
 * BUILD_02 — 6 memories in 2 communities → deletes old + creates 2 Community nodes
 * BUILD_03 — singleton community (1 member) → skipped, only multi-member written
 * BUILD_04 — Louvain returns empty → returns early, no writes
 */

jest.mock("@/lib/db/memgraph", () => ({
  runRead: jest.fn(),
  runWrite: jest.fn(),
}));
jest.mock("@/lib/clusters/summarize", () => ({
  summarizeCluster: jest.fn(),
}));

import { runRead, runWrite } from "@/lib/db/memgraph";
import { summarizeCluster } from "@/lib/clusters/summarize";
import { rebuildClusters } from "@/lib/clusters/build";

const mockRunRead = runRead as jest.MockedFunction<typeof runRead>;
const mockRunWrite = runWrite as jest.MockedFunction<typeof runWrite>;
const mockSummarize = summarizeCluster as jest.MockedFunction<typeof summarizeCluster>;

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWrite.mockResolvedValue(undefined as any);
  mockSummarize.mockResolvedValue({ name: "Test Topic", summary: "A test summary.", rank: 5, findings: [] });
});

describe("rebuildClusters", () => {
  test("BUILD_01: fewer than 5 memories → returns early without any writes", async () => {
    mockRunRead.mockResolvedValueOnce([{ total: 3 }] as any);

    await rebuildClusters("user-1");

    expect(mockRunWrite).not.toHaveBeenCalled();
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  test("BUILD_02: 6 memories in 2 communities → deletes old communities + creates 2 new", async () => {
    // Call 1: count = 6
    mockRunRead.mockResolvedValueOnce([{ total: 6 }] as any);
    // Call 2: Louvain — 3 in community 0, 3 in community 1
    mockRunRead.mockResolvedValueOnce([
      { id: "m1", content: "travel A", communityId: 0 },
      { id: "m2", content: "travel B", communityId: 0 },
      { id: "m3", content: "travel C", communityId: 0 },
      { id: "m4", content: "work A", communityId: 1 },
      { id: "m5", content: "work B", communityId: 1 },
      { id: "m6", content: "work C", communityId: 1 },
    ] as any);

    await rebuildClusters("user-1");

    // runWrite called: 1 delete + 2 community creates = 3 total
    expect(mockRunWrite).toHaveBeenCalledTimes(3);
    expect(mockSummarize).toHaveBeenCalledTimes(2);
  });

  test("BUILD_03: singleton community (1 member) skipped — only 1 multi-member community written", async () => {
    mockRunRead.mockResolvedValueOnce([{ total: 5 }] as any);
    mockRunRead.mockResolvedValueOnce([
      { id: "m1", content: "travel A", communityId: 0 },
      { id: "m2", content: "travel B", communityId: 0 },
      { id: "m3", content: "travel C", communityId: 0 },
      { id: "m4", content: "travel D", communityId: 0 },
      { id: "m5", content: "singleton", communityId: 1 }, // singleton — should be skipped
    ] as any);

    await rebuildClusters("user-1");

    // runWrite: 1 delete + 1 create (singleton skipped)
    expect(mockRunWrite).toHaveBeenCalledTimes(2);
    expect(mockSummarize).toHaveBeenCalledTimes(1);
  });

  test("BUILD_04: Louvain returns empty results → no writes", async () => {
    mockRunRead.mockResolvedValueOnce([{ total: 10 }] as any);
    mockRunRead.mockResolvedValueOnce([] as any); // Louvain finds nothing

    await rebuildClusters("user-1");

    expect(mockRunWrite).not.toHaveBeenCalled();
    expect(mockSummarize).not.toHaveBeenCalled();
  });
});
