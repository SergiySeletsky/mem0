/**
 * tests/unit/embeddings/intelli.test.ts
 *
 * Covers lib/embeddings/intelli.ts — the embedding provider router.
 * Tests: embed(), embedBatch(), checkEmbeddingHealth(), EMBED_MODEL, EMBED_DIM,
 *        default-path (intelli) and azure delegation path.
 */
export {};

const DIMS = 1024;

// Mock @huggingface/transformers so the intelli path never loads real ONNX.
// The mock extractor returns a Float32Array sized for the input count.
const mockExtractor = jest.fn().mockImplementation(async (input: unknown) => {
  const n = Array.isArray(input) ? (input as unknown[]).length : 1;
  return { data: new Float32Array(n * DIMS).fill(0.1) };
});
jest.mock("@huggingface/transformers", () => ({
  pipeline: jest.fn().mockResolvedValue(mockExtractor),
}));

// Mock azure backend for delegation tests
const mockAzureEmbed = jest.fn().mockResolvedValue(new Array(DIMS).fill(0.5));
const mockAzureEmbedBatch = jest
  .fn()
  .mockResolvedValue([new Array(DIMS).fill(0.5)]);
const mockAzureHealth = jest.fn().mockResolvedValue({ ok: true, latencyMs: 3 });
jest.mock("@/lib/embeddings/azure", () => ({
  embed: (...a: unknown[]) => mockAzureEmbed(...a),
  embedBatch: (...a: unknown[]) => mockAzureEmbedBatch(...a),
  healthCheck: (...a: unknown[]) => mockAzureHealth(...a),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockExtractor.mockImplementation(async (input: unknown) => {
    const n = Array.isArray(input) ? (input as unknown[]).length : 1;
    return { data: new Float32Array(n * DIMS).fill(0.1) };
  });
  mockAzureEmbed.mockResolvedValue(new Array(DIMS).fill(0.5));
  mockAzureEmbedBatch.mockResolvedValue([new Array(DIMS).fill(0.5)]);
  mockAzureHealth.mockResolvedValue({ ok: true, latencyMs: 3 });
});

// ─── Default path: intelli-embed-v3 ─────────────────────────────────────────

describe("embedding router — default (intelli) path", () => {
  test("EMB_01: embed() returns a numeric array of length EMBED_DIM", async () => {
    const { embed, EMBED_DIM } = require("@/lib/embeddings/intelli");
    const vec = await embed("hello world");
    expect(Array.isArray(vec)).toBe(true);
    expect(vec).toHaveLength(EMBED_DIM);
    expect(typeof vec[0]).toBe("number");
  });

  test("EMB_02: embedBatch() returns correct number of vectors", async () => {
    const { embedBatch, EMBED_DIM } = require("@/lib/embeddings/intelli");
    const results = await embedBatch(["foo", "bar", "baz"]);
    expect(results).toHaveLength(3);
    results.forEach((v: number[]) => expect(v).toHaveLength(EMBED_DIM));
  });

  test("EMB_03: embedBatch([]) returns []", async () => {
    const { embedBatch } = require("@/lib/embeddings/intelli");
    expect(await embedBatch([])).toEqual([]);
  });

  test("EMB_04: checkEmbeddingHealth() returns full shape with ok:true", async () => {
    const { checkEmbeddingHealth } = require("@/lib/embeddings/intelli");
    const h = await checkEmbeddingHealth();
    expect(h.ok).toBe(true);
    expect(typeof h.provider).toBe("string");
    expect(typeof h.model).toBe("string");
    expect(h.dim).toBeGreaterThan(0);
    expect(typeof h.latencyMs).toBe("number");
  });

  test("EMB_05: EMBED_MODEL is a non-empty string", () => {
    const { EMBED_MODEL } = require("@/lib/embeddings/intelli");
    expect(typeof EMBED_MODEL).toBe("string");
    expect(EMBED_MODEL.length).toBeGreaterThan(0);
  });

  test("EMB_06: EMBED_DIM is a positive integer", () => {
    const { EMBED_DIM } = require("@/lib/embeddings/intelli");
    expect(typeof EMBED_DIM).toBe("number");
    expect(EMBED_DIM).toBeGreaterThan(0);
    expect(Number.isInteger(EMBED_DIM)).toBe(true);
  });
});

// ─── Azure delegation path ───────────────────────────────────────────────────

describe("embedding router — azure delegation", () => {
  afterEach(() => {
    delete process.env.EMBEDDING_PROVIDER;
    jest.resetModules();
  });

  test("EMB_07: embed() delegates to azure when EMBEDDING_PROVIDER=azure", async () => {
    process.env.EMBEDDING_PROVIDER = "azure";
    jest.resetModules();
    const { embed } = require("@/lib/embeddings/intelli");
    const vec = await embed("azure test");
    expect(mockAzureEmbed).toHaveBeenCalledWith("azure test");
    expect(vec).toHaveLength(DIMS);
  });

  test("EMB_08: embedBatch() delegates to azure", async () => {
    process.env.EMBEDDING_PROVIDER = "azure";
    jest.resetModules();
    const { embedBatch } = require("@/lib/embeddings/intelli");
    await embedBatch(["a", "b"]);
    expect(mockAzureEmbedBatch).toHaveBeenCalledWith(["a", "b"]);
  });

  test("EMB_09: checkEmbeddingHealth() delegates healthCheck to azure", async () => {
    process.env.EMBEDDING_PROVIDER = "azure";
    jest.resetModules();
    const { checkEmbeddingHealth } = require("@/lib/embeddings/intelli");
    const h = await checkEmbeddingHealth();
    expect(mockAzureHealth).toHaveBeenCalled();
    expect(h.ok).toBe(true);
    expect(h.provider).toBe("azure");
  });
});
