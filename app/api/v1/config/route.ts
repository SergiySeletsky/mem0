/**
 * GET/PUT/PATCH /api/v1/config
 * Stores configuration as Config nodes in Memgraph.
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead, runWrite } from "@/lib/db/memgraph";

async function getConfig(): Promise<Record<string, unknown>> {
  const rows = await runRead<{ key: string; value: string }>(
    `MATCH (c:Config) RETURN c.key AS key, c.value AS value`,
    {}
  );
  const result: Record<string, unknown> = {};
  for (const r of rows) {
    try { result[r.key] = JSON.parse(r.value); } catch { result[r.key] = r.value; }
  }
  return result;
}

async function setConfig(updates: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    await runWrite(
      `MERGE (c:Config {key: $key}) SET c.value = $value`,
      { key, value: JSON.stringify(value) }
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json(await getConfig());
  } catch (err) {
    console.error("[GET /api/v1/config] error:", err);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    await setConfig(body);
    return NextResponse.json(await getConfig());
  } catch (err) {
    console.error("[PUT /api/v1/config] error:", err);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    await setConfig(body);
    return NextResponse.json(await getConfig());
  } catch (err) {
    console.error("[PATCH /api/v1/config] error:", err);
    return NextResponse.json({ detail: "Internal server error" }, { status: 500 });
  }
}
