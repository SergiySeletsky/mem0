/**
 * GET/PUT /api/v1/config/openmemory
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead, runWrite } from "@/lib/db/memgraph";

const CONFIG_KEY = "openmemory_config";

export async function GET() {
  const rows = await runRead(`MATCH (c:Config {key: $key}) RETURN c.value AS value`, { key: CONFIG_KEY });
  if (!rows.length) return NextResponse.json({});
  try { return NextResponse.json(JSON.parse((rows[0] as any).value)); } catch { return NextResponse.json({}); }
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  await runWrite(`MERGE (c:Config {key: $key}) SET c.value = $value`, { key: CONFIG_KEY, value: JSON.stringify(body) });
  return NextResponse.json(body);
}
