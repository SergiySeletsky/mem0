export {};
/**
 * Unit tests — GraphStore types (lib/graph/types.ts)
 *
 * TYPE_01: GraphNode interface shape compliance
 * TYPE_02: GraphEdge interface shape compliance
 * TYPE_03: Subgraph holds nodes + edges
 * TYPE_04: RelationTriple has source/relationship/target
 * TYPE_05: UpsertRelationshipInput has required fields
 * TYPE_06: TraversalOptions has optional depth/limit/relationshipTypes
 *
 * These are compile-time + runtime shape tests ensuring the types are usable.
 */
import type {
  GraphNode,
  GraphEdge,
  Subgraph,
  RelationTriple,
  UpsertRelationshipInput,
  TraversalOptions,
  GraphStore,
} from "@/lib/graph/types";

describe("Graph types — runtime shape compliance", () => {
  it("TYPE_01: GraphNode interface can be fully populated", () => {
    const node: GraphNode = {
      id: "n1",
      name: "Alice",
      type: "PERSON",
      embedding: [0.1, 0.2],
      properties: { description: "A person" },
      score: 0.95,
    };
    expect(node.id).toBe("n1");
    expect(node.name).toBe("Alice");
    expect(node.type).toBe("PERSON");
    expect(node.score).toBe(0.95);
    expect(node.properties).toEqual({ description: "A person" });
  });

  it("TYPE_02: GraphEdge interface can be fully populated", () => {
    const edge: GraphEdge = {
      id: "e1",
      sourceId: "n1",
      sourceName: "Alice",
      relationship: "KNOWS",
      targetId: "n2",
      targetName: "Bob",
      properties: {},
    };
    expect(edge.relationship).toBe("KNOWS");
    expect(edge.sourceId).toBe("n1");
    expect(edge.targetId).toBe("n2");
  });

  it("TYPE_03: Subgraph holds nodes + edges arrays", () => {
    const sg: Subgraph = { nodes: [], edges: [] };
    expect(sg.nodes).toEqual([]);
    expect(sg.edges).toEqual([]);
  });

  it("TYPE_04: RelationTriple has source/relationship/target", () => {
    const triple: RelationTriple = {
      source: "Alice",
      relationship: "KNOWS",
      target: "Bob",
      score: 0.8,
    };
    expect(triple.source).toBe("Alice");
    expect(triple.relationship).toBe("KNOWS");
    expect(triple.target).toBe("Bob");
  });

  it("TYPE_05: UpsertRelationshipInput has required + optional fields", () => {
    const input: UpsertRelationshipInput = {
      sourceName: "Alice",
      targetName: "Bob",
      relationship: "KNOWS",
      sourceType: "PERSON",
      targetType: "PERSON",
      properties: { since: "2024" },
    };
    expect(input.sourceName).toBe("Alice");
    expect(input.relationship).toBe("KNOWS");
  });

  it("TYPE_06: TraversalOptions all fields are optional", () => {
    const opts: TraversalOptions = {};
    expect(opts.depth).toBeUndefined();
    expect(opts.limit).toBeUndefined();
    expect(opts.relationshipTypes).toBeUndefined();

    const opts2: TraversalOptions = { depth: 2, limit: 50, relationshipTypes: ["KNOWS"] };
    expect(opts2.depth).toBe(2);
    expect(opts2.limit).toBe(50);
  });

  it("TYPE_07: GraphStore interface has all required methods", () => {
    // Type-level check: this compile-time assertion validates the interface shape.
    // A mock object satisfying GraphStore proves the interface is well-formed.
    const mockStore: GraphStore = {
      initialize: async () => {},
      searchNodes: async () => [],
      getNode: async () => null,
      deleteNode: async () => {},
      searchEdges: async () => [],
      upsertRelationship: async () => ({
        id: "", sourceId: "", sourceName: "", relationship: "",
        targetId: "", targetName: "", properties: {},
      }),
      deleteRelationship: async () => {},
      getNeighborhood: async () => ({ nodes: [], edges: [] }),
      getSubgraph: async () => ({ nodes: [], edges: [] }),
      getAll: async () => [],
      deleteAll: async () => {},
    };

    expect(mockStore).toBeDefined();
    expect(typeof mockStore.initialize).toBe("function");
    expect(typeof mockStore.searchNodes).toBe("function");
    expect(typeof mockStore.upsertRelationship).toBe("function");
    expect(typeof mockStore.getAll).toBe("function");
    expect(typeof mockStore.deleteAll).toBe("function");
  });
});
