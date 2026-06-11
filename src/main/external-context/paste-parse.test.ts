import { describe, expect, it } from "vitest";
import { parsePastedConversation } from "./paste-parse";

describe("parsePastedConversation", () => {
  it("parses whole-line role headers (ChatGPT/Claude copy style)", () => {
    const text = [
      "You",
      "What is the capital of France?",
      "",
      "ChatGPT",
      "The capital of France is Paris.",
    ].join("\n");
    const result = parsePastedConversation(text, { origin: "ChatGPT" });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].text).toContain("capital of France");
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[1].text).toBe("The capital of France is Paris.");
  });

  it("parses 'said:' headers", () => {
    const text = ["You said:", "hi", "ChatGPT said:", "hello there"].join("\n");
    const result = parsePastedConversation(text);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.messages[1].text).toBe("hello there");
  });

  it("parses inline Q:/A: prefixes", () => {
    const text = "Q: what time is it\nA: around noon";
    const result = parsePastedConversation(text);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      role: "user",
      text: "what time is it",
    });
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      text: "around noon",
    });
  });

  it("treats Perplexity 'Answer' as assistant and leading text as the question", () => {
    const text = [
      "How do tides work?",
      "",
      "Answer",
      "Tides are caused by the gravitational pull of the moon.",
    ].join("\n");
    const result = parsePastedConversation(text, { origin: "Perplexity" });
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].text).toContain("tides work");
    expect(result.messages[1].role).toBe("assistant");
    expect(result.conversation?.projectPath).toBe("Perplexity");
  });

  it("falls back to user/assistant alternation when no markers exist", () => {
    const text =
      "first question paragraph\n\nan answer paragraph\n\nfollow-up question";
    const result = parsePastedConversation(text);
    expect(result.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });

  it("never splits a turn inside a code fence", () => {
    const text = [
      "You",
      "run this:",
      "```js",
      "const a = 1;",
      "",
      "const b = 2;",
      "```",
      "ChatGPT",
      "ok",
    ].join("\n");
    const result = parsePastedConversation(text);
    expect(result.messages).toHaveLength(2);
    // The blank line inside the fence must NOT create a new turn or drop content.
    expect(result.messages[0].text).toContain("const a = 1;");
    expect(result.messages[0].text).toContain("const b = 2;");
  });

  it("returns nothing for empty / whitespace input", () => {
    expect(parsePastedConversation("").messages).toHaveLength(0);
    expect(parsePastedConversation("   \n  \n").conversation).toBeNull();
    // @ts-expect-error — defensive: non-string input is tolerated, not thrown.
    expect(parsePastedConversation(null).messages).toHaveLength(0);
  });

  it("derives a title from the first user message", () => {
    const text = "You\nExplain monads simply\nChatGPT\nA monad is…";
    const result = parsePastedConversation(text);
    expect(result.conversation?.title).toBe("Explain monads simply");
  });

  it("uses a STABLE conversationId for identical (origin, text) — idempotent re-paste", () => {
    const text = "You\nhi\nChatGPT\nhello";
    const a = parsePastedConversation(text, {
      origin: "ChatGPT",
      mtimeMs: 1000,
    });
    const b = parsePastedConversation(text, {
      origin: "ChatGPT",
      mtimeMs: 9999,
    });
    expect(a.conversation?.conversationId).toBe(b.conversation?.conversationId);
    // ts follows the injected mtime, but the id does not.
    expect(a.messages[0].ts).toBe(1000);
    expect(b.messages[0].ts).toBe(9999);
  });

  it("gives a DIFFERENT conversationId when the origin differs", () => {
    const text = "You\nhi\nChatGPT\nhello";
    const a = parsePastedConversation(text, { origin: "ChatGPT" });
    const b = parsePastedConversation(text, { origin: "Perplexity" });
    expect(a.conversation?.conversationId).not.toBe(
      b.conversation?.conversationId,
    );
  });

  it("counts empty turns as skipped, not messages", () => {
    const text = "You\n\nChatGPT\nan answer";
    const result = parsePastedConversation(text);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });
});
