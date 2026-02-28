export {};
/**
 * Unit tests — graph lifecycle prompts (lib/graph/prompts.ts)
 *
 * GPROMPT_01: EXTRACT_RELATIONS_PROMPT contains key guidance
 * GPROMPT_02: UPDATE_GRAPH_PROMPT contains placeholder tokens
 * GPROMPT_03: DELETE_RELATIONS_SYSTEM_PROMPT contains deletion criteria
 * GPROMPT_04: getDeleteMessages() substitutes userId
 * GPROMPT_05: formatEntities() renders triples correctly
 * GPROMPT_06: formatEntities() handles empty array
 */
import {
  EXTRACT_RELATIONS_PROMPT,
  UPDATE_GRAPH_PROMPT,
  DELETE_RELATIONS_SYSTEM_PROMPT,
  getDeleteMessages,
  formatEntities,
} from "@/lib/graph/prompts";

describe("Graph prompts — content", () => {
  it("GPROMPT_01: EXTRACT_RELATIONS_PROMPT contains key guidance", () => {
    expect(EXTRACT_RELATIONS_PROMPT).toContain("knowledge graph");
    expect(EXTRACT_RELATIONS_PROMPT).toContain("USER_ID");
    expect(EXTRACT_RELATIONS_PROMPT).toContain("Entity Consistency");
  });

  it("GPROMPT_02: UPDATE_GRAPH_PROMPT contains template placeholders", () => {
    expect(UPDATE_GRAPH_PROMPT).toContain("{existing_memories}");
    expect(UPDATE_GRAPH_PROMPT).toContain("{new_memories}");
    expect(UPDATE_GRAPH_PROMPT).toContain("Conflict Resolution");
  });

  it("GPROMPT_03: DELETE_RELATIONS_SYSTEM_PROMPT contains deletion criteria", () => {
    expect(DELETE_RELATIONS_SYSTEM_PROMPT).toContain("Deletion Criteria");
    expect(DELETE_RELATIONS_SYSTEM_PROMPT).toContain("Contradictory");
    expect(DELETE_RELATIONS_SYSTEM_PROMPT).toContain("DO NOT DELETE");
  });
});

describe("getDeleteMessages", () => {
  it("GPROMPT_04: substitutes userId and returns [system, user] tuple", () => {
    const [sys, usr] = getDeleteMessages(
      "alice -- knows -- bob",
      "Alice now works at Google",
      "user_123",
    );

    // System prompt should have userId substituted for USER_ID
    expect(sys).toContain("user_123");
    expect(sys).not.toContain("USER_ID");

    // User prompt should contain both existing and new info
    expect(usr).toContain("alice -- knows -- bob");
    expect(usr).toContain("Alice now works at Google");
  });
});

describe("formatEntities", () => {
  it("GPROMPT_05: renders triples in 'source -- relationship -- destination' format", () => {
    const entities = [
      { source: "Alice", relationship: "knows", destination: "Bob" },
      { source: "Bob", relationship: "works_at", destination: "Acme" },
    ];

    const result = formatEntities(entities);
    expect(result).toBe("Alice -- knows -- Bob\nBob -- works_at -- Acme");
  });

  it("GPROMPT_06: handles empty array", () => {
    expect(formatEntities([])).toBe("");
  });
});
