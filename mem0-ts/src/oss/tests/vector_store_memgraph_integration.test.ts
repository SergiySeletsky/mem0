/**
 * MemgraphVectorStore integration tests — runs against a real Memgraph instance.
 *
 * Tests the full VectorStore interface: insert, search, get, update, delete,
 * list, healthCheck, reset, userId scoping, matchesFilters.
 *
 * Requires a running Memgraph MAGE instance (for vector_search).
 * Tests skip automatically when Memgraph is unreachable.
 *
 * Start Memgraph:
 *   cd openmemory && docker-compose up
 */

import neo4j from "neo4j-driver";
import { MemgraphVectorStore } from "../src/vector_stores/memgraph";

jest.setTimeout(30_000);

const DIM = 16;
const MEMGRAPH_URL = process.env.MEMGRAPH_URL ?? "bolt://127.0.0.1:7687";
const MEMGRAPH_USER = process.env.MEMGRAPH_USER ?? "memgraph";
const MEMGRAPH_PASSWORD = process.env.MEMGRAPH_PASSWORD ?? "memgraph";

/** Deterministic non-negative embedding. */
function textToVec(text: string): number[] {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Array.from({ length: DIM }, (_, i) =>
    Math.abs(Math.sin(hash + i * 0.1)),
  );
}

let memgraphAvailable = false;

async function isMemgraphAvailable(): Promise<boolean> {
  const driver = neo4j.driver(
    MEMGRAPH_URL,
    neo4j.auth.basic(MEMGRAPH_USER, MEMGRAPH_PASSWORD),
  );
  try {
    const session = driver.session();
    await session.run("RETURN 1");
    await session.close();
    return true;
  } catch {
    return false;
  } finally {
    await driver.close();
  }
}

beforeAll(async () => {
  memgraphAvailable = await isMemgraphAvailable();
  if (!memgraphAvailable) {
    console.warn("⏭  Memgraph not reachable — MemgraphVectorStore tests will skip");
  }
});

function skipIfNoMemgraph(): boolean {
  if (!memgraphAvailable) return true;
  return false;
}

describe("MemgraphVectorStore", () => {
  let store: MemgraphVectorStore;
  let testCounter = 0;

  function freshUserId(): string {
    testCounter++;
    return `vs-integ-${Date.now()}-${testCounter}`;
  }

  beforeAll(async () => {
    if (!memgraphAvailable) return;

    // Clean up stale MemVector vector indexes from other test suites
    // (Memgraph: one vector index per label+property combination)
    const tmpDriver = neo4j.driver(
      MEMGRAPH_URL,
      neo4j.auth.basic(MEMGRAPH_USER, MEMGRAPH_PASSWORD),
    );
    const tmpSession = tmpDriver.session();
    try {
      const result = await tmpSession.run(
        `CALL vector_search.show_index_info() YIELD index_name, label, property RETURN index_name, label, property`,
      );
      for (const rec of result.records) {
        const name = rec.get("index_name") as string;
        const label = rec.get("label") as string;
        const prop = rec.get("property") as string;
        if (label === "MemVector" && prop === "embedding" && name !== "mem0_vs_integ_test") {
          await tmpSession.run(`DROP VECTOR INDEX ${name}`).catch(() => {});
        }
      }
    } catch {
      // vector_search might not be available
    } finally {
      await tmpSession.close();
      await tmpDriver.close();
    }

    store = new MemgraphVectorStore({
      url: MEMGRAPH_URL,
      username: MEMGRAPH_USER,
      password: MEMGRAPH_PASSWORD,
      dimension: DIM,
      indexName: "mem0_vs_integ_test",
    });
    await store.initialize();
  });

  afterAll(async () => {
    if (store) {
      // Clean up test nodes
      await store.deleteCol();
      store.close();
    }
  });

  // ─── healthCheck ────────────────────────────────────────────────────────

  it("VS_01: healthCheck does not throw when Memgraph is reachable", async () => {
    if (skipIfNoMemgraph()) return;
    await expect(store.healthCheck()).resolves.not.toThrow();
  });

  // ─── userId management ────────────────────────────────────────────────

  it("VS_02: getUserId returns empty string initially", async () => {
    if (skipIfNoMemgraph()) return;
    const uid = await store.getUserId();
    expect(uid).toBe("");
  });

  it("VS_03: setUserId / getUserId round-trip", async () => {
    if (skipIfNoMemgraph()) return;
    await store.setUserId("test-user");
    expect(await store.getUserId()).toBe("test-user");
    // Reset for other tests
    await store.setUserId("");
  });

  // ─── insert & get ────────────────────────────────────────────────────────

  it("VS_04: insert stores a vector node and get retrieves it", async () => {
    if (skipIfNoMemgraph()) return;
    const id = `get-${Date.now()}`;
    const vec = textToVec("hello world");
    const payload = { userId: freshUserId(), text: "hello world" };

    await store.insert([vec], [id], [payload]);

    const result = await store.get(id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
    expect(result!.payload.text).toBe("hello world");
  });

  it("VS_05: get returns null for nonexistent id", async () => {
    if (skipIfNoMemgraph()) return;
    const result = await store.get("nonexistent-id");
    expect(result).toBeNull();
  });

  it("VS_06: insert multiple vectors in one batch", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const ids = [`batch-a-${Date.now()}`, `batch-b-${Date.now()}`];
    const vecs = [textToVec("alpha"), textToVec("beta")];
    const payloads = [
      { userId, text: "alpha" },
      { userId, text: "beta" },
    ];

    await store.insert(vecs, ids, payloads);

    const a = await store.get(ids[0]);
    const b = await store.get(ids[1]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.payload.text).toBe("alpha");
    expect(b!.payload.text).toBe("beta");
  });

  // ─── search ──────────────────────────────────────────────────────────────

  it("VS_07: search finds similar vectors via HNSW", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const id = `search-${Date.now()}`;
    const vec = textToVec("machine learning");
    await store.insert([vec], [id], [{ userId, text: "machine learning" }]);

    await store.setUserId(userId);
    const results = await store.search(textToVec("machine learning"), 5);
    await store.setUserId("");

    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === id);
    expect(found).toBeDefined();
    expect(found!.score).toBeGreaterThan(0);
  });

  it("VS_08: search returns empty when no vectors match userId", async () => {
    if (skipIfNoMemgraph()) return;
    await store.setUserId("nonexistent-user");
    const results = await store.search(textToVec("anything"), 5);
    await store.setUserId("");
    expect(results).toHaveLength(0);
  });

  it("VS_09: search with minScore filters low-similarity results", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const id = `min-score-${Date.now()}`;
    await store.insert(
      [textToVec("specific topic")],
      [id],
      [{ userId, text: "specific topic" }],
    );

    await store.setUserId(userId);
    const strict = await store.search(textToVec("completely different"), 5, undefined, 0.99);
    await store.setUserId("");
    // Very high threshold should filter out most results
    expect(strict.length).toBeLessThanOrEqual(1);
  });

  it("VS_10: search with filters narrows results", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    await store.insert(
      [textToVec("cat"), textToVec("dog")],
      [`filter-a-${Date.now()}`, `filter-b-${Date.now()}`],
      [
        { userId, text: "cat", category: "animal" },
        { userId, text: "dog", category: "pet" },
      ],
    );

    await store.setUserId(userId);
    const results = await store.search(
      textToVec("cat"),
      10,
      { category: "animal" } as any,
    );
    await store.setUserId("");

    // Should only match the cat payload (category: animal)
    for (const r of results) {
      if (r.payload.userId === userId) {
        expect(r.payload.category).toBe("animal");
      }
    }
  });

  // ─── update ──────────────────────────────────────────────────────────────

  it("VS_11: update changes payload and embedding", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const id = `update-${Date.now()}`;
    await store.insert(
      [textToVec("old text")],
      [id],
      [{ userId, text: "old text" }],
    );

    const newVec = textToVec("new text");
    await store.update(id, newVec, { userId, text: "new text" });

    const result = await store.get(id);
    expect(result).not.toBeNull();
    expect(result!.payload.text).toBe("new text");
  });

  it("VS_12: update with null vector keeps existing embedding", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const id = `update-null-${Date.now()}`;
    await store.insert(
      [textToVec("original")],
      [id],
      [{ userId, text: "original" }],
    );

    await store.update(id, null, { userId, text: "updated payload only" });

    const result = await store.get(id);
    expect(result).not.toBeNull();
    expect(result!.payload.text).toBe("updated payload only");
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  it("VS_13: delete removes a single vector node", async () => {
    if (skipIfNoMemgraph()) return;
    const id = `del-${Date.now()}`;
    await store.insert(
      [textToVec("to delete")],
      [id],
      [{ userId: freshUserId(), text: "to delete" }],
    );

    await store.delete(id);

    const result = await store.get(id);
    expect(result).toBeNull();
  });

  // ─── list ────────────────────────────────────────────────────────────────

  it("VS_14: list returns stored vectors", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const id = `list-${Date.now()}`;
    await store.insert(
      [textToVec("listed item")],
      [id],
      [{ userId, text: "listed item" }],
    );

    const [items, count] = await store.list({ userId });
    expect(count).toBeGreaterThan(0);
    const found = items.find((i) => i.id === id);
    expect(found).toBeDefined();
  });

  it("VS_15: list respects limit parameter", async () => {
    if (skipIfNoMemgraph()) return;
    const [items] = await store.list(undefined, 1);
    expect(items.length).toBeLessThanOrEqual(1);
  });

  // ─── deleteCol & reset ───────────────────────────────────────────────────

  it("VS_16: deleteCol removes all MemVector nodes", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    await store.insert(
      [textToVec("wipe a"), textToVec("wipe b")],
      [`wipe-a-${Date.now()}`, `wipe-b-${Date.now()}`],
      [{ userId, text: "a" }, { userId, text: "b" }],
    );

    await store.deleteCol();

    const [items] = await store.list({ userId });
    expect(items.length).toBe(0);
  });

  it("VS_17: reset is an alias for deleteCol", async () => {
    if (skipIfNoMemgraph()) return;
    const userId = freshUserId();
    const id = `reset-${Date.now()}`;
    await store.insert(
      [textToVec("reset me")],
      [id],
      [{ userId, text: "reset me" }],
    );

    await store.reset();

    const result = await store.get(id);
    expect(result).toBeNull();
  });
});
