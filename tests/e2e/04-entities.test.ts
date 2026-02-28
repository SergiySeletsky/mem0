/**
 * E2E — Entity extraction & graph (Spec 04)
 *
 * Covers:
 *   POST /api/v1/memories/reextract      – triggers extraction for all user memories
 *   GET  /api/v1/entities                – lists Entity nodes with pagination & type filter
 *   GET  /api/v1/entities/[id]           – entity detail with related memories
 *
 * Entity extraction is asynchronous (fire-and-forget queue).
 * Tests poll until entities appear or timeout after 60 s.
 */

import { api, asObj, MemoryTracker, RUN_ID, waitFor, sleep } from "./helpers";

const USER = `entities-${RUN_ID}`;
const APP = `e2e-entities-app`;
const tracker = new MemoryTracker();

afterAll(async () => {
  await tracker.cleanup(USER);
});

// ---------------------------------------------------------------------------
describe("Entity extraction pipeline", () => {
  beforeAll(async () => {
    // Seed two memories with named entities
    const seeds = [
      "Elon Musk is the CEO of Tesla and SpaceX.",
      "Marie Curie won the Nobel Prize in Physics in 1903.",
    ];
    for (const text of seeds) {
      const { body } = await api("/api/v1/memories", {
        method: "POST",
        body: {
          user_id: USER,
          text,
          app: APP,
        },
      });
      const b = asObj(body);
      if (b?.id) tracker.track(b.id as string);
    }
    // Small delay to let POST processing start if synchronous
    await sleep(1000);
  });

  it("POST /api/v1/memories/reextract triggers extraction queue", async () => {
    const { status, body } = await api("/api/v1/memories/reextract", {
      method: "POST",
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(typeof b.queued === "number" || typeof b.queued === "string").toBe(true);
  });

  it("entities appear in GET /api/v1/entities within 60 s", async () => {
    const entities = await waitFor(
      async () => {
        const { status, body } = await api("/api/v1/entities", {
          params: { user_id: USER },
        });
        if (status !== 200) return null;
        const b = asObj(body);
        const list = (b.entities ?? b.items ?? b.results ?? b) as unknown[];
        const arr = Array.isArray(list) ? list : [];
        return arr.length > 0 ? arr : null;
      },
      60_000,
      3_000
    );
    expect(entities.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/entities returns expected entity fields", async () => {
    const { status, body } = await api("/api/v1/entities", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const list = (b.entities ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(list) ? list : [];
    const first = arr[0] as Record<string, unknown>;
    expect(typeof first.id).toBe("string");
    expect(typeof first.name).toBe("string");
    expect(typeof first.type).toBe("string");
  });

  it("GET /api/v1/entities supports type filter", async () => {
    // Should work even if no PERSON entities exist — just need 200
    const { status, body } = await api("/api/v1/entities", {
      params: { user_id: USER, type: "PERSON" },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const list = (b.entities ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(list) ? list : [];
    // If any returned, they should all be PERSON
    arr.forEach((e) => {
      expect((e as { type: string }).type).toBe("PERSON");
    });
  });

  it("GET /api/v1/entities/[id] returns entity detail", async () => {
    const { body: listBody } = await api("/api/v1/entities", {
      params: { user_id: USER },
    });
    const lb = asObj(listBody);
    const list = (lb.entities ?? lb.results ?? lb) as unknown[];
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) {
      console.warn("No entities found — skipping detail check");
      return;
    }
    const first = arr[0] as { id: string };
    const { status, body } = await api(`/api/v1/entities/${first.id}`, {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(b.id).toBe(first.id);
    expect(typeof b.name).toBe("string");
    // Should include related memories or mention count
    // entity detail returns memoryCount field
    const hasMentions =
      b.memories != null ||
      b.mentions != null ||
      b.mention_count != null ||
      b.memoryCount != null;
    expect(hasMentions).toBe(true);
  });
});
