/**
 * MemgraphHistoryManager integration tests — runs against a real Memgraph instance.
 *
 * Covers: addHistory, getHistory (ordered), getHistory (empty), reset, close.
 *
 * Requires a running Memgraph instance.
 * Tests skip automatically when Memgraph is unreachable.
 *
 * Start Memgraph:
 *   cd openmemory && docker-compose up
 */

import neo4j from "neo4j-driver";
import { MemgraphHistoryManager } from "../src/storage/MemgraphHistoryManager";

jest.setTimeout(30_000);

const MEMGRAPH_URL = process.env.MEMGRAPH_URL ?? "bolt://127.0.0.1:7687";
const MEMGRAPH_USER = process.env.MEMGRAPH_USER ?? "memgraph";
const MEMGRAPH_PASSWORD = process.env.MEMGRAPH_PASSWORD ?? "memgraph";

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
    console.warn("⏭  Memgraph not reachable — MemgraphHistoryManager tests will skip");
  }
});

function skipIfNoMemgraph(): boolean {
  if (!memgraphAvailable) return true;
  return false;
}

describe("MemgraphHistoryManager", () => {
  let manager: MemgraphHistoryManager;
  let testCounter = 0;

  function freshMemoryId(): string {
    testCounter++;
    return `hm-integ-${Date.now()}-${testCounter}`;
  }

  beforeAll(async () => {
    if (!memgraphAvailable) return;
    manager = new MemgraphHistoryManager({
      url: MEMGRAPH_URL,
      username: MEMGRAPH_USER,
      password: MEMGRAPH_PASSWORD,
    });
    // Wait for async init to complete
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    if (manager) {
      // Clean up test history nodes
      await manager.reset();
      manager.close();
    }
  });

  // ─── addHistory ─────────────────────────────────────────────────────────

  it("HM_01: addHistory creates a MemoryHistory node", async () => {
    if (skipIfNoMemgraph()) return;
    const memId = freshMemoryId();
    const now = new Date().toISOString();

    await manager.addHistory(
      memId,
      null,
      "first value",
      "ADD",
      now,
      now,
      0,
    );

    const history = await manager.getHistory(memId);
    expect(history.length).toBe(1);
    expect(history[0].memory_id).toBe(memId);
    expect(history[0].new_value).toBe("first value");
    expect(history[0].action).toBe("ADD");
    expect(history[0].is_deleted).toBe(0);
  });

  it("HM_02: addHistory with previous_value records update", async () => {
    if (skipIfNoMemgraph()) return;
    const memId = freshMemoryId();
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();

    await manager.addHistory(memId, null, "original", "ADD", t1, t1, 0);
    await manager.addHistory(memId, "original", "updated", "UPDATE", t2, t2, 0);

    const history = await manager.getHistory(memId);
    expect(history.length).toBe(2);
    // Newest first (ORDER BY created_at DESC)
    const latest = history[0];
    expect(latest.action).toBe("UPDATE");
    expect(latest.previous_value).toBe("original");
    expect(latest.new_value).toBe("updated");
  });

  it("HM_03: addHistory with is_deleted=1 marks deletion", async () => {
    if (skipIfNoMemgraph()) return;
    const memId = freshMemoryId();
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();

    await manager.addHistory(memId, null, "val", "ADD", t1, t1, 0);
    await manager.addHistory(memId, "val", null, "DELETE", t2, t2, 1);

    const history = await manager.getHistory(memId);
    expect(history.length).toBe(2);
    const latest = history[0];
    expect(latest.action).toBe("DELETE");
    expect(latest.is_deleted).toBe(1);
  });

  // ─── getHistory ─────────────────────────────────────────────────────────

  it("HM_04: getHistory returns entries in reverse chronological order", async () => {
    if (skipIfNoMemgraph()) return;
    const memId = freshMemoryId();

    // Insert 3 entries with distinct timestamps
    for (let i = 0; i < 3; i++) {
      const ts = new Date(Date.now() + i * 1000).toISOString();
      await manager.addHistory(
        memId,
        i > 0 ? `v${i - 1}` : null,
        `v${i}`,
        i === 0 ? "ADD" : "UPDATE",
        ts,
        ts,
        0,
      );
    }

    const history = await manager.getHistory(memId);
    expect(history.length).toBe(3);
    // Newest first
    expect(history[0].new_value).toBe("v2");
    expect(history[1].new_value).toBe("v1");
    expect(history[2].new_value).toBe("v0");
  });

  it("HM_05: getHistory returns empty array for unknown memoryId", async () => {
    if (skipIfNoMemgraph()) return;
    const history = await manager.getHistory("nonexistent-id");
    expect(history).toEqual([]);
  });

  it("HM_06: getHistory entries have unique id fields", async () => {
    if (skipIfNoMemgraph()) return;
    const memId = freshMemoryId();
    const now = new Date().toISOString();

    await manager.addHistory(memId, null, "a", "ADD", now, now, 0);
    await manager.addHistory(memId, "a", "b", "UPDATE", now, now, 0);

    const history = await manager.getHistory(memId);
    expect(history.length).toBe(2);
    const ids = history.map((h) => h.id);
    expect(new Set(ids).size).toBe(2); // All unique
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  // ─── reset ──────────────────────────────────────────────────────────────

  it("HM_07: reset wipes all MemoryHistory nodes", async () => {
    if (skipIfNoMemgraph()) return;
    const memId = freshMemoryId();
    const now = new Date().toISOString();
    await manager.addHistory(memId, null, "temp", "ADD", now, now, 0);

    await manager.reset();

    const history = await manager.getHistory(memId);
    expect(history).toEqual([]);
  });

  // ─── close / reconnect ──────────────────────────────────────────────────

  it("HM_08: close shuts down the driver without error", async () => {
    if (skipIfNoMemgraph()) return;
    // Create a temporary manager and close it
    const temp = new MemgraphHistoryManager({
      url: MEMGRAPH_URL,
      username: MEMGRAPH_USER,
      password: MEMGRAPH_PASSWORD,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => temp.close()).not.toThrow();
  });

  // ─── init idempotency ──────────────────────────────────────────────────

  it("HM_09: creating multiple managers with same config is idempotent", async () => {
    if (skipIfNoMemgraph()) return;
    const mgr1 = new MemgraphHistoryManager({
      url: MEMGRAPH_URL,
      username: MEMGRAPH_USER,
      password: MEMGRAPH_PASSWORD,
    });
    const mgr2 = new MemgraphHistoryManager({
      url: MEMGRAPH_URL,
      username: MEMGRAPH_USER,
      password: MEMGRAPH_PASSWORD,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const memId = freshMemoryId();
    const now = new Date().toISOString();
    await mgr1.addHistory(memId, null, "idempotent", "ADD", now, now, 0);
    const history = await mgr2.getHistory(memId);

    expect(history.length).toBe(1);
    expect(history[0].new_value).toBe("idempotent");

    mgr1.close();
    mgr2.close();
  });
});
