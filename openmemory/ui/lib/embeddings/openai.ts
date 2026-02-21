/**
 * Embedding generation — Spec 00
 *
 * Supports both standard OpenAI and Azure OpenAI embeddings.
 * Uses Azure when EMBEDDING_AZURE_OPENAI_API_KEY / EMBEDDING_AZURE_ENDPOINT are set,
 * otherwise falls back to OPENAI_API_KEY.
 *
 * Model: text-embedding-3-small (1536 dims, configurable via env)
 */
import OpenAI, { AzureOpenAI } from "openai";

let _client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_client) {
    const azureKey = process.env.EMBEDDING_AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.EMBEDDING_AZURE_ENDPOINT;
    if (azureKey && azureEndpoint) {
      _client = new AzureOpenAI({
        apiKey: azureKey,
        endpoint: azureEndpoint,
        deployment: process.env.EMBEDDING_AZURE_DEPLOYMENT ?? "text-embedding-3-small",
        apiVersion: process.env.EMBEDDING_AZURE_API_VERSION ?? "2024-02-01",
      });
    } else {
      _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }
  return _client;
}

export const EMBED_MODEL =
  process.env.EMBEDDING_AZURE_DEPLOYMENT ??
  process.env.OPENAI_EMBED_MODEL ??
  "text-embedding-3-small";
export const EMBED_DIM = parseInt(process.env.EMBEDDING_DIMS ?? "1536", 10);

/**
 * Generate an embedding vector for a single text string.
 * Returns a number[] of length EMBED_DIM.
 */
export async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * Returns arrays in the same order as the input.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await getOpenAI().embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
