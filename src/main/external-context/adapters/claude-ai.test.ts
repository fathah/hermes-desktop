import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeAiAdapter, parseClaudeAiExport } from "./claude-ai";

function conversation(uuid: string, name: string): Record<string, unknown> {
  return {
    uuid,
    name,
    created_at: "2026-01-02T03:04:05.000000Z",
    updated_at: "2026-01-02T03:09:05.000000Z",
    chat_messages: [
      {
        sender: "human",
        created_at: "2026-01-02T03:04:05.000000Z",
        content: [{ type: "text", text: "what is the capital of France?" }],
      },
      {
        sender: "assistant",
        created_at: "2026-01-02T03:04:08.000000Z",
        content: [{ type: "text", text: "Paris." }],
      },
    ],
  };
}

describe("parseClaudeAiExport", () => {
  it("walks chat_messages linearly, mapping human→user", () => {
    const r = parseClaudeAiExport([conversation("c1", "Geography")]);
    expect(r.conversations).toHaveLength(1);
    expect(r.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      "user:what is the capital of France?",
      "assistant:Paris.",
    ]);
    expect(r.messages.map((m) => m.seq)).toEqual([0, 1]);
    expect(r.conversations[0].title).toBe("Geography");
    expect(r.conversations[0].conversationId).toBe("c1");
  });

  it("converts ISO created_at/updated_at to epoch ms", () => {
    const r = parseClaudeAiExport([conversation("c1", "Geography")]);
    expect(r.conversations[0].startedAt).toBe(
      Date.parse("2026-01-02T03:04:05Z"),
    );
    expect(r.conversations[0].lastAt).toBe(Date.parse("2026-01-02T03:09:05Z"));
    expect(r.messages[0].ts).toBe(Date.parse("2026-01-02T03:04:05Z"));
  });

  it("indexes every conversation in a multi-conversation export", () => {
    const r = parseClaudeAiExport([
      conversation("a", "First"),
      conversation("b", "Second"),
    ]);
    expect(r.conversations.map((c) => c.conversationId)).toEqual(["a", "b"]);
    expect(r.messages).toHaveLength(4);
  });

  it("falls back to the flattened `text` field when content is absent", () => {
    const r = parseClaudeAiExport([
      {
        uuid: "legacy",
        name: "Legacy",
        chat_messages: [{ sender: "human", text: "flattened question" }],
      },
    ]);
    expect(r.messages[0].text).toBe("flattened question");
  });

  it("derives a title from the first user message when name is missing", () => {
    const r = parseClaudeAiExport([
      {
        uuid: "noname",
        chat_messages: [
          { sender: "human", content: [{ type: "text", text: "hello there" }] },
        ],
      },
    ]);
    expect(r.conversations[0].title).toBe("hello there");
  });

  it("counts unparseable conversations instead of throwing", () => {
    const r = parseClaudeAiExport([
      conversation("ok", "Good"),
      { name: "no messages array" },
      { uuid: "empty", chat_messages: [] },
      null,
      7,
    ]);
    expect(r.conversations).toHaveLength(1);
    expect(r.skipped).toBe(4);
  });

  it("returns empty for an unknown top-level shape (no throw)", () => {
    expect(parseClaudeAiExport("nope")).toEqual({
      conversations: [],
      messages: [],
      skipped: 0,
    });
  });
});

describe("claudeAiAdapter — through the import root", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ec-claudeai-"));
    process.env.HERMES_EC_IMPORT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.HERMES_EC_IMPORT_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers staged conversations.json and parses it whole", async () => {
    const dir = join(root, "claude-ai");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "abc123.json"),
      JSON.stringify([conversation("c1", "Geography")]),
    );

    expect(claudeAiAdapter.available()).toBe(true);
    const files = await claudeAiAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    expect(files[0].strategy).toBe("replace");

    const result = await claudeAiAdapter.parseSlice(files[0], 0);
    expect(result.conversation).toBeNull();
    expect(result.conversations).toHaveLength(1);
    expect(result.messages.map((m) => m.text)).toContain("Paris.");
  });
});
