/**
 * GET /api/v1/clusters/[clusterId]/memories?user_id=... — Spec 07
 * Lists memories that belong to a specific community cluster.
 * Ownership check: Community must be reachable from the User node.
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clusterId: string }> }
) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  const { clusterId } = await params;

  try {
    // Ownership check
    const check = await runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_COMMUNITY]->(c:Community {id: $clusterId})
       RETURN c.id AS id`,
      { userId, clusterId }
    );
    if (!check.length) {
      return NextResponse.json({ detail: "Community not found" }, { status: 404 });
    }

    const members = await runRead(
      `MATCH (m:Memory)-[:IN_COMMUNITY]->(c:Community {id: $clusterId})
       WHERE m.invalidAt IS NULL
       RETURN m.id AS id, m.content AS content, m.createdAt AS createdAt
       ORDER BY m.createdAt DESC`,
      { clusterId }
    );

    return NextResponse.json({ memories: members });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
