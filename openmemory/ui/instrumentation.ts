/**
 * Next.js Instrumentation Hook (Next 15 — stable, no experimental flag needed)
 *
 * Runs once when the Node.js server starts (not in Edge runtime).
 * Creates the Memgraph schema (vector index, text index, constraints, etc.)
 * if they don't already exist.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSchema } = await import("@/lib/db/memgraph");
    await initSchema().catch((err: unknown) => {
      console.error("[instrumentation] initSchema failed:", err);
    });
    console.log("[instrumentation] Memgraph schema initialised ✓");
  }
}
