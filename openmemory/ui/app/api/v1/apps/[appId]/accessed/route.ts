/**
 * GET /api/v1/apps/:appId/accessed
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

type RouteParams = { params: Promise<{ appId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { appId } = await params;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("page_size") || "20", 10);
  const skip = (page - 1) * pageSize;

  const rows = await runRead(
    `MATCH (a:App {appName: $appId})-[acc:ACCESSED]->(m:Memory)
     RETURN m.id AS memory_id, m.content AS content,
            acc.accessedAt AS accessed_at, acc.queryUsed AS query_used
     ORDER BY acc.accessedAt DESC SKIP $skip LIMIT $limit`,
    { appId, skip, limit: pageSize }
  );
  const countRows = await runRead(
    `MATCH (:App {appName: $appId})-[acc:ACCESSED]->(:Memory) RETURN count(acc) AS total`,
    { appId }
  );
  const total = (countRows[0] as any)?.total ?? 0;
  return NextResponse.json({
    total, page, page_size: pageSize,
    results: rows.map((r: any) => ({
      memory_id: r.memory_id,
      content: r.content,
      accessed_at: r.accessed_at,
      query_used: r.query_used,
    })),
  });
}
