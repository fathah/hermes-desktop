import { describe, it, expect } from "vitest";
import { reconcileStreamedWithDb } from "./sessionHistory";
import type { ChatMessage } from "./types";

describe("reconcileStreamedWithDb — multi-bubble turn (dup bug)", () => {
  it("does not produce duplicate text when one streamed bubble concatenates multiple DB assistant rows", () => {
    // Scenario: agent's turn produced 2 assistant text bubbles split by a tool call.
    // Stream concatenated both into a single bubble (because chat-chunk has no
    // boundary marker). At end-of-stream, DB has 2 separate assistant rows + tool
    // rows in between. Reconciliation must NOT leave both the concatenated streamed
    // bubble AND the per-row DB bubbles in the result — that's the visible dup.

    const partA = "First paragraph from before the tool call.";
    const partB = "Second paragraph after the tool result.";

    const streamed: ChatMessage[] = [
      { id: "user-1", role: "user", content: "do the thing" },
      // single concatenated streamed agent bubble
      { id: "agent-1", role: "agent", content: `${partA}\n\n${partB}` },
    ];

    const db: ChatMessage[] = [
      { id: "db-1", role: "user", content: "do the thing" },
      { id: "db-2", role: "agent", content: partA },
      {
        id: "db-tc-3-call_1",
        kind: "tool_call",
        role: "agent",
        callId: "call_1",
        name: "terminal",
        args: "{}",
      },
      {
        id: "db-tr-4",
        kind: "tool_result",
        role: "agent",
        callId: "call_1",
        name: "terminal",
        content: "ok",
      },
      { id: "db-5", role: "agent", content: partB },
    ];

    const result = reconcileStreamedWithDb(streamed, db);

    // Count occurrences of partB text in the merged transcript.
    const partBOccurrences = result.filter(
      (m) =>
        !("kind" in m) &&
        typeof (m as { content?: string }).content === "string" &&
        (m as { content: string }).content.includes(partB),
    ).length;

    expect(partBOccurrences).toBe(1);
  });
});
