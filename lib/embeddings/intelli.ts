/**
 * lib/embeddings/intelli.ts — Embedding provider router
 *
 * This is the canonical embedding entry point. All other modules import
 * from here so that `jest.mock("@/lib/embeddings/intelli")` works globally.
 *
 * Active provider is selected by EMBEDDING_PROVIDER env var:
 *
 *   EMBEDDING_PROVIDER=intelli  (default) → serhiiseletskyi/intelli-embed-v3
 *     Requires: nothing (model auto-downloaded on first call, ~542 MB INT8 ONNX)
 *     Dims:     1024 (CLS pooling, L2-normalized)
 *     Benchmark: Sep=0.505, beats azure-large on 5/6 MemForge metrics
 *
 *   EMBEDDING_PROVIDER=azure  → Azure AI Foundry (text-embedding-3-large by default)
 *     Requires: EMBEDDING_AZURE_OPENAI_API_KEY + EMBEDDING_AZURE_ENDPOINT
 *     Dims:     1024 (or EMBEDDING_DIMS override)
 *
 * ⚠️  IMPORTANT: Changing EMBEDDING_PROVIDER changes the vector dimension.
 *     This requires dropping and recreating Memgraph vector indexes AND
 *     re-embedding all stored memories.  See AGENTS.md for migration steps.
 */

const _providerName = (process.env.EMBEDDING_PROVIDER ?? "intelli").toLowerCase();

// --- Azure delegation (lazy) ------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _azureImpl: any | null = null;

async function getAzureImpl() {
  if (!_azureImpl) _azureImpl = await import("./azure");
  return _azureImpl;
}

// --- Synchronous constants (evaluated at module load time) ------------------

export const EMBED_MODEL: string =
  _providerName === "azure"
    ? (process.env.EMBEDDING_AZURE_DEPLOYMENT ?? "text-embedding-3-large")
    : "serhiiseletskyi/intelli-embed-v3";

export const EMBED_DIM: number = parseInt(process.env.EMBEDDING_DIMS ?? "1024", 10);

// --- intelli-embed-v3 implementation (default path) -------------------------

// Dynamic import — @huggingface/transformers is ESM-only
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipeline: any | null = null;

const MODEL_ID = "serhiiseletskyi/intelli-embed-v3";

async function getPipeline() {
  if (!_pipeline) {
    const transformers = await import("@huggingface/transformers");
    const pipelineFn =
      transformers.pipeline ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transformers as any).default?.pipeline;
    if (!pipelineFn)
      throw new Error("@huggingface/transformers: pipeline function not found");

    _pipeline = await pipelineFn("feature-extraction", MODEL_ID, {
      // INT8 quantized ONNX — 542 MB, runs on CPU without GPU
      dtype: "q8",
    });
  }
  return _pipeline;
}

// --- Public API -------------------------------------------------------------

/**
 * Embed a single text string.
 * Returns a number[] of length EMBED_DIM (1024).
 */
export async function embed(text: string): Promise<number[]> {
  if (_providerName === "azure") {
    return (await getAzureImpl()).embed(text);
  }
  const extractor = await getPipeline();
  // CLS pooling + L2-normalize (matches intelli-embed-v3 training config)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await extractor(text, { pooling: "cls", normalize: true }) as any;
  const arr: number[] = Array.from(output.data as Float32Array);
  return arr.slice(0, EMBED_DIM);
}

/**
 * Embed multiple texts (batched where provider supports it).
 * Returns arrays in the same order as the input.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (_providerName === "azure") {
    return (await getAzureImpl()).embedBatch(texts);
  }
  const extractor = await getPipeline();
  try {
    // Try native batch (returns [N, dim] tensor)
    const output = await extractor(texts, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pooling: "cls", normalize: true }) as any;
    const flat: number[] = Array.from(output.data as Float32Array);
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(flat.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
    }
    return results;
  } catch {
    // Fall back to sequential
    return Promise.all(texts.map((t) => embed(t)));
  }
}

/**
 * Validate the active embedding provider is reachable.
 * Returns provider name, dimension, and health status.
 */
export async function checkEmbeddingHealth(): Promise<{
  provider: string;
  model: string;
  dim: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    if (_providerName === "azure") {
      const az = await getAzureImpl();
      const result = await az.healthCheck();
      return { provider: _providerName, model: EMBED_MODEL, dim: EMBED_DIM, ...result };
    }
    await embed("health:ping");
    return { provider: _providerName, model: EMBED_MODEL, dim: EMBED_DIM, ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { provider: _providerName, model: EMBED_MODEL, dim: EMBED_DIM, ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}