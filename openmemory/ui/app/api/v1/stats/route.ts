/**
 * GET /api/v1/stats - user profile stats
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  try {
    // Ensure user node exists
    const { runWrite } = await import("@/lib/db/memgraph");
    await runWrite(
      `MERGE (u:User {userId: $userId}) ON CREATE SET u.createdAt = $now`,
      { userId, now: new Date().toISOString() }
    ).catch(() => {});

    const [memRows, appRows] = await Promise.all([
      runRead<{ count: number }>(
        `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
         WHERE m.state <> 'deleted' AND m.invalidAt IS NULL
         RETURN count(m) AS count`,
        { userId }
      ),
      runRead<{ id: string; appName: string; isActive: boolean; createdAt: string }>(
        `MATCH (u:User {userId: $userId})-[:HAS_APP]->(a:App)
         RETURN a.id AS id, a.appName AS appName, a.isActive AS isActive, a.createdAt AS createdAt`,
        { userId }
      ),
    ]);

    const total = memRows[0]?.count;
    const totalMemories = typeof total === "number" ? total : (total as { low?: number })?.low ?? 0;

    return NextResponse.json({
      total_memories: totalMemories,
      total_apps: appRows.length,
      apps: appRows.map((a) => ({ id: a.id, name: a.appName, is_active: a.isActive, created_at: a.createdAt })),
    });
  } catch (err) {
    console.error("[GET /api/v1/stats] error:", err);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}
