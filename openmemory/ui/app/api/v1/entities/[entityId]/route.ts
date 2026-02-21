/**
 * GET /api/v1/entities/[entityId] — get a single entity by id (Spec 04)
 *
 * Query params: user_id (required)
 * Response: { id, name, type, description, memoryCount, createdAt }
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(
  request: NextRequest,
  { params }: { params: { entityId: string } }
) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  const { entityId } = params;

  try {
    const rows = await runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_ENTITY]->(e:Entity {id: $entityId})
       OPTIONAL MATCH (:Memory)-[:MENTIONS]->(e)
       RETURN e.id AS id, e.name AS name, e.type AS type,
              e.description AS description, e.createdAt AS createdAt,
              count(*) AS memoryCount`,
      { userId, entityId }
    );

    if (!rows.length) {
      return NextResponse.json({ detail: "Entity not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (e: any) {
    console.error("GET /entities/[entityId] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
