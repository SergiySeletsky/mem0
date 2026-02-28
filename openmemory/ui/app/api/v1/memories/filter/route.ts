/**
 * POST /api/v1/memories/filter
 * Body (hook format): { user_id, page?, size?, search_query?, app_ids?, category_ids?, show_archived? }
 * Also accepts legacy format:  { user_id, filters:{...}, page?, page_size? }
 * Returns: { items, total, page, size, pages }
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead } from "@/lib/db/memgraph";

interface FilterBody {
  user_id?: string;
  page?: number;
  size?: number;
  page_size?: number;
  search_query?: string;
  app_ids?: string[];
  category_ids?: string[];
  show_archived?: boolean;
  filters?: { app_name?: string; categories?: string[]; state?: string };
}

export async function POST(request: NextRequest) {
  let body: FilterBody;
  try {
    body = (await request.json()) as FilterBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  try {

  // Accept both the hook's flat format and the legacy nested-filters format
  const user_id: string | undefined = body.user_id;
  const page: number = body.page ?? 1;
  const pageSize: number = body.size ?? body.page_size ?? 20;
  const searchQuery: string | undefined = body.search_query;
  const appIds: string[] | undefined = body.app_ids ?? (body.filters?.app_name ? [body.filters.app_name] : undefined);
  const categoryIds: string[] | undefined = body.category_ids ?? body.filters?.categories;
  const showArchived: boolean = body.show_archived ?? false;
  const stateFilter: string | undefined = body.filters?.state;

  if (!user_id) return NextResponse.json({ detail: "user_id required" }, { status: 400 });

  const skip = (page - 1) * pageSize;
  const whereParts: string[] = [];
  const queryParams: Record<string, unknown> = { userId: user_id, skip, limit: pageSize };

  // Spec 01: always exclude superseded (bi-temporal) memories unless caller explicitly
  // requests historical data. supersedeMemory() sets invalidAt but keeps state='active',
  // so a state filter alone is insufficient.
  if (!showArchived) {
    whereParts.push("m.invalidAt IS NULL");
  }

  // State filter
  if (stateFilter) {
    whereParts.push("m.state = $state");
    queryParams.state = stateFilter;
  } else if (showArchived) {
    whereParts.push("m.state <> 'deleted'");
  } else {
    whereParts.push("m.state = 'active'");
  }

  // App filter (array of app names)
  if (appIds && appIds.length > 0) {
    whereParts.push("a.appName IN $appNames");
    queryParams.appNames = appIds;
  }

  // Category filter
  if (categoryIds && categoryIds.length > 0) {
    whereParts.push("ANY(catName IN $catNames WHERE (m)-[:HAS_CATEGORY]->(:Category {name: catName}))");
    queryParams.catNames = categoryIds;
  }

  // Text search (simple substring match on content)
  if (searchQuery && searchQuery.trim()) {
    whereParts.push("toLower(m.content) CONTAINS toLower($searchQuery)");
    queryParams.searchQuery = searchQuery.trim();
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const [rows, countRows] = await Promise.all([
    runRead<{ id: string; content: string; state?: string; createdAt?: string; metadata?: string; appName?: string; categories?: string[] }>(
      `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
       OPTIONAL MATCH (m)-[:CREATED_BY]->(a:App)
       OPTIONAL MATCH (m)-[:HAS_CATEGORY]->(c:Category)
       WITH u, m, a, collect(c.name) AS categories
       ${whereClause}
       RETURN m.id AS id, m.content AS content, m.state AS state,
              m.createdAt AS createdAt, m.metadata AS metadata,
              a.appName AS appName, categories
       ORDER BY m.createdAt DESC SKIP $skip LIMIT $limit`,
      queryParams
    ),
    runRead(
      `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
       OPTIONAL MATCH (m)-[:CREATED_BY]->(a:App)
       OPTIONAL MATCH (m)-[:HAS_CATEGORY]->(c:Category)
       WITH u, m, a, collect(c.name) AS categories
       ${whereClause}
       RETURN count(m) AS total`,
      queryParams
    ),
  ]);

  const total = (countRows[0] as { total?: number })?.total ?? 0;
  const pages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        content: r.content,
        created_at: r.createdAt ?? new Date(0).toISOString(),
        state: r.state || "active",
        app_id: null,
        app_name: r.appName || null,
        categories: r.categories || [],
        metadata_: r.metadata
          ? typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata
          : null,
      })),
      total,
      page,
      size: pageSize,
      pages,
    });
  } catch (err) {
    console.error("[POST /api/v1/memories/filter] error:", err);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}
