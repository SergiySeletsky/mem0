/**
 * E2E — Memory CRUD
 *
 * Actual API shapes (Memgraph-based):
 *   POST   /api/v1/memories      body: { user_id, text, app? }
 *                                resp: { id, content, state, createdAt, ... }
 *   GET    /api/v1/memories      resp: { items: [...], total, page, size, pages }
 *   GET    /api/v1/memories/[id] resp: { id, text, state, ... }
 *   PUT    /api/v1/memories/[id] body: { memory_content, user_id }
 *                                resp: { id, content, ... }
 *   DELETE /api/v1/memories      body: { memory_ids: UUID[], user_id }
 */

import { api, asObj, MemoryTracker, RUN_ID } from "./helpers";

const USER = `crud-${RUN_ID}`;
const APP = `e2e-crud-app`;
const tracker = new MemoryTracker();

afterAll(async () => {
  await tracker.cleanup(USER);
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/memories — create", () => {
  let createdId: string;

  it("creates a memory and returns an id", async () => {
    const { status, body } = await api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER,
        text: "My favourite programming language is TypeScript.",
        app: APP,
      },
    });

    expect(status).toBe(200);
    const b = asObj(body);
    // Route returns a single object { id, content, state, ... }
    expect(typeof b.id).toBe("string");
    expect((b.id as string).length).toBeGreaterThan(0);
    createdId = b.id as string;
    tracker.track(createdId);
  });

  it("GET /api/v1/memories/[id] returns the created memory", async () => {
    const { status, body } = await api(`/api/v1/memories/${createdId}`, {
      params: { user_id: USER },
    });

    expect(status).toBe(200);
    const b = asObj(body);
    expect(b.id).toBe(createdId);
    // GET single returns 'text' field
    const text = String(b.text ?? b.content ?? "");
    expect(text.toLowerCase()).toContain("typescript");
  });

  it("GET /api/v1/memories lists the memory under the user", async () => {
    const { status, body } = await api("/api/v1/memories", {
      params: { user_id: USER },
    });

    expect(status).toBe(200);
    const b = asObj(body);
    // buildPageResponse → { items, total, page, size, pages }
    const arr = b.items as unknown[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    const ids = arr.map((m) => (m as { id: string }).id);
    expect(ids).toContain(createdId);
  });
});

// ---------------------------------------------------------------------------
describe("PUT /api/v1/memories/[id] — update text", () => {
  let originalId: string;
  let newId: string;

  beforeAll(async () => {
    const { body } = await api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER,
        text: "I work at a small software startup.",
        app: APP,
      },
    });
    const b = asObj(body);
    originalId = b.id as string;
    tracker.track(originalId);
  });

  it("supersedes the old memory and returns a new id", async () => {
    const { status, body } = await api(`/api/v1/memories/${originalId}`, {
      method: "PUT",
      body: { memory_content: "I work at a large enterprise company.", user_id: USER },
    });

    expect(status).toBe(200);
    const b = asObj(body);
    expect(typeof b.id).toBe("string");
    newId = b.id as string;
    expect(newId).not.toBe(originalId);
    tracker.track(newId);
  });

  it("new memory has the updated text", async () => {
    const { status, body } = await api(`/api/v1/memories/${newId}`, {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const text = String(b.text ?? b.content ?? "");
    expect(text.toLowerCase()).toContain("enterprise");
  });

  it("old memory has invalidAt set (bi-temporal supersession)", async () => {
    const { status, body } = await api(`/api/v1/memories/${originalId}`, {
      params: { user_id: USER },
    });
    // Old memory may be gone (404) or have invalidAt/supersededBy set
    if (status === 200) {
      const b = asObj(body);
      const isSuperseded =
        b.invalid_at != null ||
        b.superseded_by != null ||
        b.is_current === false;
      expect(isSuperseded).toBe(true);
    } else {
      expect(status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
describe("DELETE /api/v1/memories — bulk soft-delete", () => {
  let idToDelete: string;

  beforeAll(async () => {
    const { body } = await api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER,
        text: "I have a pet goldfish named Bubbles.",
        app: APP,
      },
    });
    const b = asObj(body);
    idToDelete = b.id as string;
    // Do NOT add to tracker — we're deleting it manually
  });

  it("deletes the memory and returns 200", async () => {
    const { status } = await api("/api/v1/memories", {
      method: "DELETE",
      body: { memory_ids: [idToDelete], user_id: USER },
    });
    expect(status).toBe(200);
  });

  it("deleted memory is soft-deleted (state=deleted or 404)", async () => {
    // DELETE is a soft-delete: node stays in Memgraph with state='deleted'
    // GET single returns 200 with state='deleted' (not 404)
    const { status, body } = await api(`/api/v1/memories/${idToDelete}`, {
      params: { user_id: USER },
    });
    expect([200, 404]).toContain(status);
    if (status === 200) {
      const b = asObj(body);
      expect(b.state).toBe("deleted");
    }
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/memories/categories", () => {
  it("returns a paginated or plain category response", async () => {
    const { status, body } = await api("/api/v1/memories/categories", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    // May be { items: [...] } or plain array
    expect(body).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/memories/filter", () => {
  it("returns memories matching filter criteria", async () => {
    const { status, body } = await api("/api/v1/memories/filter", {
      method: "POST",
      body: {
        user_id: USER,
        page: 1,
        size: 50,
      },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    // buildPageResponse → { items, total, page, size, pages }
    expect(b.items ?? b.total).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/memories — search_query filter", () => {
  it("returns results when searching by keyword", async () => {
    const { status, body } = await api("/api/v1/memories", {
      params: { user_id: USER, search_query: "typescript" },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    // buildPageResponse shape
    const arr = (b.items ?? []) as unknown[];
    // Should find at least the TypeScript memory created earlier
    expect(arr.length).toBeGreaterThan(0);
  });
});
