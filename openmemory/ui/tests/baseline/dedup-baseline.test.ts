export {};
/**
 * Baseline tests — Spec 03: Deduplication
 *
 * Documents the pre-Spec 03 gaps, now asserts RESOLVED state.
 *   DEDUP_ISSUE_01 [RESOLVED Spec 03]: MCP add_memories now has dedup pre-write hook
 *   DEDUP_ISSUE_02 [RESOLVED Spec 03]: lib/dedup/index.ts now exists
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("Dedup Baseline", () => {
  it("DEDUP_ISSUE_01 [RESOLVED Spec 03]: MCP server now contains checkDeduplication hook", () => {
    const serverSrc = fs.readFileSync(
      path.join(ROOT, "lib/mcp/server.ts"),
      "utf-8"
    );
    // After Spec 03: checkDeduplication is imported and called in add_memories
    expect(serverSrc).toContain("checkDeduplication");
  });

  it("DEDUP_ISSUE_02 [RESOLVED Spec 03]: lib/dedup/index.ts now exists", () => {
    const dedupIndexPath = path.join(ROOT, "lib/dedup/index.ts");
    expect(fs.existsSync(dedupIndexPath)).toBe(true);
  });
});
