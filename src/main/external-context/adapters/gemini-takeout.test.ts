import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  geminiTakeoutAdapter,
  parseGeminiTakeout,
  SESSION_GAP_MS,
} from "./gemini-takeout";

function record(title: string, iso: string): Record<string, unknown> {
  return {
    header: "Gemini Apps",
    title,
    time: iso,
    products: ["Gemini Apps"],
  };
}

describe("parseGeminiTakeout — session grouping", () => {
  it("splits records into pseudo-conversations on a > 30 min gap", () => {
    const base = Date.parse("2026-05-01T10:00:00Z");
    const within = new Date(base + 10 * 60 * 1000).toISOString(); // +10 min
    const afterGap = new Date(base + 60 * 60 * 1000).toISOString(); // +60 min
    const r = parseGeminiTakeout([
      record("Prompted first question", new Date(base).toISOString()),
      record("second question", within),
      record("third after a long break", afterGap),
    ]);
    expect(r.conversations).toHaveLength(2);
    // Conversation 1: the two within-30-min prompts.
    expect(r.conversations[0].title).toBe("first question"); // "Prompted " stripped
    const c1 = r.messages.filter(
      (m) => m.conversationId === r.conversations[0].conversationId,
    );
    expect(c1.map((m) => m.text)).toEqual([
      "first question",
      "second question",
    ]);
    expect(c1.every((m) => m.role === "user")).toBe(true);
    // Conversation 2: the post-gap prompt.
    const c2 = r.messages.filter(
      (m) => m.conversationId === r.conversations[1].conversationId,
    );
    expect(c2.map((m) => m.text)).toEqual(["third after a long break"]);
  });

  it("sorts out-of-order records by time before grouping", () => {
    const t0 = "2026-05-01T10:00:00Z";
    const t1 = "2026-05-01T10:05:00Z";
    const r = parseGeminiTakeout([record("later", t1), record("earlier", t0)]);
    expect(r.conversations).toHaveLength(1);
    expect(r.messages.map((m) => m.text)).toEqual(["earlier", "later"]);
    expect(r.messages[0].ts).toBe(Date.parse(t0));
  });

  it("derives a stable conversationId + span from the session bounds", () => {
    const base = Date.parse("2026-05-01T10:00:00Z");
    const r = parseGeminiTakeout([
      record("a", new Date(base).toISOString()),
      record("b", new Date(base + 5 * 60 * 1000).toISOString()),
    ]);
    expect(r.conversations[0].conversationId).toBe(`gemini-takeout-${base}`);
    expect(r.conversations[0].startedAt).toBe(base);
    expect(r.conversations[0].lastAt).toBe(base + 5 * 60 * 1000);
  });

  it("counts records missing a title or a parseable time as skipped", () => {
    const r = parseGeminiTakeout([
      record("good one", "2026-05-01T10:00:00Z"),
      { header: "Gemini Apps", time: "2026-05-01T10:01:00Z" }, // no title
      { header: "Gemini Apps", title: "no time here" }, // no time
      null,
      "junk",
    ]);
    expect(r.conversations).toHaveLength(1);
    expect(r.skipped).toBe(4);
  });

  it("returns empty (no throw) for a non-array payload", () => {
    expect(parseGeminiTakeout({ not: "an array" })).toEqual({
      conversations: [],
      messages: [],
      skipped: 0,
    });
  });

  it("exposes a 30-minute session gap constant", () => {
    expect(SESSION_GAP_MS).toBe(30 * 60 * 1000);
  });
});

describe("geminiTakeoutAdapter — through the import root", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ec-takeout-"));
    process.env.HERMES_EC_IMPORT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.HERMES_EC_IMPORT_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers MyActivity.json and parses pseudo-conversations", async () => {
    const dir = join(root, "gemini-takeout");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "abcd1234.json"),
      JSON.stringify([
        record("Prompted hello", "2026-05-01T10:00:00Z"),
        record("a much later prompt", "2026-05-01T12:00:00Z"),
      ]),
    );

    expect(geminiTakeoutAdapter.available()).toBe(true);
    const files = await geminiTakeoutAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    expect(files[0].strategy).toBe("replace");

    const result = await geminiTakeoutAdapter.parseSlice(files[0], 0);
    expect(result.conversation).toBeNull();
    expect(result.conversations).toHaveLength(2); // 2h gap → two sessions
    expect(result.messages.map((m) => m.text)).toContain("hello");
  });
});
