/**
 * GET /api/v1/clusters?user_id=... — Spec 07
 * Lists community clusters for a user, ordered by largest first.
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  try {
    const records = await runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_COMMUNITY]->(c:Community)
       RETURN c.id AS id, c.name AS name, c.summary AS summary,
              c.memberCount AS memberCount, c.createdAt AS createdAt
       ORDER BY c.memberCount DESC`,
      { userId }
    );
    return NextResponse.json({ clusters: records });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
