import { describe, it, expect } from "vitest";
import { buildChatTranscript } from "./transcriptUtils";
import type { ChatMessage } from "./types";

function msg(role: "user" | "agent", content: string): ChatMessage {
  return { id: `${role}-${content}`, role, content };
}

describe("buildChatTranscript (issue #298)", () => {
  it("returns an empty string for no messages", () => {
    expect(buildChatTranscript([], "text")).toBe("");
    expect(buildChatTranscript([], "markdown")).toBe("");
  });

  it("formats plain text with You / Hermes speakers", () => {
    const out = buildChatTranscript(
      [msg("user", "hi"), msg("agent", "hello there")],
      "text",
    );
    expect(out).toBe("You: hi\n\nHermes: hello there");
  });

  it("formats markdown with bold speaker headers", () => {
    const out = buildChatTranscript(
      [msg("user", "hi"), msg("agent", "hello there")],
      "markdown",
    );
    expect(out).toBe("**You:**\n\nhi\n\n**Hermes:**\n\nhello there");
  });

  it("trims surrounding whitespace from message content", () => {
    expect(buildChatTranscript([msg("user", "  spaced  ")], "text")).toBe(
      "You: spaced",
    );
  });

  it("maps the agent role to Hermes and user to You", () => {
    expect(buildChatTranscript([msg("agent", "x")], "text")).toBe("Hermes: x");
    expect(buildChatTranscript([msg("user", "x")], "text")).toBe("You: x");
  });

  it("filters out history-only sub-rows (reasoning, tool_call, tool_result)", () => {
    // PR #327 widened ChatMessage to a union — only ChatBubbleMessage has
    // the `.content` shape transcripts care about. The other variants must
    // not appear in the user-visible copy/paste output, or they'd render
    // as `Hermes: undefined` (TS error before this fix; nonsense after).
    const mixed: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "r1",
        kind: "reasoning",
        role: "agent",
        text: "internal monologue, not for transcript",
      },
      {
        id: "tc1",
        kind: "tool_call",
        role: "agent",
        callId: "c1",
        name: "search",
        args: "{}",
      },
      {
        id: "tr1",
        kind: "tool_result",
        role: "agent",
        callId: "c1",
        name: "search",
        content: "raw search blob",
      },
      { id: "a1", role: "agent", content: "hello there" },
    ];
    expect(buildChatTranscript(mixed, "text")).toBe(
      "You: hi\n\nHermes: hello there",
    );
  });
});
