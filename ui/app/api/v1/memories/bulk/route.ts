/**
 * POST /api/v1/memories/bulk — Bulk memory ingestion
 *
 * Spec 06: accepts up to 500 memories, processes them with a single
 * embedBatch() call and a single Memgraph UNWIND transaction.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bulkAddMemories } from "@/lib/memory/bulk";

// ── Zod schema ──────────────────────────────────────────────────────────────

const BulkMemoryInputSchema = z.object({
  text: z.string().min(1, "text must not be empty"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  valid_at: z.string().optional(),
});

const BulkAddRequestSchema = z.object({
  user_id: z.string().min(1, "user_id is required"),
  app_name: z.string().optional(),
  memories: z
    .array(BulkMemoryInputSchema)
    .min(1, "memories must contain at least 1 item")
    .max(500, "memories must not exceed 500 items"),
  concurrency: z.number().int().min(1).max(20).optional(),
});

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BulkAddRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400 }
    );
  }

  const { user_id, app_name, memories, concurrency } = parsed.data;

  try {
    const results = await bulkAddMemories(memories, {
      userId: user_id,
      appName: app_name,
      ...(concurrency !== undefined ? { concurrency } : {}),
    });

    const summary = {
      total: results.length,
      added: results.filter((r) => r.status === "added").length,
      skipped_duplicate: results.filter((r) => r.status === "skipped_duplicate").length,
      failed: results.filter((r) => r.status === "failed").length,
    };

    return NextResponse.json({ ...summary, results });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
