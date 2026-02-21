/**
 * lib/dedup/verifyDuplicate.ts — Stage 2 LLM verification
 *
 * Given two memory strings, asks an LLM to classify their relationship:
 *   DUPLICATE   — same fact, possibly different words
 *   SUPERSEDES  — new memory updates or contradicts the existing one
 *   DIFFERENT   — genuinely distinct facts (no dedup action needed)
 */
import { getLLMClient } from "@/lib/ai/client";

export type VerificationResult = "DUPLICATE" | "SUPERSEDES" | "DIFFERENT";

const VERIFY_PROMPT = `You are a memory deduplication assistant.
Given two memory statements from the same user, determine their relationship:

- DUPLICATE: Both statements express the same fact (same meaning, possibly different words).
- SUPERSEDES: Statement B updates or contradicts Statement A (B is newer/more specific).
- DIFFERENT: The statements express genuinely distinct facts.

Respond with exactly one word: DUPLICATE, SUPERSEDES, or DIFFERENT.`;

/**
 * LLM verification of whether two memory strings represent the same fact.
 * Returns DIFFERENT as a safe fallback for unknown LLM output.
 */
export async function verifyDuplicate(
  newMemory: string,
  existingMemory: string
): Promise<VerificationResult> {
  const client = getLLMClient();
  const model = process.env.LLM_AZURE_DEPLOYMENT ?? process.env.OPENMEMORY_CATEGORIZATION_MODEL ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: VERIFY_PROMPT },
      {
        role: "user",
        content: `Statement A (existing): ${existingMemory}\n\nStatement B (new): ${newMemory}`,
      },
    ],
    temperature: 0,
    max_tokens: 10,
  });

  const answer = (response.choices[0]?.message?.content ?? "DIFFERENT")
    .trim()
    .toUpperCase();

  if (answer === "DUPLICATE") return "DUPLICATE";
  if (answer === "SUPERSEDES") return "SUPERSEDES";
  return "DIFFERENT";
}
