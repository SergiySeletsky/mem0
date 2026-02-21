export {};
/**
 * Unit tests — checkDeduplication orchestrator (lib/dedup/index.ts)
 *
 * ORCH_01: No similar memories → action: insert
 * ORCH_02: Similar found but LLM says DIFFERENT → action: insert
 * ORCH_03: Similar found + LLM says DUPLICATE → action: skip, existingId returned
 * ORCH_04: Similar found + LLM says SUPERSEDES → action: supersede, existingId returned
 * ORCH_05: dedup disabled in config → always action: insert (no vector search called)
 */
import { checkDeduplication } from "@/lib/dedup";

jest.mock("@/lib/dedup/findNearDuplicates");
jest.mock("@/lib/dedup/verifyDuplicate");
jest.mock("@/lib/dedup/cache");
jest.mock("@/lib/config/helpers");

import { findNearDuplicates } from "@/lib/dedup/findNearDuplicates";
import { verifyDuplicate } from "@/lib/dedup/verifyDuplicate";
import { getCached, setCached, pairHash } from "@/lib/dedup/cache";
import { getDedupConfig } from "@/lib/config/helpers";

const mockFind = findNearDuplicates as jest.MockedFunction<typeof findNearDuplicates>;
const mockVerify = verifyDuplicate as jest.MockedFunction<typeof verifyDuplicate>;
const mockGetCached = getCached as jest.MockedFunction<typeof getCached>;
const mockSetCached = setCached as jest.MockedFunction<typeof setCached>;
const mockPairHash = pairHash as jest.MockedFunction<typeof pairHash>;
const mockGetDedupConfig = getDedupConfig as jest.MockedFunction<typeof getDedupConfig>;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: dedup enabled, threshold 0.92
  mockGetDedupConfig.mockResolvedValue({ enabled: true, threshold: 0.92 });
  mockGetCached.mockReturnValue(null);
  mockPairHash.mockReturnValue("fake-hash");
  mockSetCached.mockImplementation(() => {});
});

describe("checkDeduplication orchestrator", () => {
  it("ORCH_01: no similar candidates → action: insert", async () => {
    mockFind.mockResolvedValue([]);

    const result = await checkDeduplication("brand new memory text", "user-1");

    expect(result.action).toBe("insert");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("ORCH_02: similar candidate found but LLM says DIFFERENT → action: insert", async () => {
    mockFind.mockResolvedValue([
      { id: "mem-111", content: "I like dogs", score: 0.94 },
    ]);
    mockVerify.mockResolvedValue("DIFFERENT");

    const result = await checkDeduplication("I like cats", "user-1");

    expect(result.action).toBe("insert");
  });

  it("ORCH_03: similar candidate + LLM says DUPLICATE → action: skip with existingId", async () => {
    mockFind.mockResolvedValue([
      { id: "mem-222", content: "I prefer dark mode", score: 0.97 },
    ]);
    mockVerify.mockResolvedValue("DUPLICATE");

    const result = await checkDeduplication("dark theme is my preference", "user-1");

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.existingId).toBe("mem-222");
    }
  });

  it("ORCH_04: similar candidate + LLM says SUPERSEDES → action: supersede with existingId", async () => {
    mockFind.mockResolvedValue([
      { id: "mem-333", content: "I live in NYC", score: 0.93 },
    ]);
    mockVerify.mockResolvedValue("SUPERSEDES");

    const result = await checkDeduplication("I moved to London, no longer in NYC", "user-1");

    expect(result.action).toBe("supersede");
    if (result.action === "supersede") {
      expect(result.existingId).toBe("mem-333");
    }
  });

  it("ORCH_05: dedup disabled → always action: insert without calling findNearDuplicates", async () => {
    mockGetDedupConfig.mockResolvedValue({ enabled: false, threshold: 0.92 });

    const result = await checkDeduplication("any text", "user-1");

    expect(result.action).toBe("insert");
    expect(mockFind).not.toHaveBeenCalled();
  });
});
