/**
 * GET /api/v1/entities/[entityId]/memories — memories mentioning this entity (Spec 04)
 *
 * Query params: user_id (required), page (default 1), size (default 10)
 * Response: { memories: [...], total, page, size }
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(
  request: NextRequest,
  { params }: { params: { entityId: string } }
) {
  const sp = request.nextUrl.searchParams;
  const userId = sp.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  const { entityId } = params;
  const page = Math.max(1, Number(sp.get("page") || "1"));
  const size = Math.min(100, Math.max(1, Number(sp.get("size") || "10")));
  const skip = (page - 1) * size;

  try {
    const rows = await runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
       MATCH (m:Memory)-[:MENTIONS]->(e)
       MATCH (u)-[:HAS_MEMORY]->(m)
       WHERE m.invalidAt IS NULL AND m.state <> 'deleted'
       RETURN m.id AS id, m.content AS content, m.state AS state,
              m.createdAt AS createdAt
       ORDER BY m.createdAt DESC
       SKIP $skip LIMIT $size`,
      { userId, entityId, skip, size }
    );

    const countRows = await runRead<{ total: number }>(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
       MATCH (m:Memory)-[:MENTIONS]->(e)
       MATCH (u)-[:HAS_MEMORY]->(m)
       WHERE m.invalidAt IS NULL AND m.state <> 'deleted'
       RETURN count(m) AS total`,
      { userId, entityId }
    );
    const total = (countRows[0]?.total as number) ?? 0;

    return NextResponse.json({ memories: rows, total, page, size });
  } catch (e: unknown) {
    console.error("GET /entities/[entityId]/memories error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
