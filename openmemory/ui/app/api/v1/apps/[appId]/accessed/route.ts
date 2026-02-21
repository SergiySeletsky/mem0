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
     OPTIONAL MATCH (m)-[:HAS_CATEGORY]->(c:Category)
     RETURN m.id AS id, m.content AS content, m.state AS state,
            m.createdAt AS createdAt, m.metadata AS metadata,
            a.appName AS app_name,
            collect(c.name) AS categories,
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
    memories: rows.map((r: any) => ({
      memory: {
        id: r.id,
        content: r.content,
        state: r.state || "active",
        created_at: r.createdAt || null,
        app_id: null,
        app_name: r.app_name ?? appId,
        categories: r.categories || [],
        metadata_: r.metadata ? (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) : null,
        user_id: "",
        updated_at: r.createdAt || null,
        deleted_at: null,
        vector: null,
        archived_at: null,
      },
      access_count: 1,
    })),
  });
}
