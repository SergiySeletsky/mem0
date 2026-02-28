/**
 * POST /api/v1/clusters/rebuild — Spec 07
 * Triggers community detection + cluster summarization for a user.
 */
import { NextRequest, NextResponse } from "next/server";
import { rebuildClusters } from "@/lib/clusters/build";

export async function POST(request: NextRequest) {
  let body: { user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const { user_id } = body;
  if (!user_id) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }

  try {
    await rebuildClusters(user_id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
