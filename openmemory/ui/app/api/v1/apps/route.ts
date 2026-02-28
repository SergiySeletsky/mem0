/**
 * GET /api/v1/apps
 * Query: user_id (required)
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ detail: "user_id required" }, { status: 400 });

  const rows = await runRead<{ name: string; id: string; is_active: boolean; created_at: string; memory_count: number }>(
    `MATCH (u:User {userId: $userId})-[:HAS_APP]->(a:App)
     OPTIONAL MATCH (u)-[:HAS_MEMORY]->(m:Memory)-[:CREATED_BY]->(a)
     WHERE m.state = 'active' AND m.invalidAt IS NULL
     RETURN a.appName AS name, a.id AS id, a.isActive AS is_active,
            a.createdAt AS created_at, count(m) AS memory_count`,
    { userId }
  );
  return NextResponse.json({
    apps: rows.map((r) => ({
      id: r.id,
      name: r.name,
      is_active: r.is_active !== false,
      created_at: r.created_at,
      memory_count: r.memory_count ?? 0,
      total_memories_created: r.memory_count ?? 0,
      total_memories_accessed: 0,
    })),
    total: rows.length,
  });
}
