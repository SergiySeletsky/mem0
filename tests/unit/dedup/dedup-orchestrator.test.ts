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
  // Default: dedup enabled, threshold 0.75 (lowered from 0.85 for paraphrase catch)
  mockGetDedupConfig.mockResolvedValue({ enabled: true, threshold: 0.75, azureThreshold: 0.55, intelliThreshold: 0.55 });
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
    mockGetDedupConfig.mockResolvedValue({ enabled: false, threshold: 0.75, azureThreshold: 0.55, intelliThreshold: 0.55 });

    const result = await checkDeduplication("any text", "user-1");

    expect(result.action).toBe("insert");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("ORCH_06: passes lowered threshold (0.55) to findNearDuplicates for intelli-embed-v3 default", async () => {
    mockGetDedupConfig.mockResolvedValue({ enabled: true, threshold: 0.75, azureThreshold: 0.55, intelliThreshold: 0.55 });
    mockFind.mockResolvedValue([]);

    await checkDeduplication("A paraphrased version of ADR-003", "user-1");

    // Default provider is intelli → uses intelliThreshold (0.55)
    expect(mockFind).toHaveBeenCalledWith("A paraphrased version of ADR-003", "user-1", 0.55);
  });

  it("ORCH_07: paraphrase with score 0.80 is caught and sent to LLM verification", async () => {
    // Score 0.80 is above new threshold 0.75 but was below old threshold 0.85
    mockGetDedupConfig.mockResolvedValue({ enabled: true, threshold: 0.75, azureThreshold: 0.55, intelliThreshold: 0.55 });
    mockFind.mockResolvedValue([
      { id: "mem-orig", content: "We chose Memgraph as the database layer", score: 0.80 },
    ]);
    mockVerify.mockResolvedValue("DUPLICATE");

    const result = await checkDeduplication(
      "The team decided to use Memgraph as the database",
      "user-1"
    );

    expect(result.action).toBe("skip");
    // LLM verification was called — the paraphrase reached Stage 2
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });

  it("ORCH_08: custom higher threshold from config is respected for intelli provider", async () => {
    mockGetDedupConfig.mockResolvedValue({ enabled: true, threshold: 0.92, azureThreshold: 0.60, intelliThreshold: 0.60 });
    mockFind.mockResolvedValue([]);

    await checkDeduplication("test", "user-1");

    // Default provider is intelli → uses intelliThreshold (0.60)
    expect(mockFind).toHaveBeenCalledWith("test", "user-1", 0.60);
  });

  it("ORCH_09: DEDUP_THRESHOLD_SPLIT — intelliThreshold is independent from azureThreshold (DEDUP-01)", async () => {
    // Core of DEDUP-01 fix: intelli and azure thresholds can diverge independently.
    // A high azureThreshold must NOT affect what is passed when using the intelli provider.
    mockGetDedupConfig.mockResolvedValue({
      enabled: true,
      threshold: 0.75,
      azureThreshold: 0.90,   // deliberately HIGH — must NOT be used for intelli
      intelliThreshold: 0.50, // deliberately LOW — must be used for intelli
    });
    mockFind.mockResolvedValue([]);

    await checkDeduplication("some memory text", "user-99");

    // Must use intelliThreshold (0.50), NOT azureThreshold (0.90)
    expect(mockFind).toHaveBeenCalledWith("some memory text", "user-99", 0.50);
    expect(mockFind).not.toHaveBeenCalledWith("some memory text", "user-99", 0.90);
  });

  // ── Negation gate tests (BM25 lexical negation safety) ────────────────
  // Dense cosine similarity can't distinguish "likes coffee" from "doesn't like coffee"
  // (negGap ≈ 0). The negation gate prevents false DUPLICATE merges.

  it("ORCH_10: DUPLICATE with asymmetric negation → falls back to insert (negation gate)", async () => {
    // "I like coffee" vs "I don't like coffee" — LLM thinks DUPLICATE because
    // cosine similarity is very high, but the negation gate catches it.
    mockFind.mockResolvedValue([
      { id: "mem-neg-1", content: "I like coffee", score: 0.98 },
    ]);
    mockVerify.mockResolvedValue("DUPLICATE");

    const result = await checkDeduplication("I don't like coffee", "user-1");

    // Negation gate should prevent the false DUPLICATE merge
    expect(result.action).toBe("insert");
  });

  it("ORCH_11: DUPLICATE without negation asymmetry → still skip (no false positive)", async () => {
    // Both affirm → no asymmetry → negation gate should NOT block
    mockFind.mockResolvedValue([
      { id: "mem-pos-1", content: "I prefer dark mode", score: 0.97 },
    ]);
    mockVerify.mockResolvedValue("DUPLICATE");

    const result = await checkDeduplication("dark theme is my preference", "user-1");

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.existingId).toBe("mem-pos-1");
    }
  });

  it("ORCH_12: SUPERSEDES with negation is allowed (temporal updates use negation legitimately)", async () => {
    // "I no longer live in NYC" superseding "I live in NYC" is valid —
    // the negation gate should NOT block SUPERSEDES, only DUPLICATE.
    mockFind.mockResolvedValue([
      { id: "mem-loc-1", content: "I live in NYC", score: 0.93 },
    ]);
    mockVerify.mockResolvedValue("SUPERSEDES");

    const result = await checkDeduplication("I no longer live in NYC, I moved to London", "user-1");

    expect(result.action).toBe("supersede");
    if (result.action === "supersede") {
      expect(result.existingId).toBe("mem-loc-1");
    }
  });

  it("ORCH_13: LLM verification error falls through to insert (fail-open)", async () => {
    mockFind.mockResolvedValue([
      { id: "mem-err-1", content: "some memory", score: 0.90 },
    ]);
    mockVerify.mockRejectedValue(new Error("LLM timeout"));

    const result = await checkDeduplication("updated memory", "user-1");

    expect(result.action).toBe("insert");
  });
});
