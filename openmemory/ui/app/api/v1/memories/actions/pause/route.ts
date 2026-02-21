/**
 * POST /api/v1/memories/actions/pause
 * Body: { user_id, memory_ids?: string[] }
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { pauseMemory } from "@/lib/memory/write";
import { runWrite } from "@/lib/db/memgraph";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, memory_ids, paused } = body;
  if (!user_id) return NextResponse.json({ detail: "user_id required" }, { status: 400 });

  const newState = paused === false ? "active" : "paused";

  if (!memory_ids || memory_ids.length === 0) {
    // pause/unpause all for user
    await runWrite(
      `MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory)
       WHERE m.state <> 'deleted' SET m.state = $state`,
      { userId: user_id, state: newState }
    );
    return NextResponse.json({ message: `All memories set to ${newState}` });
  }
  const results = await Promise.all(
    memory_ids.map((id: string) => pauseMemory(id, user_id))
  );
  const changed = results.filter(Boolean).length;
  return NextResponse.json({ message: `${changed} memories set to ${newState}`, changed });
}
