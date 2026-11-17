import { describe, expect, it } from "vitest";
import { reconcileStreamedWithDb } from "../src/renderer/src/screens/Chat/sessionHistory";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

const user = (id: string, content: string): ChatMessage => ({
  id,
  role: "user",
  content,
});
const agent = (
  id: string,
  content: string,
  timestamp?: number,
): ChatMessage => ({
  id,
  role: "agent",
  content,
  ...(timestamp !== undefined ? { timestamp } : {}),
});

describe("short partial live replies (#1089)", () => {
  // @lat: [[chat-commands#Canonical database tail recovery#Short partial reply folds into its turn]]
  it("keeps one completed bubble with the live id when the live reply is cut short", () => {
    const merged = reconcileStreamedWithDb(
      [user("s1", "Say hello"), agent("s2", "Hello")],
      [user("d1", "Say hello"), agent("d2", "Hello world", 42)],
    );
    expect(merged.map((m) => m.id)).toEqual(["s1", "s2"]);
    expect(merged[1]).toMatchObject({ content: "Hello world", timestamp: 42 });
  });

  // @lat: [[chat-commands#Canonical database tail recovery#Short partial reply folds into its turn]]
  it("does not fold a live reply into a database reply from another turn", () => {
    const merged = reconcileStreamedWithDb(
      [user("s1", "First"), agent("s2", "Hello"), user("s3", "Second")],
      [user("d1", "First"), user("d3", "Second"), agent("d4", "Hello world")],
    );
    expect(merged.map((m) => m.id)).toEqual(["s1", "s2", "s3", "d4"]);
    expect(merged[1]).toMatchObject({ content: "Hello" });
  });

  // @lat: [[chat-commands#Canonical database tail recovery#Short partial reply folds into its turn]]
  it("leaves a live reply that the database reply does not extend", () => {
    const merged = reconcileStreamedWithDb(
      [user("s1", "Say hello"), agent("s2", "Hi there")],
      [user("d1", "Say hello"), agent("d2", "Hello world")],
    );
    expect(merged.map((m) => m.id)).toEqual(["s1", "s2", "d2"]);
  });

  // @lat: [[chat-commands#Canonical database tail recovery#Short partial reply folds into its turn]]
  it("folds each database reply into at most one live reply", () => {
    const merged = reconcileStreamedWithDb(
      [user("s1", "Go"), agent("s2", "Hel"), agent("s3", "Hello")],
      [user("d1", "Go"), agent("d2", "Hello world")],
    );
    expect(
      merged.filter((m) => "role" in m && m.role === "agent"),
    ).toHaveLength(2);
    expect(merged.some((m) => m.id === "d2")).toBe(false);
  });

  // @lat: [[chat-commands#Canonical database tail recovery#Short partial reply folds into its turn]]
  it("does not borrow a saved reply from the other side of a tool call", () => {
    const toolCall = (id: string): ChatMessage => ({
      id,
      kind: "tool_call",
      role: "agent",
      callId: "c1",
      name: "search",
      args: "{}",
    });
    const merged = reconcileStreamedWithDb(
      [user("s1", "Find it"), toolCall("live-tc"), agent("s3", "Result:")],
      [
        user("d1", "Find it"),
        agent("d2", "Result: let me check"),
        toolCall("db-tc"),
        agent("d4", "Result: found it"),
      ],
    );
    const agentText = merged
      .filter((m) => !("kind" in m) && m.role === "agent")
      .map((m) => ("content" in m ? m.content : ""));
    expect(agentText).toEqual(["Result: let me check", "Result: found it"]);
    expect(merged.some((m) => m.id === "s3")).toBe(true);
    expect(merged.some((m) => m.id === "d4")).toBe(false);
  });
});
