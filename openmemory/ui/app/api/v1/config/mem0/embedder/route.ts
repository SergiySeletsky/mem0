/**
 * /api/v1/config/mem0/embedder — removed.
 * Embedder is configured exclusively via environment variables (OPENAI_API_KEY, EMBEDDING_AZURE_*).
 * This endpoint is no longer writable.
 */
import { NextResponse } from "next/server";

const MSG = { detail: "Embedder configuration is managed via environment variables and cannot be changed at runtime." };

export async function GET() { return NextResponse.json(MSG, { status: 410 }); }
export async function PUT() { return NextResponse.json(MSG, { status: 410 }); }
