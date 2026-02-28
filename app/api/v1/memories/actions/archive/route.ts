/**
 * POST /api/v1/memories/actions/archive
 * Body: { user_id, memory_ids?: string[] }
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { archiveMemory } from "@/lib/memory/write";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, memory_ids } = body;
  if (!user_id) return NextResponse.json({ detail: "user_id required" }, { status: 400 });

  if (!memory_ids || memory_ids.length === 0) {
    return NextResponse.json({ detail: "memory_ids required" }, { status: 400 });
  }
  const results = await Promise.all(
    memory_ids.map((id: string) => archiveMemory(id, user_id))
  );
  const archived = results.filter(Boolean).length;
  return NextResponse.json({ message: `${archived} memories archived`, archived });
}
