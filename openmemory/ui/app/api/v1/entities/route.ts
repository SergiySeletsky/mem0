/**
 * GET /api/v1/entities — list entities for a user (Spec 04)
 *
 * Query params:
 *   user_id  (required)
 *   type     (optional) — filter by entity type (PERSON, ORGANIZATION, etc.)
 *   page     (default 1)
 *   size     (default 20, max 100)
 *
 * Response: { entities: [...], total, page, size }
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const userId = sp.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  const typeFilter = sp.get("type") ?? null;
  const page = Math.max(1, Number(sp.get("page") || "1"));
  const size = Math.min(100, Math.max(1, Number(sp.get("size") || "20")));
  const skip = (page - 1) * size;

  try {
    const rows = await runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
       WHERE ($type IS NULL OR e.type = $type)
       OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(e)
       WITH e, count(m) AS memoryCount
       RETURN e.id AS id, e.name AS name, e.type AS type,
              e.description AS description, e.createdAt AS createdAt,
              memoryCount
       ORDER BY e.name
       SKIP $skip LIMIT $size`,
      { userId, type: typeFilter, skip, size }
    );

    // Total count (separate query)
    const countRows = await runRead<{ total: number }>(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity)
       WHERE ($type IS NULL OR e.type = $type)
       RETURN count(e) AS total`,
      { userId, type: typeFilter }
    );
    const total = (countRows[0]?.total as number) ?? 0;

    return NextResponse.json({ entities: rows, total, page, size });
  } catch (e: unknown) {
    console.error("GET /entities error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
