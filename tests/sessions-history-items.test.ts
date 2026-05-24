/**
 * Tests for the rich history emission added to getSessionMessages.
 * Verifies that assistant tool_calls, role='tool' rows, and reasoning
 * columns are expanded into the right HistoryItem variants and emitted
 * in the right order — `(reasoning, assistant, tool_call, ...) → tool_result`.
 *
 * Uses the exported pure `expandRowsToHistory` helper so we don't need
 * better-sqlite3's native module to run (it's Electron-only).
 */

import { describe, expect, it } from "vitest";
import {
  expandRowsToHistory,
  pickReasoning,
  parseToolCalls,
  type RawMessageRow,
  type HistoryItem,
} from "../src/main/sessions";

function row(
  over: Partial<RawMessageRow> & {
    id: number;
    role: string;
    timestamp: number;
  },
): RawMessageRow {
  return {
    content: null,
    tool_call_id: null,
    tool_calls: null,
    tool_name: null,
    reasoning: null,
    reasoning_content: null,
    reasoning_details: null,
    ...over,
  };
}

describe("pickReasoning", () => {
  it("prefers the plain `reasoning` column", () => {
    expect(
      pickReasoning({
        reasoning: "primary",
        reasoning_content: "legacy",
        reasoning_details: "[]",
      }),
    ).toBe("primary");
  });

  it("falls back to `reasoning_content` when `reasoning` is blank", () => {
    expect(
      pickReasoning({
        reasoning: "",
        reasoning_content: "legacy",
        reasoning_details: null,
      }),
    ).toBe("legacy");
  });

  it("flattens `reasoning_details` blocks with `text` or `thinking`", () => {
    const text = pickReasoning({
      reasoning: null,
      reasoning_content: null,
      reasoning_details: JSON.stringify([
        { text: "block A" },
        { thinking: "block B" },
        { signature: "sig" }, // ignored
      ]),
    });
    expect(text).toBe("block A\n\nblock B");
  });

  it("returns '' when reasoning_details is malformed JSON", () => {
    expect(
      pickReasoning({
        reasoning: null,
        reasoning_content: null,
        reasoning_details: "{not-json",
      }),
    ).toBe("");
  });
});

describe("parseToolCalls", () => {
  it("returns [] for null / empty / non-JSON input", () => {
    expect(parseToolCalls(null)).toEqual([]);
    expect(parseToolCalls("")).toEqual([]);
    expect(parseToolCalls("{not-json")).toEqual([]);
  });

  it("extracts name, callId, and pretty-prints JSON arguments", () => {
    const out = parseToolCalls(
      JSON.stringify([
        {
          id: "id_a",
          call_id: "call_a",
          type: "function",
          function: { name: "terminal", arguments: '{"command":"ls"}' },
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("terminal");
    expect(out[0].callId).toBe("call_a");
    expect(out[0].args).toBe(JSON.stringify({ command: "ls" }, null, 2));
  });

  it("leaves arguments raw when they aren't valid JSON", () => {
    const out = parseToolCalls(
      JSON.stringify([
        {
          id: "x",
          type: "function",
          function: { name: "raw", arguments: "not-json-but-string" },
        },
      ]),
    );
    expect(out[0].args).toBe("not-json-but-string");
  });

  it("skips entries with no function.name", () => {
    const out = parseToolCalls(
      JSON.stringify([
        { id: "x", function: {} },
        { id: "y", function: { name: "ok", arguments: "{}" } },
      ]),
    );
    expect(out.map((t) => t.name)).toEqual(["ok"]);
  });
});

describe("expandRowsToHistory", () => {
  function kinds(items: HistoryItem[]): string[] {
    return items.map((i) => i.kind);
  }

  it("returns user and assistant bubbles for plain conversations", () => {
    const items = expandRowsToHistory([
      row({ id: 1, role: "user", content: "hi", timestamp: 1 }),
      row({ id: 2, role: "assistant", content: "hello!", timestamp: 2 }),
    ]);
    expect(kinds(items)).toEqual(["user", "assistant"]);
    expect(items[0]).toMatchObject({ kind: "user", content: "hi" });
    expect(items[1]).toMatchObject({ kind: "assistant", content: "hello!" });
  });

  it("emits reasoning *before* the assistant bubble", () => {
    const items = expandRowsToHistory([
      row({ id: 1, role: "user", content: "?", timestamp: 1 }),
      row({
        id: 2,
        role: "assistant",
        content: "answer",
        timestamp: 2,
        reasoning: "first I think...",
      }),
    ]);
    expect(kinds(items)).toEqual(["user", "reasoning", "assistant"]);
    const reasoning = items[1] as Extract<HistoryItem, { kind: "reasoning" }>;
    expect(reasoning.text).toBe("first I think...");
  });

  it("emits tool_calls after the assistant bubble, in array order", () => {
    const items = expandRowsToHistory([
      row({
        id: 1,
        role: "assistant",
        content: "let me check",
        timestamp: 1,
        tool_calls: JSON.stringify([
          {
            id: "call_a",
            call_id: "call_a",
            type: "function",
            function: { name: "terminal", arguments: '{"command":"ls"}' },
          },
          {
            id: "call_b",
            call_id: "call_b",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"a.txt"}' },
          },
        ]),
      }),
    ]);
    expect(kinds(items)).toEqual(["assistant", "tool_call", "tool_call"]);
    const a = items[1] as Extract<HistoryItem, { kind: "tool_call" }>;
    expect(a.name).toBe("terminal");
    expect(a.callId).toBe("call_a");
  });

  it("skips an assistant bubble that has no content (tool-only turn)", () => {
    const items = expandRowsToHistory([
      row({
        id: 1,
        role: "assistant",
        content: "",
        timestamp: 1,
        tool_calls: JSON.stringify([
          {
            id: "x",
            call_id: "x",
            type: "function",
            function: { name: "terminal", arguments: "{}" },
          },
        ]),
      }),
    ]);
    expect(kinds(items)).toEqual(["tool_call"]);
  });

  it("emits tool_result rows with their name and call_id", () => {
    const items = expandRowsToHistory([
      row({
        id: 1,
        role: "tool",
        content: "ok",
        timestamp: 1,
        tool_call_id: "call_a",
        tool_name: "terminal",
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool_result",
      name: "terminal",
      callId: "call_a",
      content: "ok",
    });
  });

  it("recovers gracefully when tool_calls JSON is malformed", () => {
    const items = expandRowsToHistory([
      row({
        id: 1,
        role: "assistant",
        content: "still here",
        timestamp: 1,
        tool_calls: "{not-json",
      }),
    ]);
    expect(kinds(items)).toEqual(["assistant"]);
  });

  it("preserves chronological order across a multi-turn conversation", () => {
    const items = expandRowsToHistory([
      row({ id: 1, role: "user", content: "do it", timestamp: 1 }),
      row({
        id: 2,
        role: "assistant",
        content: "ok",
        timestamp: 2,
        reasoning: "plan: run cmd",
        tool_calls: JSON.stringify([
          {
            id: "c1",
            call_id: "c1",
            type: "function",
            function: { name: "terminal", arguments: "{}" },
          },
        ]),
      }),
      row({
        id: 3,
        role: "tool",
        content: "result",
        timestamp: 3,
        tool_call_id: "c1",
        tool_name: "terminal",
      }),
      row({ id: 4, role: "assistant", content: "done", timestamp: 4 }),
    ]);
    expect(kinds(items)).toEqual([
      "user",
      "reasoning",
      "assistant",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
  });

  it("drops session_meta and other unknown roles", () => {
    const items = expandRowsToHistory([
      row({ id: 1, role: "session_meta", content: "meta", timestamp: 1 }),
      row({ id: 2, role: "user", content: "hi", timestamp: 2 }),
    ]);
    expect(kinds(items)).toEqual(["user"]);
  });

  it("skips user rows with no content and no attachments", () => {
    const items = expandRowsToHistory([
      row({ id: 1, role: "user", content: "", timestamp: 1 }),
      row({ id: 2, role: "user", content: null, timestamp: 2 }),
      row({ id: 3, role: "user", content: "real", timestamp: 3 }),
    ]);
    expect(kinds(items)).toEqual(["user"]);
    expect((items[0] as Extract<HistoryItem, { kind: "user" }>).content).toBe(
      "real",
    );
  });
});
