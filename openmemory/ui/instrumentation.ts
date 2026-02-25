/**
 * Next.js Instrumentation Hook (Next 15 — stable, no experimental flag needed)
 *
 * Runs once when the Node.js server starts (not in Edge runtime).
 * 1. Creates the Memgraph schema (vector index, text index, constraints, etc.)
 * 2. Validates the embedding provider is reachable (warm health check).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ── 1. Graph schema ──────────────────────────────────────────────────────
    const { initSchema } = await import("@/lib/db/memgraph");
    await initSchema().catch((err: unknown) => {
      console.error("[instrumentation] initSchema failed:", err);
    });
    console.log("[instrumentation] Memgraph schema initialised ✓");

    // ── 2. Embedding health check ─────────────────────────────────────────────
    const { checkEmbeddingHealth } = await import("@/lib/embeddings/openai");
    try {
      const health = await checkEmbeddingHealth();
      if (health.ok) {
        console.log(
          `[instrumentation] Embedding provider OK ✓  provider=${health.provider}  model=${health.model}  dim=${health.dim}  latency=${health.latencyMs}ms`
        );
      } else {
        console.error(
          `[instrumentation] ⚠ Embedding provider FAILED  provider=${health.provider}  error=${health.error}`
        );
        console.error(
          "[instrumentation] Semantic search and dedup will not work until the embedding provider is fixed."
        );
      }
    } catch (err: unknown) {
      console.error("[instrumentation] Embedding health check threw:", err);
    }
  }
}
