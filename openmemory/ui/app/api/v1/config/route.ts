/**
 * GET/PUT/PATCH /api/v1/config
 * Stores configuration as Config nodes in Memgraph.
 * Spec 00: Memgraph port
 */
import { NextRequest, NextResponse } from "next/server";
import { runRead, runWrite } from "@/lib/db/memgraph";

async function getConfig(): Promise<Record<string, any>> {
  const rows = await runRead(
    `MATCH (c:Config) RETURN c.key AS key, c.value AS value`,
    {}
  );
  const result: Record<string, any> = {};
  for (const r of rows as any[]) {
    try { result[r.key] = JSON.parse(r.value); } catch { result[r.key] = r.value; }
  }
  return result;
}

async function setConfig(updates: Record<string, any>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    await runWrite(
      `MERGE (c:Config {key: $key}) SET c.value = $value`,
      { key, value: JSON.stringify(value) }
    );
  }
}

export async function GET() {
  return NextResponse.json(await getConfig());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  await setConfig(body);
  return NextResponse.json(await getConfig());
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  await setConfig(body);
  return NextResponse.json(await getConfig());
}
