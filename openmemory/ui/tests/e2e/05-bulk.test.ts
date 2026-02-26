/**
 * E2E — Bulk ingestion (Spec 06)
 *
 * Covers:
 *   POST /api/v1/memories/bulk  – submit an array of memories in one request
 *
 * The bulk endpoint accepts { user_id, app_name, memories: [{text, metadata}], concurrency }
 * and returns { results: [{ id, event, memory }] }.
 */

import { api, asObj, MemoryTracker, RUN_ID } from "./helpers";

const USER = `bulk-${RUN_ID}`;
const APP = `e2e-bulk-app`;
const tracker = new MemoryTracker();

afterAll(async () => {
  await tracker.cleanup(USER);
});

const BATCH = [
  { text: "I enjoy reading science fiction novels.", metadata: { tag: "hobbies" } },
  { text: "I use Neovim as my primary text editor.", metadata: { tag: "tools" } },
  { text: "My daily commute is 30 minutes by bike.", metadata: { tag: "lifestyle" } },
  { text: "I am learning Japanese in my spare time.", metadata: { tag: "learning" } },
  { text: "I prefer dark mode in all my applications.", metadata: { tag: "preferences" } },
];

// ---------------------------------------------------------------------------
describe("POST /api/v1/memories/bulk", () => {
  let resultIds: string[] = [];

  it("accepts a batch of memories and returns results for each", async () => {
    const { status, body } = await api("/api/v1/memories/bulk", {
      method: "POST",
      body: {
        user_id: USER,
        app_name: APP,
        memories: BATCH,
        concurrency: 3,
      },
    });

    expect(status).toBe(200);
    const b = asObj(body);
    // Shape: { total, added, skipped_duplicate, failed, results }
    const results = (b.results ?? []) as Array<{ id: string; status: string }>;
    expect(Array.isArray(results)).toBe(true);
    expect(typeof b.total === "number" || results.length > 0).toBe(true);

    resultIds = results
      .filter((r) => r.id)
      .map((r) => r.id);
    tracker.trackAll(resultIds);
  });

  it("results include valid status values", async () => {
    const { body } = await api("/api/v1/memories/bulk", {
      method: "POST",
      body: {
        user_id: USER,
        app_name: APP,
        memories: BATCH.slice(0, 2),
      },
    });
    const b = asObj(body);
    const results = (b.results ?? []) as Array<{ status: string; id: string }>;
    results.forEach((r) => {
      if (r.id) tracker.track(r.id);
      const knownStatuses = ["added", "skipped_duplicate", "failed"];
      if (r.status) {
        expect(knownStatuses).toContain(r.status);
      }
    });
  });

  it("bulk-created memories appear in GET /api/v1/memories list", async () => {
    const { status, body } = await api("/api/v1/memories", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    // buildPageResponse → { items, total, page, size, pages }
    const arr = (b.items ?? []) as unknown[];
    expect(arr.length).toBeGreaterThan(0);

    // At least one of the batch memories should appear
    const storedIds = arr.map((m) => (m as { id: string }).id);
    const overlap = resultIds.filter((id) => storedIds.includes(id));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it("bulk-created memories are individually retrievable", async () => {
    if (resultIds.length === 0) return;
    const id = resultIds[0];
    const { status, body } = await api(`/api/v1/memories/${id}`, {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(b.id).toBe(id);
    // Single memory GET returns 'text' field
    const text = String(b.text ?? b.content ?? "");
    expect(text.length).toBeGreaterThan(0);
  });

  it("supports concurrency parameter without errors", async () => {
    const { status } = await api("/api/v1/memories/bulk", {
      method: "POST",
      body: {
        user_id: USER,
        app_name: APP,
        memories: [{ text: "Concurrency test memory." }],
        concurrency: 1,
      },
    });
    expect(status).toBe(200);
  });
});
