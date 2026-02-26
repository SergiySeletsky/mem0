/**
 * POST /api/v1/backup/export
 * Returns all active memories as JSON
 * Spec 00: Memgraph port (no zip - simplified for single-backend)
 */
import { runRead } from "@/lib/db/memgraph";

export async function POST() {
  const rows = await runRead<{ id: string; content: string; state: string; createdAt: string; metadata: string | null; embedding: string | null; userId: string; appName: string | null; categories: string[] }>(
    `MATCH (u:User)-[:HAS_MEMORY]->(m:Memory)
     WHERE m.state <> 'deleted'
     OPTIONAL MATCH (m)-[:CREATED_BY]->(a:App)
     OPTIONAL MATCH (m)-[:HAS_CATEGORY]->(c:Category)
     RETURN m.id AS id, m.content AS content, m.state AS state,
            m.createdAt AS createdAt, m.metadata AS metadata,
            m.embedding AS embedding,
            u.userId AS userId, a.appName AS appName,
            collect(c.name) AS categories`,
    {}
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
