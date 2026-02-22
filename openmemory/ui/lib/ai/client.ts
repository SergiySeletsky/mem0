/**
 * Shared AzureOpenAI client factory.
 *
 * Requires LLM_AZURE_OPENAI_API_KEY + LLM_AZURE_ENDPOINT to be set.
 * Direct OpenAI API access is not supported — all LLM calls go through Azure AI Foundry.
 *
 * All server-side code that needs an LLM client should import from here.
 */
import OpenAI, { AzureOpenAI } from "openai";

let _llmClient: OpenAI | null = null;

export function getLLMClient(): OpenAI {
  if (!_llmClient) {
    const azureKey = process.env.LLM_AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.LLM_AZURE_ENDPOINT;
    if (!azureKey || !azureEndpoint) {
      throw new Error(
        "Azure LLM credentials are required: set LLM_AZURE_OPENAI_API_KEY and LLM_AZURE_ENDPOINT"
      );
    }
    _llmClient = new AzureOpenAI({
      apiKey: azureKey,
      endpoint: azureEndpoint,
      deployment: process.env.LLM_AZURE_DEPLOYMENT ?? "gpt-4o-mini",
      apiVersion: process.env.LLM_AZURE_API_VERSION ?? "2025-01-01-preview",
    }) as unknown as OpenAI;
  }
  return _llmClient;
}

/** Reset cached client — used in tests or config reloads. */
export function resetLLMClient(): void {
  _llmClient = null;
}
