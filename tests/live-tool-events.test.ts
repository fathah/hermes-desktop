import { describe, expect, it } from "vitest";
import { upsertLiveToolEvent } from "../src/renderer/src/screens/Chat/liveToolEvents";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

describe("upsertLiveToolEvent", () => {
  it("creates a history row before the live assistant answer", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "search" },
      { id: "a-1", role: "agent", content: "Working" },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "call-search",
      hasStableCallId: true,
      name: "search_web",
      status: "running",
      label: "Searching the web",
    });

    expect(next.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-call-search",
      "a-1",
    ]);
    expect(next[1]).toMatchObject({
      kind: "tool_call",
      callId: "call-search",
      name: "search_web",
      args: "Searching the web",
      status: "running",
    });
  });

  it("updates the same live row when the gateway reports completion", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "run" },
      {
        id: "tool-call-call-terminal",
        kind: "tool_call",
        role: "agent",
        callId: "call-terminal",
        name: "terminal",
        args: "Running command",
        status: "running",
      },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "call-terminal",
      hasStableCallId: true,
      name: "terminal",
      status: "completed",
      label: "terminal",
    });

    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      id: "tool-call-call-terminal",
      status: "completed",
      args: "Running command",
    });
  });

  it("does not replace a useful running preview with a generic completion label", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "run" },
      {
        id: "tool-call-call-terminal",
        kind: "tool_call",
        role: "agent",
        callId: "call-terminal",
        name: "terminal",
        args: "python C:/Users/pmos6/AppData/Local/Temp/generate_duck.py",
        status: "running",
      },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "call-terminal",
      hasStableCallId: true,
      name: "terminal",
      status: "completed",
      label: "terminal",
    });

    expect(next[1]).toMatchObject({
      status: "completed",
      args: "python C:/Users/pmos6/AppData/Local/Temp/generate_duck.py",
    });
  });

  it("appends new live rows after earlier tool rows, not at the top", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "make image" },
      {
        id: "tool-call-skill",
        kind: "tool_call",
        role: "agent",
        callId: "call-skill",
        name: "skill_view",
        args: "skill_view",
        status: "completed",
      },
      { id: "a-1", role: "agent", content: "Working" },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "call-terminal",
      hasStableCallId: true,
      name: "terminal",
      status: "running",
      label: "terminal",
    });

    expect(next.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-skill",
      "tool-call-call-terminal",
      "a-1",
    ]);
  });

  it("does not reuse synthetic no-id tool rows for repeated invocations", () => {
    const first = upsertLiveToolEvent(
      [{ id: "u-1", role: "user", content: "make image" }],
      {
        callId: "terminal:terminal",
        hasStableCallId: false,
        name: "terminal",
        status: "running",
        label: "terminal",
      },
    );

    const second = upsertLiveToolEvent(first, {
      callId: "terminal:terminal",
      hasStableCallId: false,
      name: "terminal",
      status: "running",
      label: "python generate_duck.py",
    });

    expect(second.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-live-tool:terminal:terminal:1",
      "tool-call-live-tool:terminal:terminal:2",
    ]);
    expect(second[1]).toMatchObject({ args: "terminal" });
    expect(second[2]).toMatchObject({ args: "python generate_duck.py" });
  });

  it("matches synthetic completion to the latest running row for that tool", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "make image" },
      {
        id: "tool-call-live-tool:terminal:terminal:1",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:terminal:terminal:1",
        name: "terminal",
        args: "health check",
        status: "completed",
      },
      {
        id: "tool-call-live-tool:terminal:terminal:2",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:terminal:terminal:2",
        name: "terminal",
        args: "python generate_duck.py",
        status: "running",
      },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "terminal:terminal",
      hasStableCallId: false,
      name: "terminal",
      status: "completed",
      label: "terminal",
    });

    expect(next[1]).toMatchObject({ status: "completed", args: "health check" });
    expect(next[2]).toMatchObject({
      status: "completed",
      args: "python generate_duck.py",
    });
  });
});
