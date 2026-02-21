/**
 * POST /api/v1/memories/search -- Hybrid search endpoint
 *
 * Spec 02: Combined full-text + vector search with RRF merging.
 * Returns ranked results with rrfScore, textRank, vectorRank per result.
 */
import { NextRequest, NextResponse } from "next/server";
import { hybridSearch } from "@/lib/search/hybrid";
import { z } from "zod";

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  user_id: z.string(),
  top_k: z.number().int().min(1).max(50).optional().default(10),
  mode: z.enum(["hybrid", "text", "vector"]).optional().default("hybrid"),
});

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = SearchRequestSchema.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ detail: e.errors ?? e.message }, { status: 400 });
  }

  try {
    const results = await hybridSearch(body.query, {
      userId: body.user_id,
      topK: body.top_k,
      mode: body.mode,
    });

    return NextResponse.json({
      query: body.query,
      results,
      total: results.length,
    });
  } catch (e: any) {
    console.error("POST /memories/search error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
