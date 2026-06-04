import { describe, it, expect } from "vitest";
import { reconcileStreamedWithDb } from "../src/renderer/src/screens/Chat/sessionHistory";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

/**
 * `reconcileStreamedWithDb` is the end-of-stream merge between the
 * in-memory streamed transcript and the canonical `state.db` rows
 * returned by `getSessionMessages`.
 *
 * Two cases drive the design:
 *
 *   1. Today — DeepSeek (and o1/o3) emit `reasoning_content` over SSE
 *      but the gateway (NousResearch/hermes-agent#30449) doesn't
 *      forward it. So reasoning + tool rows only exist in state.db.
 *      The merge must ADD those rows so the user sees them without
 *      a window-focus dance.
 *
 *   2. After upstream #30449 lands — reasoning streams in real time
 *      with a renderer-side id like `reasoning-${ts}`. The merge
 *      must KEEP that streamed id so React doesn't re-mount the
 *      already-rendered bubble when the DB version (id `db-r-…`)
 *      arrives at end-of-stream.
 *
 * Both behaviours are pinned below.
 */

const STREAMED_USER = (content: string, id = "u-1"): ChatMessage => ({
  id,
  role: "user",
  content,
});

const STREAMED_IMAGE_USER = (content: string, id = "u-img"): ChatMessage => ({
  id,
  role: "user",
  content,
  attachments: [
    {
      id: "img-1",
      kind: "image",
      name: "pasted-image.png",
      mime: "image/png",
      size: 3,
      dataUrl: "data:image/png;base64,AAA=",
    },
  ],
});

const STREAMED_AGENT = (content: string, id = "a-1"): ChatMessage => ({
  id,
  role: "agent",
  content,
});

const STREAMED_REASONING = (text: string, id = "r-1"): ChatMessage => ({
  id,
  kind: "reasoning",
  role: "agent",
  text,
});

const DB_USER = (content: string, dbId = 10): ChatMessage => ({
  id: `db-${dbId}`,
  role: "user",
  content,
});

const DB_AGENT = (content: string, dbId = 11): ChatMessage => ({
  id: `db-${dbId}`,
  role: "agent",
  content,
});

const DB_REASONING = (text: string, dbId = 12): ChatMessage => ({
  id: `db-r-${dbId}`,
  kind: "reasoning",
  role: "agent",
  text,
});

const DB_TOOL_CALL = (
  callId: string,
  name: string,
  args: string,
  dbId = 13,
): ChatMessage => ({
  id: `db-tc-${dbId}-${callId}`,
  kind: "tool_call",
  role: "agent",
  callId,
  name,
  args,
});

const DB_TOOL_RESULT = (
  callId: string,
  name: string,
  content: string,
  dbId = 14,
): ChatMessage => ({
  id: `db-tr-${dbId}`,
  kind: "tool_result",
  role: "agent",
  callId,
  name,
  content,
});

describe("reconcileStreamedWithDb", () => {
  it("today: gateway doesn't stream reasoning — merge inserts reasoning from DB", () => {
    // Streamed transcript: user msg + assistant content (no reasoning).
    const streamed: ChatMessage[] = [
      STREAMED_USER("hi", "u-1"),
      STREAMED_AGENT("hello", "a-1"),
    ];
    // DB has the same user/assistant rows + a reasoning row in between.
    const db: ChatMessage[] = [
      DB_USER("hi", 1),
      DB_REASONING("user said hi, respond politely", 2),
      DB_AGENT("hello", 3),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged).toHaveLength(3);
    // User & assistant keep their streamed ids (no re-mount).
    expect(merged[0].id).toBe("u-1");
    expect(merged[2].id).toBe("a-1");
    // Reasoning came in from DB — has the db-r- prefix.
    expect(merged[1].id).toBe("db-r-2");
    expect(
      (merged[1] as Extract<ChatMessage, { kind: "reasoning" }>).text,
    ).toBe("user said hi, respond politely");
  });

  it("future: reasoning DOES stream — merge keeps the streamed id, no re-mount", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("hi", "u-1"),
      STREAMED_REASONING("user said hi, respond politely", "r-stream-99"),
      STREAMED_AGENT("hello", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("hi", 1),
      DB_REASONING("user said hi, respond politely", 2),
      DB_AGENT("hello", 3),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged).toHaveLength(3);
    // All three retain their streamed ids — React doesn't re-mount.
    expect(merged.map((m) => m.id)).toEqual(["u-1", "r-stream-99", "a-1"]);
  });

  it("tool_call and tool_result rows come straight from DB (they never stream)", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("read foo.txt", "u-1"),
      STREAMED_AGENT("Done.", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("read foo.txt", 1),
      DB_TOOL_CALL("call-42", "fs.read", '{"path":"foo.txt"}', 2),
      DB_TOOL_RESULT("call-42", "fs.read", "(file contents)", 3),
      DB_AGENT("Done.", 4),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged).toHaveLength(4);
    // User and assistant keep their streamed identities.
    expect(merged[0].id).toBe("u-1");
    expect(merged[3].id).toBe("a-1");
    // Tool rows are sourced from DB with their db- ids.
    expect(merged[1].id).toBe("db-tc-2-call-42");
    expect(merged[2].id).toBe("db-tr-3");
  });

  it("handles a turn that fully streamed including reasoning AND has new tool rows in DB", () => {
    // The most common "future" case: reasoning streamed live, then the
    // model used a tool, then produced a final answer. Only the tool
    // rows are new at merge time.
    const streamed: ChatMessage[] = [
      STREAMED_USER("what time is it in Tokyo?", "u-1"),
      STREAMED_REASONING("I need to call get_time for Tokyo.", "r-stream-1"),
      STREAMED_AGENT("It's 3pm in Tokyo.", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("what time is it in Tokyo?", 1),
      DB_REASONING("I need to call get_time for Tokyo.", 2),
      DB_TOOL_CALL("call-99", "get_time", '{"zone":"Asia/Tokyo"}', 3),
      DB_TOOL_RESULT("call-99", "get_time", "15:00 JST", 4),
      DB_AGENT("It's 3pm in Tokyo.", 5),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged).toHaveLength(5);
    // Streamed rows preserved.
    expect(merged[0].id).toBe("u-1");
    expect(merged[1].id).toBe("r-stream-1");
    expect(merged[4].id).toBe("a-1");
    // Tool rows added from DB at their canonical positions.
    expect(merged[2].id).toBe("db-tc-3-call-99");
    expect(merged[3].id).toBe("db-tr-4");
  });

  it("duplicate content across turns is matched in order (FIFO, not collapse)", () => {
    // User asked "ping" twice in two separate turns. The merge must not
    // collapse both DB "ping" rows onto the first streamed "ping".
    const streamed: ChatMessage[] = [
      STREAMED_USER("ping", "u-first"),
      STREAMED_AGENT("pong", "a-first"),
      STREAMED_USER("ping", "u-second"),
      STREAMED_AGENT("pong", "a-second"),
    ];
    const db: ChatMessage[] = [
      DB_USER("ping", 1),
      DB_AGENT("pong", 2),
      DB_USER("ping", 3),
      DB_AGENT("pong", 4),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-first",
      "a-first",
      "u-second",
      "a-second",
    ]);
  });

  it("preserves a renderer-only bubble that has no DB equivalent (error rows)", () => {
    // `onChatError` writes a synthetic "Error: …" row into the in-memory
    // transcript. It has no state.db row. Reconciliation must keep it
    // so the user doesn't lose visibility of what went wrong.
    const errorBubble: ChatMessage = {
      id: "error-1",
      role: "agent",
      content: "Error: provider returned 401",
    };
    const streamed: ChatMessage[] = [STREAMED_USER("hi", "u-1"), errorBubble];
    const db: ChatMessage[] = [DB_USER("hi", 1)];

    const merged = reconcileStreamedWithDb(streamed, db);

    // The user row reconciled by content; the error row appended at end.
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe("u-1");
    expect(merged[1].id).toBe("error-1");
  });

  it("handles an empty streamed array (cold session load)", () => {
    const db: ChatMessage[] = [
      DB_USER("hi", 1),
      DB_REASONING("respond politely", 2),
      DB_AGENT("hello", 3),
    ];

    const merged = reconcileStreamedWithDb([], db);

    // Pure pass-through of DB rows.
    expect(merged).toEqual(db);
  });

  it("deduplicates streamed messages that exceed DB row count", () => {
    // Edge case: the renderer somehow held two streamed bubbles with
    // identical content, but the DB only has one.  This is the exact
    // duplication bug — the merge should deduplicate by content so
    // only one message appears in the output.
    const streamed: ChatMessage[] = [
      STREAMED_AGENT("hello", "a-1"),
      STREAMED_AGENT("hello", "a-2"),
    ];
    const db: ChatMessage[] = [DB_AGENT("hello", 7)];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged).toHaveLength(1);
    // DB row takes precedence; the duplicate streamed row is dropped.
    expect(merged[0].id).toBe("a-1");
  });

  it("drops a concatenated streamed assistant bubble when DB splits the turn", () => {
    const partA = "First paragraph from before the tool call.";
    const partB = "Second paragraph after the tool result.";
    const streamed: ChatMessage[] = [
      STREAMED_USER("do the thing", "u-1"),
      STREAMED_AGENT(`${partA}\n\n${partB}`, "a-concat"),
    ];
    const db: ChatMessage[] = [
      DB_USER("do the thing", 1),
      DB_AGENT(partA, 2),
      DB_TOOL_CALL("call-1", "terminal", '{"command":"echo ok"}', 3),
      DB_TOOL_RESULT("call-1", "terminal", "ok", 4),
      DB_AGENT(partB, 5),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-1",
      "db-2",
      "db-tc-3-call-1",
      "db-tr-4",
      "db-5",
    ]);
    expect(
      merged.filter(
        (m) => !("kind" in m) && m.content.includes(partB),
      ),
    ).toHaveLength(1);
  });

  it("does not repeat long-chat tool-split turns during DB refresh", () => {
    const turn2A = "I checked the current directory before running the command.";
    const turn2B = "The directory contains package.json and src.";
    const turn3A = "I will inspect the failing test next.";
    const turn3B = "The failing assertion is caused by duplicate rendering.";
    const streamed: ChatMessage[] = [
      STREAMED_USER("hello", "u-1"),
      STREAMED_AGENT("Hi there.", "a-1"),
      STREAMED_USER("list files", "u-2"),
      STREAMED_AGENT(`${turn2A}\n\n${turn2B}`, "a-2-concat"),
      STREAMED_USER("why is it failing?", "u-3"),
      STREAMED_AGENT(`${turn3A}\n\n${turn3B}`, "a-3-concat"),
    ];
    const db: ChatMessage[] = [
      DB_USER("hello", 1),
      DB_AGENT("Hi there.", 2),
      DB_USER("list files", 3),
      DB_AGENT(turn2A, 4),
      DB_TOOL_CALL("call-ls", "terminal", '{"command":"ls"}', 5),
      DB_TOOL_RESULT("call-ls", "terminal", "package.json\nsrc", 6),
      DB_AGENT(turn2B, 7),
      DB_USER("why is it failing?", 8),
      DB_AGENT(turn3A, 9),
      DB_TOOL_CALL("call-test", "terminal", '{"command":"npm test"}', 10),
      DB_TOOL_RESULT("call-test", "terminal", "1 failed", 11),
      DB_AGENT(turn3B, 12),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-1",
      "a-1",
      "u-2",
      "db-4",
      "db-tc-5-call-ls",
      "db-tr-6",
      "db-7",
      "u-3",
      "db-9",
      "db-tc-10-call-test",
      "db-tr-11",
      "db-12",
    ]);
    for (const text of [turn2B, turn3B]) {
      expect(
        merged.filter((m) => !("kind" in m) && m.content.includes(text)),
      ).toHaveLength(1);
    }
  });

  it("preserves unmatched streamed bubbles that are not covered by a DB split", () => {
    const streamedOnly = STREAMED_AGENT(
      "Renderer-only warning: the provider closed the stream early.",
      "a-warning",
    );
    const streamed: ChatMessage[] = [
      STREAMED_USER("hi", "u-1"),
      streamedOnly,
    ];
    const db: ChatMessage[] = [
      DB_USER("hi", 1),
      DB_AGENT("A different DB response.", 2),
      DB_AGENT("Another canonical row.", 3),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged[merged.length - 1]).toBe(streamedOnly);
  });

  it("does not drop a streamed answer that quotes assistant rows from different turns", () => {
    const quoteA = "Earlier answer A.";
    const quoteB = "Earlier answer B.";
    const quotedSummary = `${quoteA}\n\n${quoteB}`;
    const streamed: ChatMessage[] = [
      STREAMED_USER("summarize prior answers", "u-current"),
      STREAMED_AGENT(quotedSummary, "a-current"),
    ];
    const db: ChatMessage[] = [
      DB_USER("first question", 1),
      DB_AGENT(quoteA, 2),
      DB_USER("second question", 3),
      DB_AGENT(quoteB, 4),
      DB_USER("summarize prior answers", 5),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged[merged.length - 1]).toMatchObject({
      id: "a-current",
      role: "agent",
      content: quotedSummary,
    });
  });

  it("keeps earlier streamed turns before a DB suffix from a split session", () => {
    // Regression: a cold desktop send briefly fell back to the CLI path,
    // which created a timestamp-style session id. The next send used the
    // API path and generated a fresh desk-* id. At chat-done, the DB fetch
    // returned only the desk-* suffix, and the old reconciliation appended
    // the unmatched first turn after the latest answer.
    const streamed: ChatMessage[] = [
      STREAMED_USER("hi", "u-old"),
      STREAMED_AGENT("Hi! What can I help you with today?", "a-old"),
      STREAMED_USER("what time is it?", "u-new"),
      STREAMED_AGENT("It's Wed, May 27, 2026, 2:34 PM.", "a-new"),
    ];
    const db: ChatMessage[] = [
      DB_USER("what time is it?", 30),
      DB_TOOL_CALL("call-time", "terminal", '{"command":"date"}', 31),
      DB_TOOL_RESULT("call-time", "terminal", "Wed, May 27, 2026 2:34 PM", 32),
      DB_AGENT("It's Wed, May 27, 2026, 2:34 PM.", 33),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-old",
      "a-old",
      "u-new",
      "db-tc-31-call-time",
      "db-tr-32",
      "a-new",
    ]);
  });

  it("matches a streamed image user bubble to the DB screenshot placeholder", () => {
    const streamed: ChatMessage[] = [
      STREAMED_IMAGE_USER("describe this image", "u-img"),
      STREAMED_AGENT("It is a simple cartoon image.", "a-img"),
    ];
    const db: ChatMessage[] = [
      DB_USER("describe this image\n[screenshot]", 40),
      DB_AGENT("It is a simple cartoon image.", 41),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe("u-img");
    expect(merged[0]).toMatchObject({
      role: "user",
      content: "describe this image",
    });
    expect(
      ("attachments" in merged[0] && merged[0].attachments) || [],
    ).toHaveLength(1);
    expect(merged[1].id).toBe("a-img");
  });

  it("does not append an old streamed image turn after later DB-only rows", () => {
    const streamed: ChatMessage[] = [
      STREAMED_IMAGE_USER("describe this image", "u-img"),
      STREAMED_AGENT("It is a simple cartoon image.", "a-img"),
      STREAMED_USER("what time is it", "u-time"),
      STREAMED_AGENT("It's Wed, May 27, 2026, 3:51 PM.", "a-time"),
    ];
    const db: ChatMessage[] = [
      DB_USER("describe this image\n[screenshot]", 50),
      DB_AGENT("It is a simple cartoon image.", 51),
      DB_USER("what time is it", 52),
      DB_TOOL_CALL("call-time", "terminal", '{"command":"date"}', 53),
      DB_TOOL_RESULT("call-time", "terminal", "Wed, May 27, 2026 3:51 PM", 54),
      DB_AGENT("It's Wed, May 27, 2026, 3:51 PM.", 55),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-img",
      "a-img",
      "u-time",
      "db-tc-53-call-time",
      "db-tr-54",
      "a-time",
    ]);
    expect(merged.filter((m) => m.id === "u-img")).toHaveLength(1);
    expect(
      ("attachments" in merged[0] && merged[0].attachments) || [],
    ).toHaveLength(1);
  });
});
