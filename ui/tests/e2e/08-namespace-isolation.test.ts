/**
 * E2E — Namespace isolation (Spec 09)
 *
 * Every query is scoped to (userId, appId). No user can access another user's memories.
 *
 * Covers:
 *   - GET  /api/v1/memories/[id]?user_id=WRONG  → 404
 *   - GET  /api/v1/memories?user_id=WRONG        → empty list
 *   - PUT  /api/v1/memories/[id]?user_id=WRONG  → 403 or 404
 *   - POST /api/v1/memories/search               → results are per-user
 */

import { api, asObj, MemoryTracker, RUN_ID, sleep } from "./helpers";

const USER_A = `iso-a-${RUN_ID}`;
const USER_B = `iso-b-${RUN_ID}`;
const APP = `e2e-iso-app`;

const trackerA = new MemoryTracker();
const trackerB = new MemoryTracker();

let memoryIdA: string;
let memoryIdB: string;

beforeAll(async () => {
  // Create a memory for each user
  const [resA, resB] = await Promise.all([
    api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER_A,
        text: "User A's secret recipe is chocolate cake.",
        app: APP,
      },
    }),
    api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER_B,
        text: "User B's favorite sport is tennis.",
        app: APP,
      },
    }),
  ]);

  const bA = asObj(resA.body);
  const bB = asObj(resB.body);
  memoryIdA = bA.id as string;
  memoryIdB = bB.id as string;
  trackerA.track(memoryIdA);
  trackerB.track(memoryIdB);

  await sleep(500);
});

afterAll(async () => {
  await Promise.all([trackerA.cleanup(USER_A), trackerB.cleanup(USER_B)]);
});

// ---------------------------------------------------------------------------
describe("Cross-user memory access — GET single", () => {
  it("User A cannot access User B's memory (404)", async () => {
    const { status } = await api(`/api/v1/memories/${memoryIdB}`, {
      params: { user_id: USER_A },
    });
    expect(status).toBe(404);
  });

  it("User B cannot access User A's memory (404)", async () => {
    const { status } = await api(`/api/v1/memories/${memoryIdA}`, {
      params: { user_id: USER_B },
    });
    expect(status).toBe(404);
  });

  it("User A can access their own memory (200)", async () => {
    const { status, body } = await api(`/api/v1/memories/${memoryIdA}`, {
      params: { user_id: USER_A },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(b.id).toBe(memoryIdA);
  });

  it("User B can access their own memory (200)", async () => {
    const { status, body } = await api(`/api/v1/memories/${memoryIdB}`, {
      params: { user_id: USER_B },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(b.id).toBe(memoryIdB);
  });
});

// ---------------------------------------------------------------------------
describe("Cross-user memory access — GET list", () => {
  it("User A list does NOT contain User B's memory", async () => {
    const { status, body } = await api("/api/v1/memories", {
      params: { user_id: USER_A },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const arr = (b.items ?? []) as unknown[];
    const ids = arr.map((m) => (m as { id: string }).id);
    expect(ids).not.toContain(memoryIdB);
    expect(ids).toContain(memoryIdA);
  });

  it("User B list does NOT contain User A's memory", async () => {
    const { status, body } = await api("/api/v1/memories", {
      params: { user_id: USER_B },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const arr = (b.items ?? []) as unknown[];
    const ids = arr.map((m) => (m as { id: string }).id);
    expect(ids).not.toContain(memoryIdA);
    expect(ids).toContain(memoryIdB);
  });
});

// ---------------------------------------------------------------------------
describe("Cross-user mutation — PUT", () => {
  it("User A cannot supersede User B's memory", async () => {
    const { status } = await api(`/api/v1/memories/${memoryIdB}`, {
      method: "PUT",
      // user_id must be in the body (not query params) for the PUT route
      body: { memory_content: "Attempted cross-user overwrite.", user_id: USER_A },
    });
    // Should be 404 (not found for user A) or 403 (forbidden)
    expect([403, 404]).toContain(status);
  });
});

// ---------------------------------------------------------------------------
describe("Cross-user search isolation", () => {
  it("User A's search does not return User B's memories", async () => {
    const { status, body } = await api("/api/v1/memories/search", {
      method: "POST",
      body: {
        query: "tennis sport",
        user_id: USER_A,
        top_k: 10,
        mode: "hybrid",
      },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const results = (b.results ?? b.memories ?? b) as unknown[];
    const arr = Array.isArray(results) ? results : [];
    const ids = arr.map((m) => (m as { id: string }).id);
    expect(ids).not.toContain(memoryIdB);
  });

  it("User B's search does not return User A's memories", async () => {
    const { status, body } = await api("/api/v1/memories/search", {
      method: "POST",
      body: {
        query: "chocolate cake recipe",
        user_id: USER_B,
        top_k: 10,
        mode: "hybrid",
      },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const results = (b.results ?? b.memories ?? b) as unknown[];
    const arr = Array.isArray(results) ? results : [];
    const ids = arr.map((m) => (m as { id: string }).id);
    expect(ids).not.toContain(memoryIdA);
  });
});
