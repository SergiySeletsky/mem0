export {};

/**
 * Baseline tests for Spec 09 — Namespace Isolation Hardening
 *
 * Documents the POST-implementation state:
 *   NS_ISSUE_01 — middleware/userValidation.ts now exists
 *   NS_ISSUE_02 — [memoryId]/route.ts GET no longer has unanchored MATCH (fixed)
 *   NS_ISSUE_03 — [memoryId]/related/route.ts no longer has unanchored MATCH (fixed)
 *   NS_ISSUE_04 — tests/security/isolation.test.ts now exists
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

function fileContains(rel: string, search: string): boolean {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return false;
  return fs.readFileSync(full, "utf8").includes(search);
}

describe("Spec 09 — Namespace Isolation Hardening Baseline", () => {
  test("NS_ISSUE_01: middleware/userValidation.ts now exists", () => {
    expect(
      fs.existsSync(path.join(ROOT, "middleware/userValidation.ts"))
    ).toBe(true);
  });

  test("NS_ISSUE_02: [memoryId]/route.ts GET no longer has unanchored MATCH (m:Memory {id: $id})", () => {
    // The GET handler must now use anchored traversal via User node
    expect(
      fileContains("app/api/v1/memories/[memoryId]/route.ts", "MATCH (m:Memory {id: $id})")
    ).toBe(false);
  });

  test("NS_ISSUE_03: [memoryId]/related/route.ts no longer has unanchored MATCH (m:Memory {id: $id})", () => {
    expect(
      fileContains(
        "app/api/v1/memories/[memoryId]/related/route.ts",
        "MATCH (m:Memory {id: $id})"
      )
    ).toBe(false);
  });

  test("NS_ISSUE_04: tests/security/isolation.test.ts now exists", () => {
    expect(
      fs.existsSync(path.join(ROOT, "tests/security/isolation.test.ts"))
    ).toBe(true);
  });
});
