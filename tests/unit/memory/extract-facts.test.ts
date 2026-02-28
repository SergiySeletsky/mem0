export {};
/**
 * Unit tests — extractFactsFromConversation (lib/memory/extract-facts.ts)
 *
 * FACTS_01: User-mode extraction returns user facts
 * FACTS_02: Agent-mode extraction returns assistant facts
 * FACTS_03: Empty conversation → empty facts
 * FACTS_04: LLM error → returns [] without throwing (fail-open)
 * FACTS_05: Invalid JSON from LLM → returns [] without throwing
 * FACTS_06: Code blocks in LLM output are stripped
 * FACTS_07: formatConversation filters system messages
 * FACTS_08: removeCodeBlocks strips fenced blocks
 * FACTS_09: Blank facts are filtered out
 */
import {
  extractFactsFromConversation,
  formatConversation,
  removeCodeBlocks,
  getFactRetrievalMessages,
  type ConversationMessage,
} from "@/lib/memory/extract-facts";

jest.mock("@/lib/ai/client", () => ({ getLLMClient: jest.fn() }));
import { getLLMClient } from "@/lib/ai/client";
const mockGetLLMClient = getLLMClient as jest.MockedFunction<typeof getLLMClient>;

const mockCreate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockGetLLMClient.mockReturnValue({
    chat: { completions: { create: mockCreate } },
  } as any);
});

const sampleMessages: ConversationMessage[] = [
  { role: "user", content: "Hi, my name is John. I am a software engineer." },
  {
    role: "assistant",
    content: "Nice to meet you, John! My name is Alex. How can I help?",
  },
];

describe("extractFactsFromConversation", () => {
  it("FACTS_01: user-mode extracts facts from user messages", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facts: ["Name is John", "Is a software engineer"],
            }),
          },
        },
      ],
    });

    const result = await extractFactsFromConversation(sampleMessages, false);

    expect(result).toEqual(["Name is John", "Is a software engineer"]);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Verify system prompt mentions "user"
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain(
      "GENERATE FACTS SOLELY BASED ON THE USER'S MESSAGES",
    );
  });

  it("FACTS_02: agent-mode extracts facts from assistant messages", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facts: ["Name is Alex"],
            }),
          },
        },
      ],
    });

    const result = await extractFactsFromConversation(sampleMessages, true);

    expect(result).toEqual(["Name is Alex"]);

    // Verify system prompt mentions "assistant"
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain(
      "GENERATE FACTS SOLELY BASED ON THE ASSISTANT'S MESSAGES",
    );
  });

  it("FACTS_03: empty conversation → empty facts", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const result = await extractFactsFromConversation([]);
    expect(result).toEqual([]);
  });

  it("FACTS_04: LLM error → returns [] (fail-open)", async () => {
    mockCreate.mockRejectedValue(new Error("API timeout"));

    const result = await extractFactsFromConversation(sampleMessages);
    expect(result).toEqual([]);
  });

  it("FACTS_05: invalid JSON from LLM → returns [] (fail-open)", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not valid json at all" } }],
    });

    const result = await extractFactsFromConversation(sampleMessages);
    expect(result).toEqual([]);
  });

  it("FACTS_06: code blocks in LLM output are stripped before parsing", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '```json\n{"facts": ["Likes pizza"]}\n```',
          },
        },
      ],
    });

    const result = await extractFactsFromConversation(sampleMessages);
    expect(result).toEqual(["Likes pizza"]);
  });

  it("FACTS_09: blank facts are filtered out", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ facts: ["Real fact", "", "  ", "Another fact"] }),
          },
        },
      ],
    });

    const result = await extractFactsFromConversation(sampleMessages);
    expect(result).toEqual(["Real fact", "Another fact"]);
  });
});

describe("formatConversation", () => {
  it("FACTS_07: filters system messages and formats user/assistant", () => {
    const messages: ConversationMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const formatted = formatConversation(messages);
    expect(formatted).toBe("User: Hello\nAssistant: Hi there");
    expect(formatted).not.toContain("system");
  });
});

describe("removeCodeBlocks", () => {
  it("FACTS_08: strips fenced code block markers, keeping content", () => {
    expect(removeCodeBlocks('```json\n{"a":1}\n```')).toBe('{"a":1}');
    // Inline code blocks (no newlines) — markers removed, content preserved
    expect(removeCodeBlocks("prefix ```code``` suffix")).toContain("suffix");
  });

  it("passes through text without code blocks", () => {
    expect(removeCodeBlocks('{"facts":[]}')).toBe('{"facts":[]}');
  });
});

describe("getFactRetrievalMessages", () => {
  it("returns [system, user] tuple in user mode", () => {
    const [sys, usr] = getFactRetrievalMessages("User: Hi", false);
    expect(sys).toContain("Personal Information Organizer");
    expect(usr).toContain("User: Hi");
  });

  it("returns [system, user] tuple in agent mode", () => {
    const [sys, usr] = getFactRetrievalMessages("Assistant: Hello", true);
    expect(sys).toContain("Assistant Information Organizer");
    expect(usr).toContain("Assistant: Hello");
  });
});
