/**
 * Next.js Instrumentation Hook (Next 15 â€” stable, no experimental flag needed)
 *
 * Runs once when the Node.js server starts (not in Edge runtime).
 * 1. Validates Memgraph is reachable with the configured credentials.
 * 2. Creates the Memgraph schema (vector index, text index, constraints, etc.)
 * 3. Validates the embedding provider is reachable (warm health check).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const url = process.env.MEMGRAPH_URL ?? "bolt://localhost:7687";
    const user = process.env.MEMGRAPH_USER ?? process.env.MEMGRAPH_USERNAME ?? "(none)";

    // â”€â”€ 0. Connectivity probe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Test the connection BEFORE initSchema so auth failures produce an
    // actionable error instead of silently degrading to 500 on every request.
    const { runRead, closeDriver, initSchema } = await import("@/lib/db/memgraph");
    let memgraphOk = false;
    try {
      await runRead("RETURN 1 AS probe", {});
      memgraphOk = true;
      console.log(`[instrumentation] Memgraph connection OK âœ“  url=${url}  user=${user}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = msg.includes("Authentication") || msg.includes("Unauthorized") || msg.includes("auth");
      console.error("â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”");
      console.error("[instrumentation] âœ— MEMGRAPH CONNECTION FAILED");
      console.error(`   URL:   ${url}`);
      console.error(`   User:  ${user}`);
      console.error(`   Error: ${msg}`);
      if (isAuth) {
        console.error("");
        console.error("   â–º Authentication failure â€” check your .env file:");
        console.error("     MEMGRAPH_URL=bolt://<host>:<port>");
        console.error("     MEMGRAPH_USERNAME=<user>   (or MEMGRAPH_USER)");
        console.error("     MEMGRAPH_PASSWORD=<pass>");
        console.error("");
        console.error("   â–º Are you running `pnpm dev` from the repo root?");
        console.error("     The .env file lives in the repo root and is NOT");
        console.error("     loaded when the server starts from the repo root.");
      }
      console.error("   â–º ALL API REQUESTS WILL RETURN 500 UNTIL THIS IS FIXED");
      console.error("â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”");
      // Close the failed driver so the next runRead/runWrite creates a fresh one
      await closeDriver().catch(() => {});
    }

    // â”€â”€ 1. Graph schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (memgraphOk) {
      await initSchema().catch((err: unknown) => {
        console.error("[instrumentation] initSchema failed:", err instanceof Error ? err.message : err);
      });
      console.log("[instrumentation] Memgraph schema initialised âœ“");
    }

    // â”€â”€ 2. Embedding health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { checkEmbeddingHealth } = await import("@/lib/embeddings/intelli");
    try {
      const health = await checkEmbeddingHealth();
      if (health.ok) {
        console.log(
          `[instrumentation] Embedding provider OK âœ“  provider=${health.provider}  model=${health.model}  dim=${health.dim}  latency=${health.latencyMs}ms`
        );
      } else {
        console.error(
          `[instrumentation] âš  Embedding provider FAILED  provider=${health.provider}  error=${health.error}`
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
