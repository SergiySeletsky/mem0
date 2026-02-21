/**
 * lib/entities/prompts.ts — Entity extraction prompt template (Spec 04)
 */
export const ENTITY_EXTRACTION_PROMPT = `You are an entity extraction assistant.
Extract named entities from the given memory statement.

For each entity, provide:
- name: The canonical name of the entity
- type: One of PERSON, ORGANIZATION, LOCATION, CONCEPT, PRODUCT, OTHER
- description: A brief description based on context (1 sentence max)

Return ONLY valid JSON: {"entities": [{"name": "...", "type": "...", "description": "..."}]}
If no entities found, return {"entities": []}`;
