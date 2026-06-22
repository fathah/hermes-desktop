import { describe, expect, it } from "vitest";
import {
  buildQueueAwareRenderPlan,
  createQueuedMessage,
} from "./queueAnchoring";
import type { ActiveTurn, ChatMessage } from "./types";

const activeTurn: ActiveTurn = {
  turnId: "turn-1",
  userId: "user-1",
  startIndex: 0,
  status: "running",
};

function planIds(plan: ReturnType<typeof buildQueueAwareRenderPlan>): string[] {
  return plan.map((item) =>
    item.type === "queued" ? `queued:${item.message.id}` : item.message.id,
  );
}

describe("queued prompt anchoring", () => {
  it("keeps a pending follow-up beside the output visible at submission time", () => {
    const atSubmission: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "run a long task",
        turnId: "turn-1",
      },
      { id: "reasoning-1", kind: "reasoning", role: "agent", text: "plan" },
      {
        id: "tool-1",
        kind: "tool_call",
        role: "agent",
        callId: "call-1",
        name: "terminal",
        args: "first step",
      },
    ];
    const queued = createQueuedMessage(
      "check the second result too",
      [],
      atSubmission,
      activeTurn,
      1,
    );
    const afterMoreOutput: ChatMessage[] = [
      ...atSubmission,
      {
        id: "tool-2",
        kind: "tool_call",
        role: "agent",
        callId: "call-2",
        name: "terminal",
        args: "second step",
      },
      {
        id: "answer-1",
        role: "agent",
        content: "original turn complete",
        turnId: "turn-1",
      },
    ];

    expect(queued.anchor.afterMessageId).toBe("tool-1");
    expect(
      planIds(buildQueueAwareRenderPlan(afterMoreOutput, [queued])),
    ).toEqual([
      "user-1",
      "reasoning-1",
      "tool-1",
      `queued:${queued.id}`,
      "tool-2",
      "answer-1",
    ]);
  });

  it("renders a dequeued prompt once at its captured anchor without reordering state", () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "run a long task",
        turnId: "turn-1",
      },
      {
        id: "tool-1",
        kind: "tool_call",
        role: "agent",
        callId: "call-1",
        name: "terminal",
        args: "first step",
      },
      {
        id: "answer-1",
        role: "agent",
        content: "original turn complete",
        turnId: "turn-1",
      },
      {
        id: "user-2",
        role: "user",
        content: "follow up",
        turnId: "turn-2",
        queueAnchor: {
          afterMessageId: "tool-1",
          afterMessageIndex: 1,
          sequence: 1,
          turnId: "turn-1",
        },
      },
    ];

    expect(planIds(buildQueueAwareRenderPlan(messages, []))).toEqual([
      "user-1",
      "tool-1",
      "user-2",
      "answer-1",
    ]);
    expect(messages.map((message) => message.id)).toEqual([
      "user-1",
      "tool-1",
      "answer-1",
      "user-2",
    ]);
  });
});
