/**
 * lib/entities/prompts.ts — Entity extraction prompt template (Spec 04)
 *
 * Open ontology: LLM assigns domain-specific types in UPPER_SNAKE_CASE rather
 * than a closed list. Well-known base types (PERSON, ORGANIZATION, LOCATION,
 * PRODUCT) should still be used for conventional entity classes; domain-specific
 * types (SERVICE, DATABASE, LIBRARY, FRAMEWORK, TEAM, INCIDENT, API, etc.) are
 * encouraged when more precise.
 */
export const ENTITY_EXTRACTION_PROMPT = `You are an entity extraction assistant.
Extract named entities from the given memory statement.

For each entity, provide:
- name: The canonical name of the entity (use the most complete, official form)
- type: A short entity type in UPPER_SNAKE_CASE. Use domain-specific types when precise
  (e.g. SERVICE, DATABASE, LIBRARY, FRAMEWORK, PATTERN, TEAM, INCIDENT, METRIC, API,
  INFRASTRUCTURE, SECURITY_POLICY, CONFIGURATION, COMPLIANCE_RULE).
  Fall back to well-known base types for conventional entity classes:
  PERSON, ORGANIZATION, LOCATION, PRODUCT.
  Use CONCEPT only for abstract ideas without a more specific type.
  Use OTHER only when nothing else fits.
- description: A brief description based on context (1 sentence max)

Return ONLY valid JSON: {"entities": [{"name": "...", "type": "...", "description": "..."}]}
If no entities found, return {"entities": []}`;

export interface MergeCandidate {
  name: string;
  type: string;
  description: string;
}

/**
 * Build a prompt asking the LLM whether two entities refer to the same real-world thing.
 * Used during semantic dedup to confirm or reject near-duplicate entities before merging.
 */
export function buildEntityMergePrompt(
  incoming: MergeCandidate,
  existing: MergeCandidate
): string {
  return `You are an entity deduplication assistant. Determine whether two entity records
refer to the SAME real-world person, organization, system, concept, or thing.

Entity A (incoming):
  Name: ${incoming.name}
  Type: ${incoming.type}
  Description: ${incoming.description || "(none)"}

Entity B (existing):
  Name: ${existing.name}
  Type: ${existing.type}
  Description: ${existing.description || "(none)"}

Answer with a single JSON object: {"same": true} if they are the same entity,
or {"same": false} if they are distinct. No explanation.`;
}
