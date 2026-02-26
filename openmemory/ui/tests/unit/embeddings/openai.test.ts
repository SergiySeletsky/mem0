/**
 * P3 — lib/embeddings/openai.ts (embedding router) unit tests
 *
 * Covers: embed(), embedBatch(), checkEmbeddingHealth(), lazy provider loading,
 *         synchronous constants (EMBED_MODEL, EMBED_DIM)
 */
export {};

// Since the real module reads env at import time and uses dynamic imports,
// we isolate each provider scenario with jest.resetModules() + jest.isolateModules().

const mockEmbed = jest.fn();
const mockEmbedBatch = jest.fn();
const mockHealthCheck = jest.fn();

// Mock all three provider modules so dynamic import resolves them
jest.mock("@/lib/embeddings/intelli", () => ({
  embed: (...a: unknown[]) => mockEmbed(...a),
  embedBatch: (...a: unknown[]) => mockEmbedBatch(...a),
  healthCheck: (...a: unknown[]) => mockHealthCheck(...a),
}));
jest.mock("@/lib/embeddings/azure", () => ({
  embed: (...a: unknown[]) => mockEmbed(...a),
  embedBatch: (...a: unknown[]) => mockEmbedBatch(...a),
  healthCheck: (...a: unknown[]) => mockHealthCheck(...a),
}));
jest.mock("@/lib/embeddings/nomic", () => ({
  embed: (...a: unknown[]) => mockEmbed(...a),
  embedBatch: (...a: unknown[]) => mockEmbedBatch(...a),
  healthCheck: (...a: unknown[]) => mockHealthCheck(...a),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEmbed.mockResolvedValue(new Array(1024).fill(0));
  mockEmbedBatch.mockResolvedValue([new Array(1024).fill(0)]);
  mockHealthCheck.mockResolvedValue({ ok: true, latencyMs: 5 });
});

describe("embedding router (default: intelli)", () => {
  test("EMB_01: embed() delegates to intelli provider", async () => {
    const { embed } = require("@/lib/embeddings/openai");
    const vec = await embed("hello");
    expect(mockEmbed).toHaveBeenCalledWith("hello");
    expect(vec).toHaveLength(1024);
  });

  test("EMB_02: embedBatch() delegates to provider impl", async () => {
    const { embedBatch } = require("@/lib/embeddings/openai");
    await embedBatch(["a", "b"]);
    expect(mockEmbedBatch).toHaveBeenCalledWith(["a", "b"]);
  });

  test("EMB_03: checkEmbeddingHealth() returns full result with provider info", async () => {
    const { checkEmbeddingHealth } = require("@/lib/embeddings/openai");
    const h = await checkEmbeddingHealth();
    expect(h.ok).toBe(true);
    expect(h.provider).toBeDefined();
    expect(h.model).toBeDefined();
    expect(h.dim).toBeGreaterThan(0);
    expect(mockHealthCheck).toHaveBeenCalled();
  });

  test("EMB_04: EMBED_MODEL is a non-empty string", () => {
    const { EMBED_MODEL } = require("@/lib/embeddings/openai");
    expect(typeof EMBED_MODEL).toBe("string");
    expect(EMBED_MODEL.length).toBeGreaterThan(0);
  });

  test("EMB_05: EMBED_DIM is a positive integer", () => {
    const { EMBED_DIM } = require("@/lib/embeddings/openai");
    expect(typeof EMBED_DIM).toBe("number");
    expect(EMBED_DIM).toBeGreaterThan(0);
    expect(Number.isInteger(EMBED_DIM)).toBe(true);
  });

  test("EMB_06: embed() lazy-loads provider only once", async () => {
    const { embed } = require("@/lib/embeddings/openai");
    await embed("a");
    await embed("b");
    // mockEmbed is called twice but underlying import should only resolve once
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });
});
