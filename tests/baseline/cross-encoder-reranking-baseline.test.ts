export {};

/**
 * Baseline tests for Spec 08 — Cross-Encoder Reranking
 *
 * Documents the POST-implementation state (all should pass after implementation):
 *   RERANK_ISSUE_01 — lib/search/rerank.ts now exists
 *   RERANK_ISSUE_02 — lib/search/mmr.ts now exists
 *   RERANK_ISSUE_03 — HybridSearchOptions now has rerank field
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

function fileContains(rel: string, search: string): boolean {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return false;
  return fs.readFileSync(full, "utf8").includes(search);
}

describe("Spec 08 — Cross-Encoder Reranking Baseline", () => {
  test("RERANK_ISSUE_01: lib/search/rerank.ts now exists", () => {
    expect(fs.existsSync(path.join(ROOT, "lib/search/rerank.ts"))).toBe(true);
  });

  test("RERANK_ISSUE_02: lib/search/mmr.ts now exists", () => {
    expect(fs.existsSync(path.join(ROOT, "lib/search/mmr.ts"))).toBe(true);
  });

  test("RERANK_ISSUE_03: HybridSearchOptions in hybrid.ts now has rerank field", () => {
    expect(
      fileContains("lib/search/hybrid.ts", "rerank")
    ).toBe(true);
  });
});
