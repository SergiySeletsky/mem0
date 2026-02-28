/**
 * POST /api/v1/backup/export
 * Body: { user_id: string }
 * Returns all active, non-superseded memories for the given user as JSON.
 * Spec 00: Memgraph port (no zip - simplified for single-backend)
 * Spec 01: m.invalidAt IS NULL — only export current (non-superseded) memories
 * Spec 09: scoped to a single user — no cross-user data exposure
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

export async function POST(request: NextRequest) {
  let body: { user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const userId = body.user_id?.trim();
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  const rows = await runRead<{ id: string; content: string; state: string; createdAt: string; metadata: string | null; embedding: string | null; userId: string; appName: string | null; categories: string[] }>(
    `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
     WHERE m.state <> 'deleted' AND m.invalidAt IS NULL
     OPTIONAL MATCH (m)-[:CREATED_BY]->(a:App)
     OPTIONAL MATCH (m)-[:HAS_CATEGORY]->(c:Category)
     RETURN m.id AS id, m.content AS content, m.state AS state,
            m.createdAt AS createdAt, m.metadata AS metadata,
            m.embedding AS embedding,
            u.userId AS userId, a.appName AS appName,
            collect(c.name) AS categories`,
    { userId }
  );
  const memories = rows.map((r) => ({
    id: r.id,
    content: r.content,
    state: r.state,
    created_at: r.createdAt,
    user_id: r.userId,
    app_name: r.appName || null,
    categories: r.categories || [],
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    embedding: r.embedding || null,
  }));
  const exportData = { version: "2.0", exported_at: new Date().toISOString(), memories };
  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="memories-export-${Date.now()}.json"`,
    },
  });
}
