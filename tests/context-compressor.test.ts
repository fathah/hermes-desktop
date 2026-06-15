import { describe, it, expect } from "vitest";
import {
  ContextCompressor,
  ChatMessage,
} from "../src/main/hermes/context-compressor";

describe("ContextCompressor", () => {
  it("leaves content untouched if below the limit", () => {
    const compressor = new ContextCompressor({
      pruneLimit: 100,
      keepChars: 20,
    });
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "tool", content: "Short tool output" },
    ];

    const result = compressor.compress(messages);
    expect(result).toEqual(messages);
  });

  it("prunes long tool outputs in the middle", () => {
    const compressor = new ContextCompressor({ pruneLimit: 20, keepChars: 5 });
    const messages: ChatMessage[] = [
      { role: "tool", content: "abcdefghijklmnopqrstuvwxyz" },
    ];

    const result = compressor.compress(messages);
    const text = result[0].content as string;
    expect(text).toContain("[Truncated 16 characters");
    expect(text.slice(0, 5)).toBe("abcde");
    expect(text.slice(-5)).toBe("vwxyz");
  });

  it("prunes text block in arrays of content parts", () => {
    const compressor = new ContextCompressor({ pruneLimit: 20, keepChars: 5 });
    const messages: ChatMessage[] = [
      {
        role: "tool",
        content: [
          { type: "text", text: "abcdefghijklmnopqrstuvwxyz" },
          { type: "image_url", image_url: { url: "data:img" } },
        ],
      },
    ];

    const result = compressor.compress(messages);
    const content = result[0].content as Array<{
      text?: string;
      image_url?: { url?: string };
    }>;
    expect(content[0].text).toContain("[Truncated 16 characters");
    expect(content[1].image_url?.url).toBe("data:img");
  });

  it("enforces context budget by compacting older candidate tool responses", () => {
    const compressor = new ContextCompressor({ budgetChars: 100 });
    const messages: ChatMessage[] = [
      { role: "system", content: "system_msg_here" }, // index 0 (system - preserved)
      // Candidates longer than 100 chars
      { role: "tool", content: "a".repeat(150), name: "tool1" }, // candidate - compressed
      { role: "assistant", content: "b".repeat(150) }, // candidate - compressed
      { role: "user", content: "latest_query" }, // tail 3 - preserved
      { role: "assistant", content: "latest_reply" }, // tail 2 - preserved
      { role: "user", content: "final_word" }, // tail 1 - preserved
    ];

    const result = compressor.compress(messages);

    // system msg must be preserved
    expect(result[0].content).toBe("system_msg_here");

    // candidate messages must be compressed
    expect(result[1].content).toContain("output compressed");
    expect(result[2].content).toContain("output compressed");

    // tail messages must be preserved
    expect(result[3].content).toBe("latest_query");
    expect(result[4].content).toBe("latest_reply");
    expect(result[5].content).toBe("final_word");
  });
});
