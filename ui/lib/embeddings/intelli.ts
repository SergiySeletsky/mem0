/**
 * lib/embeddings/intelli.ts — intelli-embed-v3 local embedding provider
 *
 * Uses serhiiseletskyi/intelli-embed-v3 via @huggingface/transformers pipeline.
 * - 1024-dim output (XLM-RoBERTa-large, CLS pooling, L2-normalized)
 * - INT8 quantized ONNX (542 MB, auto-downloaded to ~/.cache/huggingface)
 * - Fully offline after first download — no cloud API key required
 * - ~11 ms per embedding on CPU (benchmark: Sep=0.505, beats azure-large on 5/6 metrics)
 *
 * Query prefix: "query: " (for search queries)
 * Document prefix: "" (no prefix for stored content)
 *
 * Published model: https://huggingface.co/serhiiseletskyi/intelli-embed-v3
 */

// Dynamic import — @huggingface/transformers is ESM-only
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipeline: any | null = null;

const MODEL_ID = "serhiiseletskyi/intelli-embed-v3";

async function getPipeline() {
  if (!_pipeline) {
    const transformers = await import("@huggingface/transformers");
    const pipelineFn = transformers.pipeline ?? (transformers as /* eslint-disable-line @typescript-eslint/no-explicit-any */ any).default?.pipeline;
    if (!pipelineFn) throw new Error("@huggingface/transformers: pipeline function not found");

    _pipeline = await pipelineFn(
      "feature-extraction",
      MODEL_ID,
      {
        // INT8 quantized ONNX — 542 MB, runs on CPU without GPU
        dtype: "q8",
      }
    );
  }
  return _pipeline;
}

/** Output dimension — 1024 (native intelli-embed-v3 size) */
export const EMBED_DIM = parseInt(process.env.EMBEDDING_DIMS ?? "1024", 10);
export const EMBED_MODEL = MODEL_ID;

/**
 * Embed a single text string using intelli-embed-v3.
 * No prefix is applied for stored content (config_sentence_transformers: document prompt = "").
 * For search queries, callers should prepend "query: " themselves.
 * Returns a number[] of length EMBED_DIM (1024).
 */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  // CLS pooling + L2-normalize (matches model training config)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await extractor(text, { pooling: "cls", normalize: true }) as any;
  // output.data is a Float32Array — convert to number[]
  const arr: number[] = Array.from(output.data as Float32Array);
  return arr.slice(0, EMBED_DIM);
}

/**
 * Embed multiple texts (batched).
 * Falls back to sequential if native batch fails.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  try {
    // Try native batch (returns [N, dim] tensor)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await extractor(texts, { pooling: "cls", normalize: true }) as any;
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

/** Validate intelli-embed-v3 model is loadable — used by health check */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await embed("health:ping");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}
