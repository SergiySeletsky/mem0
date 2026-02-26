/**
 * GET /api/v1/memories/:memoryId/access-log
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

type RouteParams = { params: Promise<{ memoryId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { memoryId } = await params;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("page_size") || "10", 10);
  const skip = (page - 1) * pageSize;

  const rows = await runRead<{ app_name: string; accessed_at: string; query_used: string }>(
    `MATCH (a:App)-[acc:ACCESSED]->(m:Memory {id: $id})
     RETURN a.appName AS app_name, acc.accessedAt AS accessed_at,
            acc.queryUsed AS query_used
     ORDER BY acc.accessedAt DESC
     SKIP $skip LIMIT $limit`,
    { id: memoryId, skip, limit: pageSize }
  );
  const countRows = await runRead<{ total: number }>(
    `MATCH (:App)-[acc:ACCESSED]->(:Memory {id: $id}) RETURN count(acc) AS total`,
    { id: memoryId }
  );
  const total = countRows[0]?.total ?? 0;
  return NextResponse.json({
    total,
    page,
    page_size: pageSize,
    logs: rows.map((r) => ({
      app_name: r.app_name,
      accessed_at: r.accessed_at,
      query_used: r.query_used,
    })),
  });
}
