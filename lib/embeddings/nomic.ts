/**
 * lib/embeddings/nomic.ts — Local CPU embedding provider (Spec 04 extension)
 *
 * Uses nomic-ai/nomic-embed-text-v1.5 via @huggingface/transformers.
 * - 768-dim output (Matryoshka — also supports 512/256/128/64 via truncation)
 * - 8192-token context window
 * - Fully offline after first download (~120 MB quantized to ~/.cache/huggingface)
 * - No cloud API key required
 *
 * Prefixes (optional in v1.5 but improve quality):
 *   - "search_document: " when embedding content being stored
 *   - "search_query: "   when embedding a search query
 *
 * IMPORTANT: Switching from Azure (1536-dim) to Nomic (768-dim) requires
 * dropping and recreating Memgraph vector indexes.
 * Set EMBEDDING_DIMS=768 in .env when using this provider.
 */

// Use dynamic import so this ESM-only package doesn't break CJS bundling.
// The cast to `any` is intentional: @huggingface/transformers types vary across versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipeline: any | null = null;

async function getPipeline() {
  if (!_pipeline) {
    // Dynamic import handles the ESM-only module in a CJS/webpack environment.
    const transformers = await import("@huggingface/transformers");
    const pipelineFn = transformers.pipeline ?? transformers.default?.pipeline;
    if (!pipelineFn) throw new Error("@huggingface/transformers: pipeline function not found");

    _pipeline = await pipelineFn(
      "feature-extraction",
      "nomic-ai/nomic-embed-text-v1.5",
      {
        // Quantized ONNX model — ~120 MB, runs on CPU without GPU
        dtype: "q8",
      }
    );
  }
  return _pipeline;
}

/** Target output dimension — 768 (native nomic v1.5 size) */
export const EMBED_DIM = parseInt(process.env.EMBEDDING_DIMS ?? "768", 10);
export const EMBED_MODEL = "nomic-ai/nomic-embed-text-v1.5";

/**
 * Embed a single text string using the Nomic model.
 * Applies "search_document: " prefix (correct for stored content).
 * Returns a number[] of length EMBED_DIM.
 */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  // v1.5 prefix guidance: use "search_document: " for content being stored
  const prefixed = text.startsWith("search_query: ") || text.startsWith("search_document: ")
    ? text
    : `search_document: ${text}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await extractor(prefixed, { pooling: "mean", normalize: true }) as any;
  // output.data is a Float32Array — convert to number[]
  const arr: number[] = Array.from(output.data as Float32Array);
  // Truncate / pad to EMBED_DIM if Matryoshka sub-dimension requested
  return arr.slice(0, EMBED_DIM);
}

/**
 * Embed multiple texts.  Uses the model's native batch support when available.
 * Falls back to sequential if batch fails.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const prefixed = texts.map((t) =>
    t.startsWith("search_query: ") || t.startsWith("search_document: ")
      ? t
      : `search_document: ${t}`
  );
  try {
    // Try native batch  (returns [N, dim] tensor)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await extractor(prefixed, { pooling: "mean", normalize: true }) as any;
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

/** Validate nomic model is loadable — used by health check */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await embed("health:ping");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}
