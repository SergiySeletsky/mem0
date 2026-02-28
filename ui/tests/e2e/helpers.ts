/**
 * Shared utilities for E2E integration tests.
 *
 * Tests run against the live Next.js dev server on http://localhost:3000.
 * Each test suite uses a unique userId derived from the suite name + timestamp
 * so test data is isolated and does not pollute the real user's memories.
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Unique identifiers
// ---------------------------------------------------------------------------

/** Test-run-scoped user ID — unique per process invocation */
export const RUN_ID = `e2e-${Date.now()}`;

/** Generate a deterministic app name for a given test suite */
export function testApp(suite: string): string {
  return `e2e-app-${suite}-${RUN_ID}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/** Thin fetch wrapper. Returns { status, body } where body is JSON. */
export async function api(
  path: string,
  opts: ApiOptions = {}
): Promise<{ status: number; body: unknown }> {
  const { body, params, ...rest } = opts;

  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };

  const response = await fetch(url, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let responseBody: unknown;
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    responseBody = await response.json();
  } else if (ct.includes("application/zip") || ct.includes("application/octet-stream")) {
    responseBody = await response.arrayBuffer();
  } else {
    responseBody = await response.text();
  }

  return { status: response.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

/**
 * Polls `fn` every `intervalMs` until it returns a truthy value or `timeoutMs` is exceeded.
 * Throws if the timeout is reached.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 60_000,
  intervalMs = 2_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result as T;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Cleanup registry
// ---------------------------------------------------------------------------

/**
 * Collects memory IDs created during a test suite.
 * Call `cleanup(userId)` in afterAll to soft-delete them all.
 */
export class MemoryTracker {
  private ids: string[] = [];

  track(id: string) {
    this.ids.push(id);
    return id;
  }

  trackAll(ids: string[]) {
    this.ids.push(...ids);
  }

  async cleanup(userId: string) {
    if (this.ids.length === 0) return;
    try {
      await api("/api/v1/memories", {
        method: "DELETE",
        // DELETE body: { memory_ids: UUID[], user_id }  (user_id in body, not query)
        body: { memory_ids: this.ids, user_id: userId },
      });
    } catch {
      // best-effort
    }
    this.ids = [];
  }
}

// ---------------------------------------------------------------------------
// Assertions helpers
// ---------------------------------------------------------------------------

/** Assert body is an object (type narrowing helper for TypeScript) */
export function asObj(body: unknown): Record<string, unknown> {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");
  return body as Record<string, unknown>;
}

/** Assert body is an array */
export function asArr(body: unknown): unknown[] {
  expect(Array.isArray(body)).toBe(true);
  return body as unknown[];
}
