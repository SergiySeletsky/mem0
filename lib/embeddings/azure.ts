/**
 * lib/embeddings/azure.ts — Azure AI Foundry embedding provider
 *
 * Uses EMBEDDING_AZURE_OPENAI_API_KEY + EMBEDDING_AZURE_ENDPOINT.
 * Model: text-embedding-3-small (1536 dims) unless overridden via env.
 */
import { AzureOpenAI } from "openai";

let _client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI {
  if (!_client) {
    const key = process.env.EMBEDDING_AZURE_OPENAI_API_KEY;
    const endpoint = process.env.EMBEDDING_AZURE_ENDPOINT;
    if (!key || !endpoint) {
      throw new Error(
        "Azure embedding credentials are required: set EMBEDDING_AZURE_OPENAI_API_KEY and EMBEDDING_AZURE_ENDPOINT"
      );
    }
    _client = new AzureOpenAI({
      apiKey: key,
      endpoint,
      deployment: process.env.EMBEDDING_AZURE_DEPLOYMENT ?? "text-embedding-3-large",
      apiVersion: process.env.EMBEDDING_AZURE_API_VERSION ?? "2024-02-01",
    });
  }
  return _client;
}

export const EMBED_MODEL =
  process.env.EMBEDDING_AZURE_DEPLOYMENT ?? "text-embedding-3-large";

export const EMBED_DIM = parseInt(process.env.EMBEDDING_DIMS ?? "1024", 10);

export async function embed(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await getClient().embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Validate the Azure endpoint is reachable — used by health check */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await embed("health:ping");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}
