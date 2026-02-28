export {};
/**
 * Baseline tests — Spec 05: Ingestion Context Window
 *
 * Documents pre-Spec 05 gaps; asserts RESOLVED state after implementation.
 *   CONTEXT_ISSUE_01 [RESOLVED]: lib/memory/context.ts now exists
 *   CONTEXT_ISSUE_02 [RESOLVED]: addMemory() now uses context-enriched embedding
 *   CONTEXT_ISSUE_03 [RESOLVED]: getContextWindowConfig() exists in config/helpers
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("Ingestion Context Window Baseline", () => {
  it("CONTEXT_ISSUE_01 [RESOLVED Spec 05]: lib/memory/context.ts exists", () => {
    const contextPath = path.join(ROOT, "lib/memory/context.ts");
    expect(fs.existsSync(contextPath)).toBe(true);
  });

  it("CONTEXT_ISSUE_02 [RESOLVED Spec 05]: write.ts imports getRecentMemories", () => {
    const writeSrc = fs.readFileSync(
      path.join(ROOT, "lib/memory/write.ts"),
      "utf-8"
    );
    expect(writeSrc).toContain("getRecentMemories");
    expect(writeSrc).toContain("buildContextPrefix");
  });

  it("CONTEXT_ISSUE_03 [RESOLVED Spec 05]: getContextWindowConfig exists in config/helpers", () => {
    const helpersSrc = fs.readFileSync(
      path.join(ROOT, "lib/config/helpers.ts"),
      "utf-8"
    );
    expect(helpersSrc).toContain("getContextWindowConfig");
  });
});
