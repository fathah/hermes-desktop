import { describe, it, expect } from "vitest";
import {
  reconcileAfterDbRefresh,
  reconcileStreamedWithDb,
} from "../src/renderer/src/screens/Chat/sessionHistory";
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

const STREAMED_TEXT_FILE_USER = (
  content: string,
  id = "u-file",
): ChatMessage => ({
  id,
  role: "user",
  content,
  attachments: [
    {
      id: "file-1",
      kind: "text-file",
      name: "notes.txt",
      mime: "text/plain",
      size: 12,
      text: "hello world\n",
    },
  ],
});

const DB_IMAGE_USER = (content: string, dbId = 10): ChatMessage => ({
  id: `db-${dbId}`,
  role: "user",
  content,
  attachments: [
    {
      id: `db-att-${dbId}-0`,
      kind: "image",
      name: "image.png",
      mime: "image/png",
      size: 46227,
      dataUrl: "data:image/png;base64,AAA=",
    },
  ],
});

const STREAMED_AGENT = (content: string, id = "a-1"): ChatMessage => ({
  id,
  role: "agent",
  content,
});

const LOCAL_ERROR = (
  error: string,
  id = "error-1",
  turnId?: string,
): ChatMessage => ({
  id,
  role: "agent",
  content: "",
  error,
  localOnly: true,
  ...(turnId ? { turnId } : {}),
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

const LIVE_TOOL_CALL = (
  callId: string,
  name: string,
  args: string,
  id = `tool-call-${callId}`,
): ChatMessage => ({
  id,
  kind: "tool_call",
  role: "agent",
  callId,
  name,
  args,
  status: "running",
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

  it("keeps a failed local turn anchored before a later successful DB turn", () => {
    const failedUser = STREAMED_USER("bad provider turn", "u-bad");
    const goodUser = STREAMED_USER("good provider turn", "u-good");
    const goodAnswer = STREAMED_AGENT("working response", "a-good");
    const streamed: ChatMessage[] = [
      failedUser,
      LOCAL_ERROR("OpenRouter 403", "error-bad"),
      goodUser,
      goodAnswer,
    ];
    const db: ChatMessage[] = [
      DB_USER("good provider turn", 1),
      DB_AGENT("working response", 2),
    ];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-bad",
      "error-bad",
      "u-good",
      "a-good",
    ]);
  });

  it("does not duplicate a local error already loaded from a desktop continuation", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("bad provider turn", "u-bad"),
      LOCAL_ERROR("OpenRouter 401", "error-bad"),
      STREAMED_USER("good provider turn", "u-good"),
      STREAMED_AGENT("working response", "a-good"),
    ];
    const db: ChatMessage[] = [
      DB_USER("bad provider turn", -10),
      {
        id: "db--11",
        role: "agent",
        content: "",
        error: "OpenRouter 401",
        localOnly: true,
      },
      DB_USER("good provider turn", 1),
      DB_AGENT("working response", 2),
    ];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "db--10",
      "db--11",
      "u-good",
      "a-good",
    ]);
    expect(merged.filter((m) => "error" in m && m.error)).toHaveLength(1);
  });

  it("preserves a local assistant error when the DB only has the failed user row", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("bad provider turn", "u-bad"),
      LOCAL_ERROR("OpenRouter 403", "error-bad"),
    ];
    const db: ChatMessage[] = [DB_USER("bad provider turn", 1)];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual(["db-1", "error-bad"]);
  });

  it("does not let a failed repeated prompt steal the later successful DB turn", () => {
    const streamed: ChatMessage[] = [
      { ...STREAMED_USER("hi", "u-failed"), turnId: "turn-failed" },
      LOCAL_ERROR("OpenRouter 403", "error-failed", "turn-failed"),
      { ...STREAMED_USER("hi", "u-good"), turnId: "turn-good" },
      { ...STREAMED_AGENT("hello", "a-good"), turnId: "turn-good" },
    ];
    const db: ChatMessage[] = [DB_USER("hi", 1), DB_AGENT("hello", 2)];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-failed",
      "error-failed",
      "u-good",
      "a-good",
    ]);
  });

  it("preserves DB-only reasoning, tools, and artifacts after a prior local failure", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("use the bad provider", "u-failed"),
      LOCAL_ERROR("OpenRouter 401: missing API key", "error-failed"),
      STREAMED_USER("now use the working provider", "u-good"),
      STREAMED_AGENT("The report is ready.", "a-good"),
    ];
    const dbToolResult: ChatMessage = {
      id: "db-tr-4",
      kind: "tool_result",
      role: "agent",
      callId: "call-report",
      name: "write_file",
      content: "wrote report.md",
      attachments: [
        {
          id: "artifact-report",
          kind: "file",
          name: "report.md",
          mime: "text/markdown",
          size: 42,
          path: "C:/tmp/report.md",
        },
      ],
    };
    const db: ChatMessage[] = [
      DB_USER("now use the working provider", 1),
      DB_REASONING("I should create a short report.", 2),
      DB_TOOL_CALL("call-report", "write_file", '{"path":"report.md"}', 3),
      dbToolResult,
      DB_AGENT("The report is ready.", 5),
    ];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-failed",
      "error-failed",
      "u-good",
      "db-r-2",
      "db-tc-3-call-report",
      "db-tr-4",
      "a-good",
    ]);
    expect(merged[5]).toMatchObject({
      kind: "tool_result",
      attachments: [{ id: "artifact-report", name: "report.md" }],
    });
  });

  it("anchors a DB-only recovery answer after the local recovery user when DB missed that user row", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("bad provider turn", "u-failed"),
      LOCAL_ERROR("OpenRouter 401: invalid API key", "error-failed"),
      { ...STREAMED_USER("recovery turn", "u-recovery"), turnId: "turn-good" },
    ];
    const db: ChatMessage[] = [
      DB_USER("bad provider turn", 1),
      DB_AGENT("Recovered successfully.", 2),
    ];

    const merged = reconcileAfterDbRefresh(streamed, db, {
      activeTurn: {
        turnId: "turn-good",
        userId: "u-recovery",
        startIndex: 2,
        status: "running",
      },
    });

    expect(merged.map((m) => m.id)).toEqual([
      "db-1",
      "error-failed",
      "u-recovery",
      "db-2",
    ]);
  });

  it("anchors a tool-heavy recovery turn when DB missed the active user row", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("hi", "u-failed"),
      LOCAL_ERROR("OpenRouter 401: invalid API key", "error-failed"),
      {
        ...STREAMED_USER("generate a toy duck", "u-duck"),
        turnId: "turn-duck",
      },
      LIVE_TOOL_CALL("call-skill", "skill_view", "ai-playground-image-gen"),
      LIVE_TOOL_CALL("call-run", "terminal", "python generate_duck.py"),
      STREAMED_AGENT("Generated it with AI Playground.", "a-duck"),
    ];
    const db: ChatMessage[] = [
      DB_USER("hi", 1),
      DB_TOOL_CALL("call-skill", "skill_view", "ai-playground-image-gen", 2),
      DB_TOOL_RESULT("call-skill", "skill_view", "skill loaded", 3),
      DB_TOOL_CALL("call-run", "terminal", "python generate_duck.py", 4),
      DB_TOOL_RESULT("call-run", "terminal", "saved=toy_duck.png", 5),
      DB_AGENT("Generated it with AI Playground.", 6),
    ];

    const merged = reconcileAfterDbRefresh(streamed, db, {
      activeTurn: {
        turnId: "turn-duck",
        userId: "u-duck",
        startIndex: 2,
        status: "running",
      },
    });

    expect(merged.map((m) => m.id)).toEqual([
      "db-1",
      "error-failed",
      "u-duck",
      "tool-call-call-skill",
      "db-tr-3",
      "tool-call-call-run",
      "db-tr-5",
      "a-duck",
    ]);
    expect(
      merged.filter((m) => "kind" in m && m.kind === "tool_call"),
    ).toHaveLength(2);
    expect(
      merged.filter((m) => "kind" in m && m.kind === "tool_result"),
    ).toHaveLength(2);
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
      merged.filter((m) => !("kind" in m) && m.content.includes(partB)),
    ).toHaveLength(1);
  });

  it("does not repeat long-chat tool-split turns during DB refresh", () => {
    const turn2A =
      "I checked the current directory before running the command.";
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
    const streamed: ChatMessage[] = [STREAMED_USER("hi", "u-1"), streamedOnly];
    const db: ChatMessage[] = [
      DB_USER("hi", 1),
      DB_AGENT("A different DB response.", 2),
      DB_AGENT("Another canonical row.", 3),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    // The unmatched streamed bubble should appear right after its
    // preceding user message (u-1), preserving the streamed order
    // rather than being forced to the bottom.
    expect(merged[1]).toBe(streamedOnly);
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

  it("drops synthetic live tool rows once matching canonical DB tool rows arrive", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("make an image", "u-1"),
      {
        id: "tool-call-live-tool:run-1:skill_view:1",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:run-1:skill_view:1",
        name: "skill_view",
        args: "ai-playground-image-gen",
      },
      {
        id: "tool-call-live-tool:run-1:execute_code:1",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:run-1:execute_code:1",
        name: "execute_code",
        args: "from hermes_tools import terminal",
      },
      STREAMED_AGENT("Done.", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("make an image", 60),
      DB_TOOL_CALL("call-skill", "skill_view", "ai-playground-image-gen", 61),
      DB_TOOL_RESULT("call-skill", "skill_view", "ok", 62),
      DB_TOOL_CALL(
        "call-code",
        "execute_code",
        "from hermes_tools import terminal",
        63,
      ),
      DB_TOOL_RESULT("call-code", "execute_code", "ok", 64),
      DB_AGENT("Done.", 65),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-1",
      "db-tc-61-call-skill",
      "db-tr-62",
      "db-tc-63-call-code",
      "db-tr-64",
      "a-1",
    ]);
  });

  it("matches legacy text-file DB wrappers to the optimistic attachment bubble", () => {
    const streamed: ChatMessage[] = [
      STREAMED_TEXT_FILE_USER("summarize the attachment", "u-file"),
      STREAMED_AGENT("done", "a-file"),
    ];
    const db: ChatMessage[] = [
      DB_USER(
        'summarize the attachment\n\n<file name="notes.txt" mime="text/plain">\nhello world\n</file>',
        570,
      ),
      DB_REASONING("The user attached a text file.", 571),
      DB_AGENT("done", 571),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual(["u-file", "db-r-571", "a-file"]);
    expect(
      "attachments" in merged[0] ? merged[0].attachments?.[0].kind : "",
    ).toBe("text-file");
    expect("content" in merged[0] ? merged[0].content : "").toBe(
      "summarize the attachment",
    );
  });

  it("does not drop extra repeated same-name synthetic tools when DB has fewer canonical rows", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("run checks", "u-1"),
      {
        id: "tool-call-live-tool:run-1:terminal:1",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:run-1:terminal:1",
        name: "terminal",
        args: "npm test",
      },
      {
        id: "tool-call-live-tool:run-1:terminal:2",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:run-1:terminal:2",
        name: "terminal",
        args: "npm run typecheck",
      },
      STREAMED_AGENT("Done.", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("run checks", 70),
      DB_TOOL_CALL("call-terminal-1", "terminal", "npm test", 71),
      DB_AGENT("Done.", 72),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-live-tool:run-1:terminal:2",
      "db-tc-71-call-terminal-1",
      "a-1",
    ]);
    expect(merged[1]).toMatchObject({
      kind: "tool_call",
      name: "terminal",
      args: "npm run typecheck",
    });
  });

  it("does not let exact canonical tool matches consume extra synthetic same-name rows", () => {
    const streamed: ChatMessage[] = [
      STREAMED_USER("run checks", "u-1"),
      {
        id: "tool-call-call-terminal-1",
        kind: "tool_call",
        role: "agent",
        callId: "call-terminal-1",
        name: "terminal",
        args: "npm test",
      },
      {
        id: "tool-call-live-tool:run-1:terminal:2",
        kind: "tool_call",
        role: "agent",
        callId: "live-tool:run-1:terminal:2",
        name: "terminal",
        args: "npm run typecheck",
      },
      STREAMED_AGENT("Done.", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("run checks", 80),
      DB_TOOL_CALL("call-terminal-1", "terminal", "npm test", 81),
      DB_AGENT("Done.", 82),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-call-terminal-1",
      "tool-call-live-tool:run-1:terminal:2",
      "a-1",
    ]);
  });

  it("keeps an inline clarify card at its streamed position after reconcile (regression: PR #604 review)", () => {
    // The clarify card is renderer-only — it never lands in state.db. During
    // streaming the user saw: user → clarify card → agent answer. The DB only
    // has the user + the post-answer agent content. Without repositioning, the
    // card (no reconciliationKey) gets flushed to the suffix and renders BELOW
    // the agent answer — the reverse of what the user saw.
    const CLARIFY = (id: string, requestId: string): ChatMessage => ({
      id,
      kind: "clarify",
      role: "agent",
      requestId,
      question: "Which environment?",
      choices: ["staging", "production"],
      resolved: true,
      answer: "production",
    });

    const streamed: ChatMessage[] = [
      STREAMED_USER("deploy it", "u-1"),
      CLARIFY("clarify-r1", "r1"),
      STREAMED_AGENT("Deploying to production.", "a-1"),
    ];
    const db: ChatMessage[] = [
      DB_USER("deploy it", 1),
      DB_AGENT("Deploying to production.", 2),
    ];

    const merged = reconcileStreamedWithDb(streamed, db);

    // Card stays between the user message and the agent answer.
    expect(merged.map((m) => m.id)).toEqual(["u-1", "clarify-r1", "a-1"]);
  });

  it("preserves a leading clarify card (no streamed predecessor)", () => {
    const CLARIFY = (id: string, requestId: string): ChatMessage => ({
      id,
      kind: "clarify",
      role: "agent",
      requestId,
      question: "Pick one",
      choices: ["a", "b"],
      resolved: true,
      answer: "a",
    });
    const streamed: ChatMessage[] = [
      CLARIFY("clarify-r1", "r1"),
      STREAMED_AGENT("done", "a-1"),
    ];
    const db: ChatMessage[] = [DB_AGENT("done", 2)];

    const merged = reconcileStreamedWithDb(streamed, db);

    expect(merged.map((m) => m.id)).toEqual(["clarify-r1", "a-1"]);
  });

  it("keeps a continued restored image prompt before its answer when the DB snapshot briefly misses that user row", () => {
    const answer =
      "It's a cute yellow toy duck in a bathtub filled with blue bathwater.";
    const streamed: ChatMessage[] = [
      DB_USER("generate an image of a toy duck", 1),
      DB_AGENT("Done - generated locally.", 2),
      STREAMED_IMAGE_USER("what is this?", "u-img"),
      STREAMED_AGENT(answer, "a-img"),
    ];
    const db: ChatMessage[] = [
      DB_USER("generate an image of a toy duck", 1),
      DB_AGENT("Done - generated locally.", 2),
      DB_AGENT(answer, 3),
    ];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual(["db-1", "db-2", "u-img", "a-img"]);
    expect(
      ("attachments" in merged[2] && merged[2].attachments) || [],
    ).toHaveLength(1);
  });

  it("drops orphan duplicate pasted-image prompts once the DB has the canonical user row", () => {
    const staleLocal1 = {
      ...STREAMED_IMAGE_USER("what is this?", "user-old-1"),
      attachments: [
        {
          id: "att-old-1",
          kind: "image" as const,
          name: "image.png",
          mime: "image/png",
          size: 46227,
          dataUrl: "data:image/png;base64,AAA=",
        },
      ],
    };
    const staleLocal2 = {
      ...STREAMED_IMAGE_USER("what is this?", "user-old-2"),
      attachments: [
        {
          id: "att-old-2",
          kind: "image" as const,
          name: "image.png",
          mime: "image/png",
          size: 46227,
          dataUrl: "data:image/png;base64,AAA=",
        },
      ],
    };
    const dbUser = DB_IMAGE_USER("what is this?\n[screenshot]", 444);
    const dbReasoning = DB_REASONING("The image shows a bath toy.", 445);
    const dbAnswer = DB_AGENT(
      "It looks like a cute yellow rubber duck bath toy.",
      446,
    );
    const streamed: ChatMessage[] = [
      staleLocal1,
      staleLocal2,
      dbUser,
      dbReasoning,
      dbAnswer,
    ];
    const db: ChatMessage[] = [dbUser, dbReasoning, dbAnswer];

    const merged = reconcileAfterDbRefresh(streamed, db);

    expect(merged.map((m) => m.id)).toEqual(["db-444", "db-r-445", "db-446"]);
  });

  it("does not anchor a pasted-image active user when the DB already has the canonical attachment row", () => {
    const localUser = {
      ...STREAMED_IMAGE_USER("what is this?", "user-active-image"),
      turnId: "turn-image",
      attachments: [
        {
          id: "att-local-image",
          kind: "image" as const,
          name: "toy_duck_bathtub.png",
          mime: "image/png",
          size: 269771,
          dataUrl: "data:image/png;base64,AAA=",
        },
      ],
    };
    const streamedAnswer = {
      ...STREAMED_AGENT(
        "It looks like a cute yellow duck in a bathtub.",
        "agent-image",
      ),
      turnId: "turn-image",
    };
    const dbUser = {
      ...DB_IMAGE_USER("what is this?\n[screenshot]", 450),
      attachments: [
        {
          id: "db-att-450-0",
          kind: "image" as const,
          name: "toy_duck_bathtub.png",
          mime: "image/png",
          size: 269771,
          dataUrl: "data:image/png;base64,AAA=",
        },
      ],
    };
    const dbAnswer = DB_AGENT(
      "It looks like a cute yellow duck in a bathtub.",
      451,
    );

    const merged = reconcileAfterDbRefresh(
      [localUser, streamedAnswer],
      [dbUser, dbAnswer],
      {
        activeTurn: {
          turnId: "turn-image",
          userId: "user-active-image",
          startIndex: 0,
          status: "running",
        },
      },
    );

    expect(merged.map((m) => m.id)).toEqual([
      "user-active-image",
      "agent-image",
    ]);
    expect(merged.filter((m) => m.id === "user-active-image")).toHaveLength(1);
  });
});
