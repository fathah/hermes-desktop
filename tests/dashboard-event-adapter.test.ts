import { describe, expect, it } from "vitest";
import {
  applyDashboardStreamEvent,
  type DashboardEventState,
} from "../src/renderer/src/screens/Chat/dashboardEventAdapter";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

function reduceEvents(
  events: Parameters<typeof applyDashboardStreamEvent>[1][],
): ChatMessage[] {
  let state: DashboardEventState = {
    messages: [{ id: "u-1", role: "user", content: "make image" }],
    reasoningSegmentClosed: false,
  };
  events.forEach((event, index) => {
    state = applyDashboardStreamEvent(state, event, { now: 100 + index });
  });
  return state.messages;
}

describe("applyDashboardStreamEvent", () => {
  it("preserves reasoning, tool, and assistant output sequence", () => {
    const messages = reduceEvents([
      { type: "reasoning.delta", payload: { text: "I will check setup. " } },
      {
        type: "tool.start",
        payload: {
          tool_id: "call-health",
          name: "terminal",
          args: "curl /system_stats",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_id: "call-health",
          name: "terminal",
          result: "ok",
        },
      },
      { type: "message.delta", payload: { text: "Setup is ready. " } },
      { type: "reasoning.delta", payload: { text: "Now generate it." } },
      {
        type: "tool.start",
        payload: {
          tool_id: "call-generate",
          name: "execute_code",
          args: { script: "generate_duck.py" },
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_id: "call-generate",
          name: "execute_code",
          result: "saved duck.png",
        },
      },
      { type: "message.delta", payload: { text: "Done." } },
      { type: "message.complete", payload: {} },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "reasoning",
      "tool_call",
      "tool_result",
      "agent",
      "reasoning",
      "tool_call",
      "tool_result",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({ text: "I will check setup. " });
    expect(messages[4]).toMatchObject({ content: "Setup is ready. " });
    expect(messages[5]).toMatchObject({ text: "Now generate it." });
    expect(messages[8]).toMatchObject({ content: "Done.", pending: false });
  });

  it("updates a repeated stable tool call instead of duplicating it", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          command: "python script.py",
        },
      },
      {
        type: "tool.progress",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          preview: "running python script.py",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          result: "ok",
        },
      },
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({
      kind: "tool_call",
      callId: "call-terminal",
      args: "running python script.py",
      status: "completed",
    });
    expect(messages[2]).toMatchObject({
      kind: "tool_result",
      callId: "call-terminal",
      content: "ok",
    });
  });

  it("does not append duplicate tool results for repeated completion events", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          command: "python script.py",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          result: "ok",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          result: "ok",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "tool_call",
      "tool_result",
    ]);
  });

  it("renders clarify requests as assistant questions instead of tool rows", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          tool_call_id: "call-clarify",
          name: "clarify",
          question: "Which provider should I use?",
        },
      },
      {
        type: "clarify.request",
        payload: {
          request_id: "ask-1",
          question: "Which provider should I use?",
          choices: ["Use local", "Use cloud"],
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-clarify",
          name: "clarify",
          result: "Use local",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      id: "clarify-ask-1",
      content: "Which provider should I use?\n\n1. Use local\n2. Use cloud",
      localOnly: true,
    });
  });

  it("drops empty unstable tool-start placeholders before the detailed call event", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          name: "skill_view",
        },
      },
      {
        type: "tool.start",
        payload: {
          name: "skill_view",
          arguments: { name: "ai-playground-image-gen" },
        },
      },
      {
        type: "tool.complete",
        payload: {
          name: "skill_view",
          arguments: { name: "ai-playground-image-gen" },
          result: "loaded",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "tool_call",
      "tool_result",
    ]);
    expect(messages[1]).toMatchObject({
      kind: "tool_call",
      name: "skill_view",
      args: '{"name":"ai-playground-image-gen"}',
    });
  });

  it("keeps parallel tool completions at their event position while sharing call ids", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: { tool_id: "call-a", name: "terminal", command: "first" },
      },
      {
        type: "tool.start",
        payload: { tool_id: "call-b", name: "terminal", command: "second" },
      },
      {
        type: "tool.complete",
        payload: { tool_id: "call-a", name: "terminal", result: "first done" },
      },
      {
        type: "tool.complete",
        payload: { tool_id: "call-b", name: "terminal", result: "second done" },
      },
    ]);

    expect(messages.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-call-a",
      "tool-call-call-b",
      "tool-result-call-a-3",
      "tool-result-call-b-4",
    ]);
    expect(messages[1]).toMatchObject({
      callId: "call-a",
      status: "completed",
    });
    expect(messages[2]).toMatchObject({
      callId: "call-b",
      status: "completed",
    });
    expect(messages[3]).toMatchObject({ callId: "call-a" });
    expect(messages[4]).toMatchObject({ callId: "call-b" });
  });

  it("marks final streamed assistant bubbles complete without appending duplicate final text", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "time" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "It is " } },
      { now: 200 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "6:51 PM." } },
      { now: 201 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.complete", payload: {} },
      { now: 202 },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("It is 6:51 PM.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("uses full final text as a replacement for matching streamed deltas", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "time" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "It is 6" } },
      { now: 300 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.complete", payload: { text: "It is 6:51 PM." } },
      { now: 301 },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("It is 6:51 PM.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("replaces mismatched streamed deltas with the final completion text", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "korean" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "맞,측으로 말했습니다. " } },
      { now: 310 },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "message.complete",
        payload: { text: "맞아요. 추측으로 말했습니다." },
      },
      { now: 311 },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("맞아요. 추측으로 말했습니다.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("can suppress assistant deltas and render only final completion text", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "korean" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "맞,측으로 말했습니다. " } },
      { now: 320, renderAssistantDeltas: false },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "message.complete",
        payload: { text: "맞아요. 추측으로 말했습니다." },
      },
      { now: 321, renderAssistantDeltas: false },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("맞아요. 추측으로 말했습니다.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("does not show late reasoning snapshots that duplicate streamed assistant text", () => {
    const messages = reduceEvents([
      { type: "message.delta", payload: { text: "Done with the image." } },
      {
        type: "reasoning.available",
        payload: { text: "Done with the image." },
      },
      {
        type: "message.complete",
        payload: { text: "Done with the image." },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      content: "Done with the image.",
      pending: false,
    });
  });

  it("removes reasoning rows that duplicate final completion text", () => {
    const messages = reduceEvents([
      {
        type: "reasoning.available",
        payload: { text: "The answer is 42." },
      },
      {
        type: "message.complete",
        payload: { text: "The answer is 42." },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      content: "The answer is 42.",
      pending: false,
    });
  });

  it("uses non-duplicate completion reasoning when no reasoning streamed", () => {
    const messages = reduceEvents([
      {
        type: "message.complete",
        payload: {
          reasoning: "I checked the clock before answering.",
          text: "It is 6:51 PM.",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "reasoning",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      text: "I checked the clock before answering.",
    });
    expect(messages[2]).toMatchObject({
      content: "It is 6:51 PM.",
      pending: false,
    });
  });

  it("does not use completion reasoning when it duplicates the final answer", () => {
    const messages = reduceEvents([
      {
        type: "message.complete",
        payload: {
          reasoning: "It is 6:51 PM.",
          text: "It is 6:51 PM.",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      content: "It is 6:51 PM.",
      pending: false,
    });
  });

  it("ignores spinner thinking deltas and strips thinking placeholders", () => {
    const messages = reduceEvents([
      { type: "thinking.delta", payload: { text: "Hermes thinking..." } },
      {
        type: "reasoning.delta",
        payload: { text: "Thinking...current rewritten thinking" },
      },
      { type: "reasoning.delta", payload: { text: "Actual reasoning." } },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "reasoning",
    ]);
    expect(messages[1]).toMatchObject({ text: "Actual reasoning." });
  });
});
