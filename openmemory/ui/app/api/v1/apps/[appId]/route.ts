import { NextRequest, NextResponse } from "next/server";
import { runRead, runWrite } from "@/lib/db/memgraph";
type RouteParams = { params: Promise<{ appId: string }> };
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { appId } = await params;
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");
  const rows = await runRead(
    `MATCH (a:App) WHERE a.appName = $appId OR a.id = $appId
     OPTIONAL MATCH (:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)-[:CREATED_BY]->(a)
     WHERE m IS NULL OR m.state = 'active'
     RETURN a.appName AS name, a.id AS id, a.isActive AS is_active,
            a.createdAt AS created_at, count(m) AS memory_count`,
    { appId, userId: userId || "" }
  );
  if (!rows.length) return NextResponse.json({ detail: "App not found" }, { status: 404 });
  const r = rows[0] as any;
  return NextResponse.json({
    id: r.id,
    name: r.name,
    is_active: r.is_active !== false,
    created_at: r.created_at,
    memory_count: r.memory_count ?? 0,
    total_memories_created: r.memory_count ?? 0,
    total_memories_accessed: 0,
    first_accessed: null,
    last_accessed: null,
  });
}
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { appId } = await params;
  const body = await request.json();
  if (typeof body.is_active !== "boolean")
    return NextResponse.json({ detail: "Nothing to update" }, { status: 400 });
  await runWrite(`MATCH (a:App {appName: $appId}) SET a.isActive = $isActive`, { appId, isActive: body.is_active });
  return NextResponse.json({ message: "App updated" });
}