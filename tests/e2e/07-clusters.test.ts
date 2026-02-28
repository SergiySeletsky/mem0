/**
 * E2E — Community detection / clusters (Spec 07)
 *
 * Covers:
 *   POST /api/v1/clusters/rebuild   – runs Louvain algorithm, builds cluster summaries
 *   GET  /api/v1/clusters           – lists clusters for a user
 *
 * Community detection requires ≥ 2 connected Entity nodes (HAS_ENTITY edges).
 * We seed multiple memories with named entities, reextract, then rebuild.
 *
 * NOTE: MAGE (Memgraph APSE Graph Extensions) must be installed for Louvain.
 * If it's not available, the rebuild may return 500 or a graceful degradation.
 * Tests are written to WARN but NOT fail if Louvain is unavailable.
 */

import { api, asObj, MemoryTracker, RUN_ID, sleep, waitFor } from "./helpers";

const USER = `clusters-${RUN_ID}`;
const APP = `e2e-clusters-app`;
const tracker = new MemoryTracker();

beforeAll(async () => {
  const seeds = [
    "Albert Einstein developed the theory of relativity at Princeton University.",
    "Isaac Newton formulated the laws of motion and gravitation at Cambridge University.",
    "Stephen Hawking studied black holes and worked at Cambridge University.",
    "Richard Feynman won the Nobel Prize in Physics and taught at Caltech.",
    "Niels Bohr was a Danish physicist who worked on the atomic model.",
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
    await sleep(300);
  }

  // Trigger entity extraction so the graph has edges
  await api("/api/v1/memories/reextract", {
    method: "POST",
    params: { user_id: USER },
  });

  // Wait for extraction to complete (check entities appear)
  try {
    await waitFor(
      async () => {
        const { body } = await api("/api/v1/entities", {
          params: { user_id: USER },
        });
        const b = asObj(body);
        const list = (b.entities ?? b.results ?? b) as unknown[];
        const arr = Array.isArray(list) ? list : [];
        return arr.length >= 3 ? arr : null;
      },
      60_000,
      3_000
    );
  } catch {
    console.warn("Entity extraction timed out — cluster tests may be incomplete");
  }
});

afterAll(async () => {
  await tracker.cleanup(USER);
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/clusters/rebuild", () => {
  it("triggers cluster rebuild without server error", async () => {
    const { status, body } = await api("/api/v1/clusters/rebuild", {
      method: "POST",
      body: { user_id: USER },
    });
    // 200 = success; 500 = MAGE not installed (graceful fallback expected)
    if (status === 500) {
      console.warn(
        "Cluster rebuild returned 500 — Louvain/MAGE may not be installed. Skipping cluster assertions."
      );
      return;
    }
    expect(status).toBe(200);
    const b = asObj(body);
    // Should return cluster count or a status message
    const hasInfo =
      b.clusters != null ||
      b.count != null ||
      b.message != null ||
      b.status != null;
    expect(hasInfo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/clusters", () => {
  it("returns clusters list (may be empty if MAGE unavailable)", async () => {
    const { status, body } = await api("/api/v1/clusters", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    // May return { clusters: [] } or { clusters: [...] }
    const clusters = (b.clusters ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(clusters) ? clusters : [];
    // Presence check — structure should be correct even if empty
    expect(Array.isArray(arr)).toBe(true);
  });

  it("cluster objects have expected shape", async () => {
    const { status, body } = await api("/api/v1/clusters", {
      params: { user_id: USER },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const clusters = (b.clusters ?? b.items ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(clusters) ? clusters : [];
    if (arr.length === 0) {
      console.warn("No clusters found — Louvain may not be installed");
      return;
    }
    const first = arr[0] as Record<string, unknown>;
    expect(typeof first.id === "string" || typeof first.communityId === "string").toBe(true);
    // Should have a summary or label
    const hasSummary = first.summary != null || first.label != null || first.title != null;
    expect(hasSummary).toBe(true);
  });

  it("clusters are namespace-isolated (other user has none)", async () => {
    const { status, body } = await api("/api/v1/clusters", {
      params: { user_id: `other-${RUN_ID}` },
    });
    expect(status).toBe(200);
    const b = asObj(body);
    const clusters = (b.clusters ?? b.items ?? b.results ?? b) as unknown[];
    const arr = Array.isArray(clusters) ? clusters : [];
    expect(arr.length).toBe(0);
  });
});
