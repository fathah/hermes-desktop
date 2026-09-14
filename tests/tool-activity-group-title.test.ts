import { describe, expect, it, vi } from "vitest";

vi.mock("react-loader-spinner", () => ({
  Grid: () => null,
}));
import {
  orderToolActivityItems,
  toolActivityGroupTitle,
} from "../src/renderer/src/screens/Chat/HistoryRow";
import type {
  ToolCallMessage,
  ToolResultMessage,
} from "../src/renderer/src/screens/Chat/types";

const call = (id: string, name: string): ToolCallMessage => ({
  id: `tool-call-${id}`,
  kind: "tool_call",
  role: "agent",
  callId: id,
  name,
  args: "",
  status: "completed",
});

const result = (id: string, name: string): ToolResultMessage => ({
  id: `tool-result-${id}`,
  kind: "tool_result",
  role: "agent",
  callId: id,
  name,
  content: "ok",
});

describe("toolActivityGroupTitle", () => {
  it("keeps the tool name for a single call/result pair", () => {
    expect(
      toolActivityGroupTitle([call("a", "terminal"), result("a", "terminal")]),
    ).toBe("Terminal");
  });

  it("summarizes groups with more than one tool call", () => {
    expect(
      toolActivityGroupTitle([
        call("a", "skill_view"),
        result("a", "skill_view"),
        call("b", "terminal"),
        result("b", "terminal"),
      ]),
    ).toBe("2 tools called");
  });

  it("excludes tool results from the count", () => {
    expect(
      toolActivityGroupTitle([
        call("a", "terminal"),
        result("a", "terminal"),
        result("b", "terminal"),
      ]),
    ).toBe("Terminal");
  });
});

describe("orderToolActivityItems", () => {
  it("pairs batched DB tool results with their calls", () => {
    const ordered = orderToolActivityItems([
      call("a", "terminal"),
      call("b", "terminal"),
      result("a", "terminal"),
      result("b", "terminal"),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "tool-call-a",
      "tool-result-a",
      "tool-call-b",
      "tool-result-b",
    ]);
  });

  it("keeps already paired tool rows stable", () => {
    const ordered = orderToolActivityItems([
      call("a", "terminal"),
      result("a", "terminal"),
      call("b", "terminal"),
      result("b", "terminal"),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "tool-call-a",
      "tool-result-a",
      "tool-call-b",
      "tool-result-b",
    ]);
  });

  it("keeps unmatched result rows visible", () => {
    const ordered = orderToolActivityItems([
      call("a", "terminal"),
      result("missing", "terminal"),
      result("a", "terminal"),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "tool-call-a",
      "tool-result-a",
      "tool-result-missing",
    ]);
  });
});
