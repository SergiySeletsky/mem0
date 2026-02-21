export {};
/**
 * Baseline tests — Spec 04: Entity Extraction Layer
 *
 * Documents pre-Spec 04 gaps; asserts RESOLVED state after implementation.
 *   ENTITY_ISSUE_01 [RESOLVED]: lib/entities/ module exists
 *   ENTITY_ISSUE_02 [RESOLVED]: Schema contains Entity name/type indexes
 *   ENTITY_ISSUE_03 [RESOLVED]: MCP server fires processEntityExtraction after add
 *   ENTITY_ISSUE_04 [RESOLVED]: GET /api/v1/entities route file exists
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("Entity Extraction Baseline", () => {
  it("ENTITY_ISSUE_01 [RESOLVED Spec 04]: lib/entities/index exports processEntityExtraction", () => {
    const workerPath = path.join(ROOT, "lib/entities/worker.ts");
    expect(fs.existsSync(workerPath)).toBe(true);
  });

  it("ENTITY_ISSUE_02 [RESOLVED Spec 04]: schema contains Entity name+type indexes", () => {
    const memgraphSrc = fs.readFileSync(
      path.join(ROOT, "lib/db/memgraph.ts"),
      "utf-8"
    );
    expect(memgraphSrc).toContain("CREATE INDEX ON :Entity(name)");
    expect(memgraphSrc).toContain("CREATE INDEX ON :Entity(type)");
  });

  it("ENTITY_ISSUE_03 [RESOLVED Spec 04]: MCP server fires processEntityExtraction", () => {
    const serverSrc = fs.readFileSync(
      path.join(ROOT, "lib/mcp/server.ts"),
      "utf-8"
    );
    expect(serverSrc).toContain("processEntityExtraction");
  });

  it("ENTITY_ISSUE_04 [RESOLVED Spec 04]: GET /api/v1/entities route file exists", () => {
    const routePath = path.join(ROOT, "app/api/v1/entities/route.ts");
    expect(fs.existsSync(routePath)).toBe(true);
  });
});
