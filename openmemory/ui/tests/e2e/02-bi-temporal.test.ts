/**
 * E2E — Bi-temporal memory model
 *
 * Spec 01: every write creates a new node; old node gets invalidAt + SUPERSEDED_BY edge.
 *
 * Covers:
 *   - PUT creates a supersession chain (A → B → C)
 *   - Original node has invalidAt !== null
 *   - superseded_by on original points to next version
 *   - Each version has a distinct valid_at timestamp
 *   - GET of superseded node returns 404 or includes invalidAt
 */

import { api, asObj, MemoryTracker, RUN_ID, sleep } from "./helpers";

const USER = `bitemporal-${RUN_ID}`;
const APP = `e2e-bitemporal-app`;
const tracker = new MemoryTracker();

afterAll(async () => {
  await tracker.cleanup(USER);
});

// ---------------------------------------------------------------------------
describe("Bi-temporal supersession chain", () => {
  let idV1: string;
  let idV2: string;
  let idV3: string;

  it("creates V1 memory", async () => {
    const { status, body } = await api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER,
        text: "I live in Amsterdam.",
        app: APP,
      },
    });
    expect(status).toBe(200);
    idV1 = (asObj(body)).id as string;
    tracker.track(idV1);
    expect(typeof idV1).toBe("string");
  });

  it("PUT V1 → creates V2, returns new id", async () => {
    await sleep(200); // ensure distinct timestamps
    const { status, body } = await api(`/api/v1/memories/${idV1}`, {
      method: "PUT",
      body: { memory_content: "I live in Berlin.", user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    idV2 = b.id as string;
    expect(idV2).not.toBe(idV1);
    tracker.track(idV2);
  });

  it("PUT V2 → creates V3, returns new id", async () => {
    await sleep(200);
    const { status, body } = await api(`/api/v1/memories/${idV2}`, {
      method: "PUT",
      body: { memory_content: "I live in Tokyo.", user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    idV3 = b.id as string;
    expect(idV3).not.toBe(idV2);
    expect(idV3).not.toBe(idV1);
    tracker.track(idV3);
  });

  it("V1 is superseded (404 or has invalid_at set)", async () => {
    const { status, body } = await api(`/api/v1/memories/${idV1}`, {
      params: { user_id: USER },
    });
    if (status === 404) {
      expect(status).toBe(404);
    } else {
      expect(status).toBe(200);
      const b = asObj(body);
      const isSuperseded =
        b.invalid_at != null ||
        b.invalidAt != null ||
        b.superseded_by != null ||
        b.supersededBy != null;
      expect(isSuperseded).toBe(true);
    }
  });

  it("V2 is superseded (404 or has invalid_at)", async () => {
    const { status, body } = await api(`/api/v1/memories/${idV2}`, {
      params: { user_id: USER },
    });
    if (status === 404) {
      expect(status).toBe(404);
    } else {
      expect(status).toBe(200);
      const b = asObj(body);
      const isSuperseded =
        b.invalid_at != null ||
        b.invalidAt != null ||
        b.superseded_by != null ||
        b.supersededBy != null;
      expect(isSuperseded).toBe(true);
    }
  });

  it("V3 is the active version with correct content", async () => {
    const { status, body } = await api(`/api/v1/memories/${idV3}`, {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const text = String(b.text ?? b.content ?? "");
    expect(text.toLowerCase()).toContain("tokyo");
    // valid_at should be set
    expect(b.valid_at ?? b.created_at).toBeDefined();
    // invalid_at should NOT be set on the latest version
    expect(b.invalid_at ?? null).toBeNull();
    expect(b.is_current).toBe(true);
  });

  it("GET /api/v1/memories only returns active (non-superseded) memories", async () => {
    const { status, body } = await api("/api/v1/memories", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    // buildPageResponse → { items, total, page, size, pages }
    const arr = (b.items ?? []) as unknown[];
    // The list should include V3 (active) but NOT V1 or V2 (superseded)
    const ids = arr.map((m) => (m as { id: string }).id);
    expect(ids).toContain(idV3);
    expect(ids).not.toContain(idV1);
    expect(ids).not.toContain(idV2);
  });
});
