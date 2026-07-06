import { describe, expect, it } from "vitest";
import {
  liveToolEventFromProgress,
  upsertLiveToolEvent,
} from "../src/renderer/src/screens/Chat/liveToolEvents";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

describe("upsertLiveToolEvent", () => {
  it("renders legacy progress labels as structured running tool rows", () => {
    const next = upsertLiveToolEvent(
      [{ id: "u-1", role: "user", content: "make image" }],
      liveToolEventFromProgress(
        "💻 python C:/Users/pmos6/AppData/Local/Temp/generate_duck_bathtub.py",
      ),
    );

    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      kind: "tool_call",
      name: "terminal",
      args: "python C:/Users/pmos6/AppData/Local/Temp/generate_duck_bathtub.py",
      status: "running",
    });
  });

  it("lets stable tool events replace an earlier progress-created row", () => {
    const progress = upsertLiveToolEvent(
      [{ id: "u-1", role: "user", content: "make image" }],
      liveToolEventFromProgress("terminal"),
    );

    const next = upsertLiveToolEvent(progress, {
      callId: "call-terminal",
      hasStableCallId: true,
      name: "terminal",
      status: "running",
      preview: "python generate_duck.py",
    });

    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      id: "tool-call-live-tool:progress:terminal:terminal:1",
      callId: "call-terminal",
      name: "terminal",
      args: "python generate_duck.py",
      status: "running",
    });
  });

  it("creates a history row after the current live assistant segment", () => {
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
      "a-1",
      "tool-call-call-search",
    ]);
    expect(next[2]).toMatchObject({
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

  it("inserts a live tool result after the completed tool call", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "run" },
      {
        id: "tool-call-call-terminal",
        kind: "tool_call",
        role: "agent",
        callId: "call-terminal",
        name: "terminal",
        args: "python script.py",
        status: "running",
      },
      { id: "a-1", role: "agent", content: "Working" },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "call-terminal",
      hasStableCallId: true,
      name: "terminal",
      status: "completed",
      result: "COMMAND OUTPUT\nok",
    });

    expect(next.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-call-terminal",
      "tool-result-call-terminal",
      "a-1",
    ]);
    expect(next[1]).toMatchObject({ status: "completed" });
    expect(next[2]).toMatchObject({
      kind: "tool_result",
      callId: "call-terminal",
      content: "COMMAND OUTPUT\nok",
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
      "a-1",
      "tool-call-call-terminal",
    ]);
  });

  it("lets later assistant chunks start after a tool boundary", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "make image" },
      { id: "a-1", role: "agent", content: "First, I will check setup." },
    ];

    const withTool = upsertLiveToolEvent(messages, {
      callId: "call-terminal",
      hasStableCallId: true,
      name: "terminal",
      status: "running",
      label: "curl health check",
    });
    const nextChunk: ChatMessage = {
      id: "a-2",
      role: "agent",
      content: "Now I will generate it.",
    };

    expect([...withTool, nextChunk].map((m) => m.id)).toEqual([
      "u-1",
      "a-1",
      "tool-call-call-terminal",
      "a-2",
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

    expect(next[1]).toMatchObject({
      status: "completed",
      args: "health check",
    });
    expect(next[2]).toMatchObject({
      status: "completed",
      args: "python generate_duck.py",
    });
  });

  it("matches a stable completion to a synthetic running row by name", () => {
    const messages: ChatMessage[] = [
      { id: "u-1", role: "user", content: "run a check" },
      {
        id: "tool-call-live-tool:terminal:terminal:1",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:terminal:terminal:1",
        name: "terminal",
        args: "npm test",
        status: "running",
      },
    ];

    const next = upsertLiveToolEvent(messages, {
      callId: "call-42",
      hasStableCallId: true,
      name: "terminal",
      status: "completed",
      result: "ok",
    });

    expect(next.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-live-tool:terminal:terminal:1",
      "tool-result-call-42",
    ]);
    expect(next[1]).toMatchObject({
      callId: "call-42",
      name: "terminal",
      args: "npm test",
      status: "completed",
    });
    expect(next[2]).toMatchObject({
      kind: "tool_result",
      callId: "call-42",
      content: "ok",
    });
  });

  it("preserves synthetic call ids after completion so later invocations get unique rows", () => {
    const firstRunning = upsertLiveToolEvent(
      [{ id: "u-1", role: "user", content: "make image" }],
      {
        callId: "run-1:terminal",
        hasStableCallId: false,
        name: "terminal",
        status: "running",
        preview: "health check",
      },
    );

    const firstCompleted = upsertLiveToolEvent(firstRunning, {
      callId: "run-1:terminal",
      hasStableCallId: false,
      name: "terminal",
      status: "completed",
      label: "terminal",
    });

    const secondRunning = upsertLiveToolEvent(firstCompleted, {
      callId: "run-1:terminal",
      hasStableCallId: false,
      name: "terminal",
      status: "running",
      preview: "python generate_duck.py",
    });

    expect(secondRunning.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-live-tool:run-1:terminal:1",
      "tool-call-live-tool:run-1:terminal:2",
    ]);
    expect(secondRunning[1]).toMatchObject({
      callId: "live-tool:run-1:terminal:1",
      status: "completed",
      args: "health check",
    });
    expect(secondRunning[2]).toMatchObject({
      callId: "live-tool:run-1:terminal:2",
      status: "running",
      args: "python generate_duck.py",
    });
  });
});
