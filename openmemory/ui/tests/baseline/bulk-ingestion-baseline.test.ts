export {};

/**
 * Baseline tests for Spec 06 — Bulk Ingestion API
 *
 * These tests document the POST-implementation state:
 *   BULK_BASE_01 — lib/memory/bulk.ts exists and exports bulkAddMemories
 *   BULK_BASE_02 — app/api/v1/memories/bulk/route.ts exists
 *   BULK_BASE_03 — lib/mem0/semaphore.ts exists and exports Semaphore
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("Spec 06 — Bulk Ingestion Baseline", () => {
  test("BULK_BASE_01: lib/memory/bulk.ts exists and exports bulkAddMemories", () => {
    const modPath = path.join(ROOT, "lib/memory/bulk.ts");
    expect(fs.existsSync(modPath)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modPath);
    expect(typeof mod.bulkAddMemories).toBe("function");
  });

  test("BULK_BASE_02: app/api/v1/memories/bulk/route.ts exists", () => {
    const exists = fs.existsSync(
      path.join(ROOT, "app/api/v1/memories/bulk/route.ts")
    );
    expect(exists).toBe(true);
  });

  test("BULK_BASE_03: lib/mem0/semaphore.ts exists and exports Semaphore class", () => {
    const modPath = path.join(ROOT, "lib/mem0/semaphore.ts");
    expect(fs.existsSync(modPath)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modPath);
    expect(typeof mod.Semaphore).toBe("function");
  });
});
