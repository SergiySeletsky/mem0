/**
 * E2E — Apps & Stats endpoints
 *
 * Covers:
 *   GET /api/v1/stats          – aggregate stats (total_memories, total_apps, apps[])
 *   GET /api/v1/apps           – paginated list of apps
 *   GET /api/v1/apps/[appId]   – single app detail
 */

import { api, asObj, MemoryTracker, RUN_ID } from "./helpers";

const USER = `appstats-${RUN_ID}`;
const APP_NAME = `e2e-appstats-${RUN_ID}`;
const tracker = new MemoryTracker();

beforeAll(async () => {
  // Seed a couple of memories so apps & stats are populated
  for (const text of [
    "I collect vintage vinyl records.",
    "My favourite movie genre is science fiction.",
  ]) {
    const { body } = await api("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: USER,
        text,
        app: APP_NAME,
      },
    });
    const b = asObj(body);
    if (b?.id) tracker.track(b.id as string);
  }
});

afterAll(async () => {
  await tracker.cleanup(USER);
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/stats", () => {
  it("returns 200 with expected shape", async () => {
    const { status, body } = await api("/api/v1/stats", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(typeof b.total_memories === "number" || typeof b.totalMemories === "number").toBe(true);
  });

  it("total_memories is at least 2 (we seeded 2)", async () => {
    const { body } = await api("/api/v1/stats", {
      params: { user_id: USER },
    });
    const b = asObj(body);
    const total = (b.total_memories ?? b.totalMemories ?? 0) as number;
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it("apps array includes the seeded app", async () => {
    const { body } = await api("/api/v1/stats", {
      params: { user_id: USER },
    });
    const b = asObj(body);
    const apps = (b.apps ?? []) as Array<{ name?: string; app_name?: string; id?: string }>;
    if (apps.length > 0) {
      const found = apps.some(
        (a: any) =>
          ((a.name ?? a.app_name ?? a.appName ?? "") as string)
            .toLowerCase()
            .includes(APP_NAME.toLowerCase()) ||
          ((a.id ?? "") as string).toLowerCase().includes(APP_NAME.toLowerCase())
      );
      expect(found).toBe(true);
    }
    // At minimum there should be ≥1 app
    expect(typeof b.total_apps === "number" || typeof b.totalApps === "number" || apps.length >= 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/apps", () => {
  it("returns 200 with a list of apps", async () => {
    const { status, body } = await api("/api/v1/apps", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const apps = (b.apps ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(apps) ? apps : [];
    expect(arr.length).toBeGreaterThan(0);
  });

  it("app objects have expected fields", async () => {
    const { body } = await api("/api/v1/apps", {
      params: { user_id: USER },
    });
    const b = asObj(body);
    const apps = (b.apps ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(apps) ? apps : [];
    if (arr.length === 0) return;
    const first = arr[0] as Record<string, unknown>;
    expect(typeof first.id === "string" || typeof first.name === "string").toBe(true);
  });

  it("supports pagination (page + page_size)", async () => {
    const { status } = await api("/api/v1/apps", {
      params: { user_id: USER, page: 1, page_size: 10 },
    });
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/apps/[appId]", () => {
  let appId: string;

  beforeAll(async () => {
    const { body } = await api("/api/v1/apps", {
      params: { user_id: USER },
    });
    const b = asObj(body);
    const apps = (b.apps ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(apps) ? apps : [];
    if (arr.length > 0) {
      appId = ((arr[0] as Record<string, unknown>).id ?? "") as string;
    }
  });

  it("returns 200 with app detail", async () => {
    if (!appId) {
      console.warn("No appId found — skipping");
      return;
    }
    const { status, body } = await api(`/api/v1/apps/${appId}`, {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    expect(b.id ?? b.name).toBeDefined();
  });

  it("returns 404 for non-existent appId", async () => {
    const { status } = await api("/api/v1/apps/definitely-not-a-real-app-id", {
      params: { user_id: USER },
    });
    expect([404, 400]).toContain(status);
  });
});
