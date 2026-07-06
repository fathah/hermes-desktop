import { describe, it, expect } from "vitest";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../src/renderer/src/screens/Chat/sessionHistory";

/**
 * Two call sites share this mapping:
 *
 *   1. `Layout.handleResumeSession` — when the user opens a saved
 *      session from the Sessions tab, we re-hydrate the chat from
 *      state.db.
 *   2. `useChatIPC.onChatDone` — at end of stream, we re-fetch the
 *      session and replace the in-memory transcript so reasoning /
 *      tool messages the gateway didn't stream (DeepSeek's
 *      `reasoning_content`, see NousResearch/hermes-agent#30449)
 *      become visible without a window-focus dance (#352).
 *
 * Both rely on this conversion producing the right `ChatMessage`
 * shape for every `DbHistoryItem.kind`. Tests below pin each branch
 * + the filter-null cases that protect against future kinds being
 * added upstream without a renderer update.
 */

describe("dbItemsToChatMessages", () => {
  it("returns user / assistant / reasoning rows in original order", () => {
    const items: DbHistoryItem[] = [
      { kind: "user", id: 1, content: "what's 2+2?" },
      { kind: "reasoning", id: 2, text: "Adding 2 and 2 gives 4." },
      { kind: "assistant", id: 3, content: "4" },
    ];

    const out = dbItemsToChatMessages(items);

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ role: "user", content: "what's 2+2?" });
    expect(out[1]).toMatchObject({
      kind: "reasoning",
      role: "agent",
      text: "Adding 2 and 2 gives 4.",
    });
    expect(out[2]).toMatchObject({ role: "agent", content: "4" });
  });

  it("preserves attachments on user, assistant, and tool_result", () => {
    const att = [{ id: "a1", kind: "image" as const, name: "x.png", size: 1 }];
    const items: DbHistoryItem[] = [
      { kind: "user", id: 1, content: "see this", attachments: att },
      { kind: "assistant", id: 2, content: "Got it.", attachments: att },
      {
        kind: "tool_result",
        id: 3,
        callId: "c1",
        name: "fs.read",
        content: "ok",
        attachments: att,
      },
    ];

    const out = dbItemsToChatMessages(items);

    expect(out).toHaveLength(3);
    expect("attachments" in out[0] && out[0].attachments).toEqual(att);
    expect("attachments" in out[1] && out[1].attachments).toEqual(att);
    expect("attachments" in out[2] && out[2].attachments).toEqual(att);
  });

  it("maps desktop continuation errors back to assistant error bubbles", () => {
    const items: DbHistoryItem[] = [
      {
        kind: "assistant",
        id: -1,
        content: "",
        error: "Invalid API Key",
      },
    ];

    const out = dbItemsToChatMessages(items);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "db--1",
      role: "agent",
      content: "",
      error: "Invalid API Key",
      localOnly: true,
    });
  });

  it("omits attachments when empty or missing (no spurious `attachments: []`)", () => {
    const items: DbHistoryItem[] = [
      { kind: "user", id: 1, content: "hi" },
      { kind: "user", id: 2, content: "hi", attachments: [] },
    ];

    const out = dbItemsToChatMessages(items);

    for (const m of out) {
      expect(m).not.toHaveProperty("attachments");
    }
  });

  it("emits stable ids per kind so React keys don't collide across kinds", () => {
    // All four agent-side kinds can have the same raw db row id;
    // distinct prefixes (`db-N`, `db-r-N`, `db-tc-N-…`, `db-tr-N`)
    // keep the React keys unique. A regression here would cause
    // collisions and disappearing rows when streaming refreshes
    // bring in new reasoning/tool rows after content.
    const items: DbHistoryItem[] = [
      { kind: "assistant", id: 7, content: "hello" },
      { kind: "reasoning", id: 7, text: "thinking…" },
      {
        kind: "tool_call",
        id: 7,
        callId: "abc",
        name: "fs.read",
        args: '{"path":"."}',
      },
      {
        kind: "tool_result",
        id: 7,
        callId: "abc",
        name: "fs.read",
        content: "ok",
      },
    ];

    const ids = dbItemsToChatMessages(items).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters out unknown kinds rather than crashing", () => {
    const items = [
      { kind: "user", id: 1, content: "ok" },
      // Future kind the renderer doesn't know about yet.
      { kind: "future_thing", id: 2 } as unknown as DbHistoryItem,
      { kind: "assistant", id: 3, content: "yes" },
    ];

    const out = dbItemsToChatMessages(items as DbHistoryItem[]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "user" });
    expect(out[1]).toMatchObject({ role: "agent" });
  });

  it("survives missing optional fields with defensive defaults", () => {
    // Old sessions in state.db may have NULL values for fields the
    // current schema treats as optional. Mapping must produce a
    // usable `ChatMessage` even when those land as undefined.
    const items: DbHistoryItem[] = [
      { kind: "assistant", id: 1 },
      { kind: "reasoning", id: 2 },
      { kind: "tool_call", id: 3 },
      { kind: "tool_result", id: 4 },
    ];

    const out = dbItemsToChatMessages(items);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ role: "agent", content: "" });
    expect(out[1]).toMatchObject({ kind: "reasoning", text: "" });
    expect(out[2]).toMatchObject({ kind: "tool_call", name: "", args: "" });
    expect(out[3]).toMatchObject({ kind: "tool_result", content: "" });
  });
});
