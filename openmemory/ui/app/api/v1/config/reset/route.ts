/**
 * POST /api/v1/config/reset
 * Spec 00: Memgraph port
 */
import { NextResponse } from "next/server";
import { runWrite } from "@/lib/db/memgraph";

export async function POST() {
  await runWrite(`MATCH (c:Config) DELETE c`, {});
  return NextResponse.json({ message: "Config reset to defaults" });
}
