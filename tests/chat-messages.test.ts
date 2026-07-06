import { describe, expect, it } from "vitest";
import {
  displayTextForTranscript,
  markActiveTurnFailed,
  shouldCopyToTranscript,
  shouldSendToAgent,
} from "../src/renderer/src/screens/Chat/chatMessages";
import type {
  ActiveTurn,
  ChatMessage,
} from "../src/renderer/src/screens/Chat/types";

describe("chat message helpers", () => {
  it("excludes local assistant errors from future agent history", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "hello" },
      {
        id: "error-1",
        role: "agent",
        content: "",
        error: "OpenRouter 403",
        localOnly: true,
      },
      { id: "a-2", role: "agent", content: "real response" },
      {
        id: "r-1",
        kind: "reasoning",
        role: "agent",
        text: "think",
      },
    ];

    expect(messages.filter(shouldSendToAgent).map((m) => m.id)).toEqual([
      "u-1",
      "a-2",
    ]);
  });

  it("keeps local assistant errors available for copied transcripts", () => {
    const error: ChatMessage = {
      id: "error-1",
      role: "agent",
      content: "",
      error: "OpenRouter 403",
      localOnly: true,
    };

    expect(shouldCopyToTranscript(error)).toBe(true);
    expect(displayTextForTranscript(error)).toBe("Error: OpenRouter 403");
    expect(shouldSendToAgent(error)).toBe(false);
  });

  it("anchors a new local error after the active user turn", () => {
    const activeTurn: ActiveTurn = {
      turnId: "turn-1",
      userId: "u-1",
      startIndex: 0,
      status: "running",
    };
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "bad", turnId: "turn-1" },
      { id: "u-2", role: "user", content: "later", turnId: "turn-2" },
    ];

    const next = markActiveTurnFailed(messages, "OpenRouter 403", activeTurn);

    expect(next.map((m) => m.id)).toEqual(["u-1", expect.any(String), "u-2"]);
    expect(next[1]).toMatchObject({
      role: "agent",
      content: "",
      error: "OpenRouter 403",
      localOnly: true,
      pending: false,
      turnId: "turn-1",
    });
  });

  it("marks an active partial assistant message as failed without moving it", () => {
    const activeTurn: ActiveTurn = {
      turnId: "turn-1",
      userId: "u-1",
      startIndex: 0,
      status: "running",
    };
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "bad", turnId: "turn-1" },
      {
        id: "a-1",
        role: "agent",
        content: "partial",
        pending: true,
        turnId: "turn-1",
      },
    ];

    const next = markActiveTurnFailed(messages, "stream closed", activeTurn);

    expect(next.map((m) => m.id)).toEqual(["u-1", "a-1"]);
    expect(next[1]).toMatchObject({
      content: "partial",
      error: "stream closed",
      localOnly: true,
      pending: false,
    });
  });

  it("turns dashboard final error text into an error-only bubble", () => {
    const activeTurn: ActiveTurn = {
      turnId: "turn-1",
      userId: "u-1",
      startIndex: 0,
      status: "running",
    };
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "bad", turnId: "turn-1" },
      {
        id: "a-1",
        role: "agent",
        content: "Error: Error code: 401",
        pending: false,
        turnId: "turn-1",
      },
    ];

    const next = markActiveTurnFailed(messages, "Error code: 401", activeTurn);

    expect(next[1]).toMatchObject({
      content: "",
      error: "Error code: 401",
      localOnly: true,
    });
  });
});
