/**
 * GET /api/v1/memories/categories
 * Query: user_id (required)
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ detail: "user_id required" }, { status: 400 });

  const rows = await runRead<{ name: string; memory_count: number }>(
    `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)-[:HAS_CATEGORY]->(c:Category)
     WHERE m.state = 'active'
     RETURN c.name AS name, count(m) AS memory_count
     ORDER BY memory_count DESC`,
    { userId }
  );
  const categories = rows.map((r) => ({ name: r.name, memory_count: r.memory_count }));
  return NextResponse.json({ categories, total: categories.length });
}
