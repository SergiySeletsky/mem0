/**
 * lib/clusters/summarize.ts â€” Spec 07
 *
 * Given an array of memory content strings from the same cluster,
 * generates a short name and one-sentence summary via LLM.
 * Pure LLM logic â€” no storage dependencies.
 */
import { getLLMClient, resetLLMClient } from "@/lib/ai/client";

/** @internal Test helper â€” reset singleton so mocks take effect. */
export function _resetOpenAIClient(): void {
  resetLLMClient();
}

export interface ClusterSummary {
  name: string;
  summary: string;
  /**
   * Estimated topic centrality/importance on a 1–10 scale (LLM-provided, default 5).
   * 10 = highly central; 1 = niche/peripheral.
   */
  rank: number;
  /**
   * Key insight bullets (2–5) about what makes this community distinct.
   * Open ontology: callers can append custom fields before persisting.
   */
  findings: string[];
}

export async function summarizeCluster(
  memories: string[]
): Promise<ClusterSummary> {
  const model =
    process.env.LLM_AZURE_DEPLOYMENT ?? process.env.MEMFORGE_CATEGORIZATION_MODEL ?? "gpt-4o-mini";

  // Sample up to 20 memories to stay within token limits
  const sample = memories
    .slice(0, 20)
    .map((m, i) => `${i + 1}. ${m}`)
    .join("\n");

  try {
    const resp = await getLLMClient().chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a memory categorization assistant. Given a list of related memories, " +
            "produce a short name (3-5 words), a one-sentence summary, a centrality rank, " +
            "and 2-5 key insight bullets about what makes this community distinct.",
        },
        {
          role: "user",
          content:
            `Memories:\n${sample}\n\n` +
            `Respond with JSON:\n` +
            `{"name": "...", "summary": "...", "rank": 7, "findings": ["insight 1", "insight 2"]}\n\n` +
            `rank: integer 1-10 (10 = most central/broadly connected topic)\n` +
            `findings: array of 2-5 concise insight bullets`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const content = resp.choices[0]?.message?.content ?? "{}";
    let parsed: { name?: string; summary?: string; rank?: unknown; findings?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    const rank = typeof parsed.rank === "number"
      ? Math.max(1, Math.min(10, Math.round(parsed.rank)))
      : 5;
    const findings = Array.isArray(parsed.findings)
      ? (parsed.findings as unknown[]).filter((f): f is string => typeof f === "string").slice(0, 5)
      : [];

    return {
      name: parsed.name ?? "Memory Community",
      summary: parsed.summary ?? "A collection of related memories.",
      rank,
      findings,
    };
  } catch {
    return {
      name: "Memory Community",
      summary: "A collection of related memories.",
      rank: 5,
      findings: [],
    };
  }
}
