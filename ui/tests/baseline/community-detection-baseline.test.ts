export {};

/**
 * Baseline tests for Spec 07 — Community Detection / Memory Clustering
 *
 * Documents the POST-implementation state:
 *   COMM_BASE_01 — lib/clusters/build.ts exists and exports rebuildClusters
 *   COMM_BASE_02 — lib/clusters/summarize.ts exists and exports summarizeCluster
 *   COMM_BASE_03 — POST /api/v1/clusters/rebuild route exists
 *   COMM_BASE_04 — memgraph.ts includes Community constraint
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

function fileContains(rel: string, search: string): boolean {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return false;
  return fs.readFileSync(full, "utf8").includes(search);
}

describe("Spec 07 — Community Detection Baseline", () => {
  test("COMM_BASE_01: lib/clusters/build.ts exists and exports rebuildClusters", () => {
    expect(fileContains("lib/clusters/build.ts", "export async function rebuildClusters")).toBe(true);
  });

  test("COMM_BASE_02: lib/clusters/summarize.ts exists and exports summarizeCluster", () => {
    expect(fileContains("lib/clusters/summarize.ts", "export async function summarizeCluster")).toBe(true);
  });

  test("COMM_BASE_03: app/api/v1/clusters/rebuild/route.ts exists with POST handler", () => {
    expect(
      fileContains("app/api/v1/clusters/rebuild/route.ts", "export async function POST")
    ).toBe(true);
  });

  test("COMM_BASE_04: memgraph.ts includes Community uniqueness constraint", () => {
    expect(fileContains("lib/db/memgraph.ts", "Community")).toBe(true);
  });
});
