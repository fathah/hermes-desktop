import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grokExportAdapter, parseGrokExport } from "./grok-export";

/** A Grok session in the `{type, content}` JSONL shape (user content = text
 *  blocks, assistant content = string), with an interleaved tool line to drop. */
function sessionJsonl(): string {
  return [
    JSON.stringify({ type: "system", content: "be helpful" }),
    JSON.stringify({
      type: "user",
      content: [{ type: "text", text: "summarise the plan" }],
    }),
    JSON.stringify({ type: "tool_result", content: "irrelevant tool output" }),
    JSON.stringify({ type: "assistant", content: "Here is the summary." }),
    "", // blank line tolerated
    "not json at all", // junk tolerated
  ].join("\n");
}

describe("parseGrokExport", () => {
  it("keeps user/assistant turns, drops system/tool/junk lines", () => {
    const r = parseGrokExport(sessionJsonl(), "session-1", 1_700_000_000_000);
    expect(r.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      "user:summarise the plan",
      "assistant:Here is the summary.",
    ]);
    expect(r.messages.map((m) => m.seq)).toEqual([0, 1]);
    expect(r.conversation?.conversationId).toBe("session-1");
    expect(r.conversation?.title).toBe("summarise the plan");
    expect(r.conversation?.lastAt).toBe(1_700_000_000_000);
  });

  it("returns no conversation when nothing usable is present", () => {
    const r = parseGrokExport('{"type":"system","content":"x"}\n', "empty", 0);
    expect(r.conversation).toBeNull();
    expect(r.messages).toEqual([]);
  });

  it("reads a per-message timestamp when the line carries one", () => {
    const text = JSON.stringify({
      type: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: "2026-03-04T05:06:07.000Z",
    });
    const r = parseGrokExport(text, "ts", 0);
    expect(r.messages[0].ts).toBe(Date.parse("2026-03-04T05:06:07Z"));
  });
});

describe("grokExportAdapter — through the import root", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ec-grokx-"));
    process.env.HERMES_EC_IMPORT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.HERMES_EC_IMPORT_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers staged .jsonl sessions and parses one file as one conversation", async () => {
    const dir = join(root, "grok-export");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "feedface.jsonl"), sessionJsonl());

    expect(grokExportAdapter.available()).toBe(true);
    const files = await grokExportAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    expect(files[0].strategy).toBe("replace");

    const result = await grokExportAdapter.parseSlice(files[0], 0);
    expect(result.conversation?.conversationId).toBe("feedface");
    expect(result.messages.map((m) => m.text)).toEqual([
      "summarise the plan",
      "Here is the summary.",
    ]);
  });
});
