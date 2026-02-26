import { Message } from "../types";

/** OpenAI-compatible tool definition passed to LLM providers */
export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string;
  role: string;
  toolCalls?: Array<{
    name: string;
    arguments: string;
  }>;
}

export interface LLM {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
    response_format?: { type: string },
    tools?: LLMTool[],
  ): Promise<string | LLMResponse>;
  generateChat(messages: Message[]): Promise<LLMResponse>;
}
