/**
 * middleware/userValidation.ts — Spec 09: Namespace Isolation Hardening
 *
 * Utility for validating that a user_id is present on API requests.
 * Used in all memory-related routes to ensure every query can be
 * anchored to a specific User node in the graph.
 *
 * Usage in a route:
 *   const userIdOrErr = requireUserId(request);
 *   if (typeof userIdOrErr !== "string") return userIdOrErr;
 *   const userId = userIdOrErr;
 */
import { NextRequest, NextResponse } from "next/server";

/**
 * Extract user_id from:
 *  1. Query param  `?user_id=...`
 *  2. Header       `X-User-ID: ...`
 *
 * Returns the userId string on success, or a NextResponse(400) on failure.
 */
export function requireUserId(request: NextRequest): string | NextResponse {
  const userId =
    request.nextUrl.searchParams.get("user_id") ??
    request.headers.get("x-user-id") ??
    null;

  if (!userId || userId.trim() === "") {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }
  return userId.trim();
}
