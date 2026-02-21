/**
 * Shared OpenAI / AzureOpenAI client factory.
 *
 * Returns an AzureOpenAI instance when LLM_AZURE_OPENAI_API_KEY + LLM_AZURE_ENDPOINT
 * are set, otherwise a standard OpenAI instance using OPENAI_API_KEY.
 *
 * All server-side code that needs an LLM client should import from here so that
 * Azure credentials are used consistently everywhere.
 */
import OpenAI, { AzureOpenAI } from "openai";

let _llmClient: OpenAI | null = null;

export function getLLMClient(): OpenAI {
  if (!_llmClient) {
    const azureKey = process.env.LLM_AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.LLM_AZURE_ENDPOINT;
    if (azureKey && azureEndpoint) {
      _llmClient = new AzureOpenAI({
        apiKey: azureKey,
        endpoint: azureEndpoint,
        deployment: process.env.LLM_AZURE_DEPLOYMENT ?? "gpt-4o-mini",
        apiVersion: process.env.LLM_AZURE_API_VERSION ?? "2025-01-01-preview",
      }) as unknown as OpenAI;
    } else {
      _llmClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }
  return _llmClient;
}

/** Reset cached client — used in tests or config reloads. */
export function resetLLMClient(): void {
  _llmClient = null;
}
