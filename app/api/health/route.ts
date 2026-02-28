/**
 * GET /api/health — liveness + readiness probe
 *
 * Returns:
 *   200  { status: "ok", checks: { memgraph, embeddings } }
 *   503  { status: "degraded", checks: { memgraph, embeddings } }
 *
 * Memgraph check: runs `RETURN 1 AS probe` — validates connectivity + auth.
 * Embeddings check: calls checkEmbeddingHealth() — validates provider + dim.
 *
 * The response always includes the config being used (URL, user, provider)
 * so mis-configuration (wrong directory, wrong env file) is immediately visible.
 */
import { NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";
import { checkEmbeddingHealth } from "@/lib/embeddings/openai";

export const dynamic = "force-dynamic";

export async function GET() {
  const memgraphUrl = process.env.MEMGRAPH_URL ?? "bolt://localhost:7687";
  const memgraphUser = process.env.MEMGRAPH_USER ?? process.env.MEMGRAPH_USERNAME ?? "(none)";
  const startedAt = new Date().toISOString();

  // ── Memgraph ──────────────────────────────────────────────────────────────
  let memgraphCheck: {
    ok: boolean;
    url: string;
    user: string;
    error?: string;
    latencyMs?: number;
  };
  const t0 = Date.now();
  try {
    await runRead("RETURN 1 AS probe", {});
    memgraphCheck = { ok: true, url: memgraphUrl, user: memgraphUser, latencyMs: Date.now() - t0 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuth = msg.includes("Authentication") || msg.includes("Unauthorized");
    memgraphCheck = {
      ok: false,
      url: memgraphUrl,
      user: memgraphUser,
      error: isAuth
        ? `Authentication failure — check MEMGRAPH_USERNAME / MEMGRAPH_PASSWORD in .env.`
        : msg.slice(0, 200),
    };
  }

  // ── Embeddings ────────────────────────────────────────────────────────────
  let embeddingCheck: {
    ok: boolean;
    provider?: string;
    model?: string;
    dim?: number;
    latencyMs?: number;
    error?: string;
  };
  try {
    const health = await checkEmbeddingHealth();
    embeddingCheck = health.ok
      ? { ok: true, provider: health.provider, model: health.model, dim: health.dim, latencyMs: health.latencyMs }
      : { ok: false, provider: health.provider, error: health.error };
  } catch (err: unknown) {
    embeddingCheck = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const allOk = memgraphCheck.ok && embeddingCheck.ok;
  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checkedAt: startedAt,
      checks: {
        memgraph: memgraphCheck,
        embeddings: embeddingCheck,
      },
    },
    { status: allOk ? 200 : 503 }
  );
}
