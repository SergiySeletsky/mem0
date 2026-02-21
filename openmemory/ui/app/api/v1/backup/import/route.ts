/**
 * POST /api/v1/backup/import
 * Accepts JSON backup file (multipart or JSON body)
 * Re-embeds and re-inserts memories into Memgraph via bulkAddMemories()
 *
 * Spec 00: Memgraph port
 * Spec 06: Uses bulkAddMemories() so vector embeddings are created (memories are searchable)
 */
import { NextRequest, NextResponse } from "next/server";
import { bulkAddMemories } from "@/lib/memory/bulk";

export async function POST(request: NextRequest) {
  let data: any;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file)
      return NextResponse.json({ detail: "No file provided" }, { status: 400 });
    const text = await file.text();
    data = JSON.parse(text);
  } else {
    data = await request.json();
  }

  const memories: any[] = data.memories || [];
  if (memories.length === 0) {
    return NextResponse.json({ message: "Import complete", imported: 0, failed: 0, total: 0 });
  }

  // Group memories by userId so we can call bulkAddMemories once per user.
  const byUser = new Map<string, any[]>();
  for (const mem of memories) {
    const uid = mem.user_id || "default_user";
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(mem);
  }

  let imported = 0;
  let failed = 0;

  for (const [userId, userMemories] of byUser.entries()) {
    const items = userMemories.map((m: any) => ({
      text: m.content as string,
      valid_at: m.created_at as string | undefined,
    }));

    try {
      // dedupEnabled=false for restores — we trust the backup is canonical.
      const results = await bulkAddMemories(items, {
        userId,
        dedupEnabled: false,
        concurrency: 3,
      });
      imported += results.filter((r) => r.status === "added").length;
      failed += results.filter((r) => r.status === "failed").length;
    } catch {
      failed += userMemories.length;
    }
  }

  return NextResponse.json({
    message: "Import complete",
    imported,
    failed,
    total: memories.length,
    note:
      memories.length > 50
        ? `Embedding ${memories.length} memories may have taken a few seconds. All restored memories are fully searchable.`
        : undefined,
  });
}
