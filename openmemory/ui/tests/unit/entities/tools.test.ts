export {};
/**
 * Unit tests — entity/relation tool definitions (lib/entities/tools.ts)
 *
 * TOOLS_01: EXTRACT_ENTITIES_TOOL has correct shape
 * TOOLS_02: RELATIONS_TOOL has correct shape
 * TOOLS_03: DELETE_MEMORY_TOOL_GRAPH has correct shape
 * TOOLS_04: NOOP_TOOL has correct shape
 * TOOLS_05: GraphExtractEntitiesArgsSchema validates valid input
 * TOOLS_06: GraphExtractEntitiesArgsSchema rejects invalid input
 * TOOLS_07: GraphRelationsArgsSchema validates valid input
 * TOOLS_08: GraphSimpleRelationshipArgsSchema validates valid input
 * TOOLS_09: GraphAddRelationshipArgsSchema includes source_type/destination_type
 */
import {
  EXTRACT_ENTITIES_TOOL,
  RELATIONS_TOOL,
  DELETE_MEMORY_TOOL_GRAPH,
  NOOP_TOOL,
  GraphExtractEntitiesArgsSchema,
  GraphRelationsArgsSchema,
  GraphSimpleRelationshipArgsSchema,
  GraphAddRelationshipArgsSchema,
} from "@/lib/entities/tools";

describe("Tool definitions — shape", () => {
  it("TOOLS_01: EXTRACT_ENTITIES_TOOL has type=function and correct name", () => {
    expect(EXTRACT_ENTITIES_TOOL.type).toBe("function");
    expect(EXTRACT_ENTITIES_TOOL.function.name).toBe("extract_entities");
    expect(EXTRACT_ENTITIES_TOOL.function.parameters.properties).toHaveProperty("entities");
    expect(EXTRACT_ENTITIES_TOOL.function.parameters.required).toEqual(["entities"]);
  });

  it("TOOLS_02: RELATIONS_TOOL has type=function and correct name", () => {
    expect(RELATIONS_TOOL.type).toBe("function");
    expect(RELATIONS_TOOL.function.name).toBe("establish_relationships");
    expect(RELATIONS_TOOL.function.parameters.properties).toHaveProperty("entities");
    expect(RELATIONS_TOOL.function.parameters.required).toEqual(["entities"]);
  });

  it("TOOLS_03: DELETE_MEMORY_TOOL_GRAPH has source/relationship/destination params", () => {
    expect(DELETE_MEMORY_TOOL_GRAPH.type).toBe("function");
    expect(DELETE_MEMORY_TOOL_GRAPH.function.name).toBe("delete_graph_memory");
    const props = DELETE_MEMORY_TOOL_GRAPH.function.parameters.properties;
    expect(props).toHaveProperty("source");
    expect(props).toHaveProperty("relationship");
    expect(props).toHaveProperty("destination");
    expect(DELETE_MEMORY_TOOL_GRAPH.function.parameters.required).toEqual(
      expect.arrayContaining(["source", "relationship", "destination"]),
    );
  });

  it("TOOLS_04: NOOP_TOOL has no required params", () => {
    expect(NOOP_TOOL.type).toBe("function");
    expect(NOOP_TOOL.function.name).toBe("noop");
    expect(NOOP_TOOL.function.parameters.required).toEqual([]);
  });
});

describe("Zod schemas", () => {
  it("TOOLS_05: GraphExtractEntitiesArgsSchema validates correct input", () => {
    const valid = {
      entities: [
        { entity: "Alice", entity_type: "PERSON" },
        { entity: "Acme", entity_type: "ORGANIZATION" },
      ],
    };
    const result = GraphExtractEntitiesArgsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("TOOLS_06: GraphExtractEntitiesArgsSchema rejects missing fields", () => {
    const invalid = { entities: [{ entity: "Alice" }] }; // missing entity_type
    const result = GraphExtractEntitiesArgsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("TOOLS_07: GraphRelationsArgsSchema validates correct input", () => {
    const valid = {
      entities: [
        { source: "Alice", relationship: "works_at", destination: "Acme" },
      ],
    };
    const result = GraphRelationsArgsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("TOOLS_08: GraphSimpleRelationshipArgsSchema validates source/rel/dest", () => {
    const valid = { source: "A", relationship: "likes", destination: "B" };
    const result = GraphSimpleRelationshipArgsSchema.safeParse(valid);
    expect(result.success).toBe(true);

    const invalid = { source: "A", destination: "B" }; // missing relationship
    const result2 = GraphSimpleRelationshipArgsSchema.safeParse(invalid);
    expect(result2.success).toBe(false);
  });

  it("TOOLS_09: GraphAddRelationshipArgsSchema extends with source_type/dest_type", () => {
    const valid = {
      source: "Alice",
      relationship: "works_at",
      destination: "Acme",
      source_type: "PERSON",
      destination_type: "ORGANIZATION",
    };
    const result = GraphAddRelationshipArgsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
