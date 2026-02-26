/**
 * P6 — mem0-ts LLM provider unit tests
 *
 * Covers: AnthropicLLM, MistralLLM, AzureOpenAILLM, GoogleLLM, GroqLLM, OllamaLLM
 *
 * Each SDK is mocked so no real API calls are made.
 */

// ===========================================================================
// Anthropic mock
// ===========================================================================
const mockAnthropicCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: (...a: unknown[]) => mockAnthropicCreate(...a) },
    })),
  };
});

// ===========================================================================
// Mistral mock
// ===========================================================================
const mockMistralComplete = jest.fn();
jest.mock("@mistralai/mistralai", () => ({
  Mistral: jest.fn().mockImplementation(() => ({
    chat: { complete: (...a: unknown[]) => mockMistralComplete(...a) },
  })),
}));

// ===========================================================================
// Azure OpenAI mock — uses `openai` package with AzureOpenAI class
// ===========================================================================
const mockAzureCreate = jest.fn();
jest.mock("openai", () => ({
  AzureOpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...a: unknown[]) => mockAzureCreate(...a) } },
  })),
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}));

// ===========================================================================
// Google GenAI mock
// ===========================================================================
const mockGoogleGenerate = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: (...a: unknown[]) => mockGoogleGenerate(...a) },
  })),
}));

// ===========================================================================
// Groq mock
// ===========================================================================
const mockGroqCreate = jest.fn();
jest.mock("groq-sdk", () => ({
  Groq: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...a: unknown[]) => mockGroqCreate(...a) } },
  })),
}));

// ===========================================================================
// Ollama mock
// ===========================================================================
const mockOllamaChat = jest.fn();
const mockOllamaList = jest.fn();
const mockOllamaPull = jest.fn();
jest.mock("ollama", () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    chat: (...a: unknown[]) => mockOllamaChat(...a),
    list: () => mockOllamaList(),
    pull: (...a: unknown[]) => mockOllamaPull(...a),
  })),
}));

// ===========================================================================
// Imports — after all mocks
// ===========================================================================
import { AnthropicLLM } from "../src/llms/anthropic";
import { MistralLLM } from "../src/llms/mistral";
import { AzureOpenAILLM } from "../src/llms/azure";
import { GoogleLLM } from "../src/llms/google";
import { GroqLLM } from "../src/llms/groq";
import { OllamaLLM } from "../src/llms/ollama";
import type { Message } from "../src/types";

beforeEach(() => {
  jest.clearAllMocks();
  // Ollama list returns empty (model already absent) by default;
  // ensureModelExists is called in the constructor, so we set it up early
  mockOllamaList.mockResolvedValue({ models: [{ name: "llama3.1:8b" }] });
  mockOllamaPull.mockResolvedValue(undefined);
});

const simpleMessages: Message[] = [
  { role: "system", content: "you are helpful" },
  { role: "user", content: "say hello" },
];

// ===========================================================================
// AnthropicLLM
// ===========================================================================
describe("AnthropicLLM", () => {
  test("ANT_01: constructor throws without API key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicLLM({ model: "claude-3-sonnet-20240229" })).toThrow(
      "Anthropic API key is required"
    );
  });

  test("ANT_02: generateResponse returns text block content", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello!" }],
    });
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("Hello!");
  });

  test("ANT_03: generateResponse throws on non-text block", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "image", data: "..." }],
    });
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    await expect(llm.generateResponse(simpleMessages)).rejects.toThrow(
      "Unexpected response type"
    );
  });

  test("ANT_04: extracts system message and sends separately", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    await llm.generateResponse(simpleMessages);
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "you are helpful",
      })
    );
    // user messages should NOT include the system message
    const callArg = mockAnthropicCreate.mock.calls[0][0];
    const roles = callArg.messages.map((m: any) => m.role);
    expect(roles).not.toContain("system");
  });

  test("ANT_05: generateChat returns LLMResponse", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "chat response" }],
    });
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({
      content: "chat response",
      role: "assistant",
    });
  });
});

// ===========================================================================
// MistralLLM
// ===========================================================================
describe("MistralLLM", () => {
  test("MIS_01: constructor throws without API key", () => {
    expect(() => new MistralLLM({ model: "mistral-tiny-latest" })).toThrow(
      "Mistral API key is required"
    );
  });

  test("MIS_02: generateResponse returns string content", async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [{ message: { content: "Bonjour!", role: "assistant" } }],
    });
    const llm = new MistralLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("Bonjour!");
  });

  test("MIS_03: generateResponse returns empty string for null response", async () => {
    mockMistralComplete.mockResolvedValue(null);
    const llm = new MistralLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("");
  });

  test("MIS_04: generateResponse returns empty when choices is empty", async () => {
    mockMistralComplete.mockResolvedValue({ choices: [] });
    const llm = new MistralLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("");
  });

  test("MIS_05: generateResponse returns LLMResponse with tool calls", async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [{
        message: {
          content: "",
          role: "assistant",
          toolCalls: [{
            function: { name: "add_memory", arguments: '{"text":"hi"}' },
          }],
        },
      }],
    });
    const llm = new MistralLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse(simpleMessages, undefined, [{}]);
    expect(typeof result).toBe("object");
    expect((result as any).toolCalls[0].name).toBe("add_memory");
  });

  test("MIS_06: generateChat returns LLMResponse", async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [{ message: { content: "hello", role: "assistant" } }],
    });
    const llm = new MistralLLM({ apiKey: "test-key" });
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({ content: "hello", role: "assistant" });
  });

  test("MIS_07: generateChat returns empty for null response", async () => {
    mockMistralComplete.mockResolvedValue(null);
    const llm = new MistralLLM({ apiKey: "test-key" });
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({ content: "", role: "assistant" });
  });
});

// ===========================================================================
// AzureOpenAILLM
// ===========================================================================
describe("AzureOpenAILLM", () => {
  const azureConfig = {
    apiKey: "azure-key",
    model: "gpt-4",
    modelProperties: { endpoint: "https://test.openai.azure.com" },
  };

  test("AZ_01: constructor throws without apiKey or endpoint", () => {
    expect(() => new AzureOpenAILLM({ model: "gpt-4" })).toThrow(
      "Azure OpenAI requires both API key and endpoint"
    );
    expect(() =>
      new AzureOpenAILLM({ apiKey: "k", model: "gpt-4" })
    ).toThrow("Azure OpenAI requires both API key and endpoint");
  });

  test("AZ_02: generateResponse returns text content", async () => {
    mockAzureCreate.mockResolvedValue({
      choices: [{ message: { content: "azure response", role: "assistant" } }],
    });
    const llm = new AzureOpenAILLM(azureConfig);
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("azure response");
  });

  test("AZ_03: generateResponse with tools returns LLMResponse", async () => {
    mockAzureCreate.mockResolvedValue({
      choices: [{
        message: {
          content: "",
          role: "assistant",
          tool_calls: [{
            function: { name: "search", arguments: '{"q":"hello"}' },
          }],
        },
      }],
    });
    const llm = new AzureOpenAILLM(azureConfig);
    const result = await llm.generateResponse(simpleMessages, undefined, [{}]);
    expect(typeof result).toBe("object");
    expect((result as any).toolCalls[0].name).toBe("search");
  });

  test("AZ_04: skips response_format when tools provided", async () => {
    mockAzureCreate.mockResolvedValue({
      choices: [{ message: { content: "ok", role: "assistant" } }],
    });
    const llm = new AzureOpenAILLM(azureConfig);
    await llm.generateResponse(
      simpleMessages,
      { type: "json_object" },
      [{}]
    );
    const callArg = mockAzureCreate.mock.calls[0][0];
    expect(callArg.response_format).toBeUndefined();
    expect(callArg.tools).toBeDefined();
  });

  test("AZ_05: generateChat returns LLMResponse", async () => {
    mockAzureCreate.mockResolvedValue({
      choices: [{ message: { content: "hi", role: "assistant" } }],
    });
    const llm = new AzureOpenAILLM(azureConfig);
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({ content: "hi", role: "assistant" });
  });
});

// ===========================================================================
// GoogleLLM
// ===========================================================================
describe("GoogleLLM", () => {
  test("GOO_01: generateResponse returns plain text", async () => {
    mockGoogleGenerate.mockResolvedValue({ text: "Google says hello" });
    const llm = new GoogleLLM({ apiKey: "google-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("Google says hello");
  });

  test("GOO_02: strips markdown code fences from response", async () => {
    mockGoogleGenerate.mockResolvedValue({ text: '```json\n{"a":1}\n```' });
    const llm = new GoogleLLM({ apiKey: "google-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe('{"a":1}');
  });

  test("GOO_03: maps system role to model", async () => {
    mockGoogleGenerate.mockResolvedValue({ text: "ok" });
    const llm = new GoogleLLM({ apiKey: "google-key" });
    await llm.generateResponse(simpleMessages);
    const callArg = mockGoogleGenerate.mock.calls[0][0];
    const roles = callArg.contents.map((c: any) => c.role);
    expect(roles[0]).toBe("model"); // system → model
    expect(roles[1]).toBe("user");
  });

  test("GOO_04: returns empty string for null text", async () => {
    mockGoogleGenerate.mockResolvedValue({ text: null });
    const llm = new GoogleLLM({ apiKey: "google-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("");
  });

  test("GOO_05: generateChat returns LLMResponse", async () => {
    mockGoogleGenerate.mockResolvedValue({
      candidates: [{
        content: { parts: [{ text: "chat" }], role: "model" },
      }],
    });
    const llm = new GoogleLLM({ apiKey: "google-key" });
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({ content: "chat", role: "model" });
  });
});

// ===========================================================================
// GroqLLM
// ===========================================================================
describe("GroqLLM", () => {
  test("GRQ_01: constructor throws without API key", () => {
    delete process.env.GROQ_API_KEY;
    expect(() => new GroqLLM({ model: "llama3-70b-8192" })).toThrow(
      "Groq API key is required"
    );
  });

  test("GRQ_02: generateResponse returns content string", async () => {
    mockGroqCreate.mockResolvedValue({
      choices: [{ message: { content: "groq says hi", role: "assistant" } }],
    });
    const llm = new GroqLLM({ apiKey: "groq-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("groq says hi");
  });

  test("GRQ_03: generateResponse returns empty string for null content", async () => {
    mockGroqCreate.mockResolvedValue({
      choices: [{ message: { content: null, role: "assistant" } }],
    });
    const llm = new GroqLLM({ apiKey: "groq-key" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("");
  });

  test("GRQ_04: generateChat returns LLMResponse", async () => {
    mockGroqCreate.mockResolvedValue({
      choices: [{ message: { content: "chat", role: "assistant" } }],
    });
    const llm = new GroqLLM({ apiKey: "groq-key" });
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({ content: "chat", role: "assistant" });
  });
});

// ===========================================================================
// OllamaLLM
// ===========================================================================
describe("OllamaLLM", () => {
  test("OLL_01: constructor does not throw", () => {
    const llm = new OllamaLLM({ model: "llama3.1:8b" });
    expect(llm).toBeDefined();
  });

  test("OLL_02: generateResponse returns text content", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: "ollama response", role: "assistant" },
    });
    const llm = new OllamaLLM({ model: "llama3.1:8b" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("ollama response");
  });

  test("OLL_03: generateResponse with tool calls returns LLMResponse", async () => {
    mockOllamaChat.mockResolvedValue({
      message: {
        content: "",
        role: "assistant",
        tool_calls: [{
          function: { name: "fn", arguments: { key: "val" } },
        }],
      },
    });
    const llm = new OllamaLLM({ model: "llama3.1:8b" });
    const result = await llm.generateResponse(simpleMessages, undefined, [{}]);
    expect(typeof result).toBe("object");
    expect((result as any).toolCalls[0].name).toBe("fn");
    expect((result as any).toolCalls[0].arguments).toBe('{"key":"val"}');
  });

  test("OLL_04: generateChat returns LLMResponse", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: "chat", role: "assistant" },
    });
    const llm = new OllamaLLM({ model: "llama3.1:8b" });
    const result = await llm.generateChat(simpleMessages);
    expect(result).toEqual({ content: "chat", role: "assistant" });
  });

  test("OLL_05: ensureModelExists pulls missing model", async () => {
    mockOllamaList.mockResolvedValue({ models: [] }); // model NOT present
    mockOllamaChat.mockResolvedValue({
      message: { content: "ok", role: "assistant" },
    });
    const llm = new OllamaLLM({ model: "llama3.1:8b" });
    await llm.generateResponse(simpleMessages);
    // Pull should have been called (in constructor + in generateResponse)
    expect(mockOllamaPull).toHaveBeenCalled();
  });

  test("OLL_06: returns empty string for null content", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: null, role: "assistant" },
    });
    const llm = new OllamaLLM({ model: "llama3.1:8b" });
    const result = await llm.generateResponse(simpleMessages);
    expect(result).toBe("");
  });
});
