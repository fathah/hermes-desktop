import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatgptAdapter, parseChatGptExport } from "./chatgpt";

/** Build a branched ChatGPT conversation: u1 → [abandoned a2a | chosen a2b] →
 *  u3 → a4, with current_node on the CHOSEN leaf (a4). */
function branchedConversation(): Record<string, unknown> {
  return {
    title: "Arithmetic",
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
    conversation_id: "conv-branched",
    current_node: "a4",
    mapping: {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          author: { role: "user" },
          create_time: 1_700_000_001,
          content: { content_type: "text", parts: ["What is 2+2?"] },
        },
        parent: "root",
        children: ["a2a", "a2b"],
      },
      a2a: {
        id: "a2a",
        message: {
          author: { role: "assistant" },
          create_time: 1_700_000_002,
          content: { content_type: "text", parts: ["It is 5."] },
        },
        parent: "u1",
        children: [],
      },
      a2b: {
        id: "a2b",
        message: {
          author: { role: "assistant" },
          create_time: 1_700_000_003,
          content: { content_type: "text", parts: ["It is 4."] },
        },
        parent: "u1",
        children: ["u3"],
      },
      u3: {
        id: "u3",
        message: {
          author: { role: "user" },
          create_time: 1_700_000_004,
          content: { content_type: "text", parts: ["Thanks"] },
        },
        parent: "a2b",
        children: ["a4"],
      },
      a4: {
        id: "a4",
        message: {
          author: { role: "assistant" },
          create_time: 1_700_000_005,
          content: { content_type: "text", parts: ["You're welcome"] },
        },
        parent: "u3",
        children: [],
      },
    },
  };
}

describe("parseChatGptExport — canonical branch", () => {
  it("follows current_node's branch and drops the abandoned one", () => {
    const r = parseChatGptExport([branchedConversation()]);
    expect(r.conversations).toHaveLength(1);
    const texts = r.messages.map((m) => m.text);
    expect(texts).toEqual([
      "What is 2+2?",
      "It is 4.",
      "Thanks",
      "You're welcome",
    ]);
    // The abandoned regenerate must NOT appear.
    expect(texts.join(" ")).not.toContain("It is 5.");
    // seq is a dense per-conversation ordinal.
    expect(r.messages.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  });

  it("converts create_time seconds → epoch ms and derives span", () => {
    const r = parseChatGptExport([branchedConversation()]);
    expect(r.messages[0].ts).toBe(1_700_000_001_000);
    expect(r.conversations[0].startedAt).toBe(1_700_000_000_000);
    expect(r.conversations[0].lastAt).toBe(1_700_000_100_000);
    expect(r.conversations[0].title).toBe("Arithmetic");
  });
});

describe("parseChatGptExport — node filtering", () => {
  it("drops system and tool nodes, keeps user/assistant", () => {
    const conv = {
      conversation_id: "c-sys",
      current_node: "a",
      mapping: {
        sys: {
          id: "sys",
          message: {
            author: { role: "system" },
            content: { content_type: "text", parts: ["you are helpful"] },
          },
          parent: null,
          children: ["u"],
        },
        u: {
          id: "u",
          message: {
            author: { role: "user" },
            content: { content_type: "text", parts: ["hi"] },
          },
          parent: "sys",
          children: ["tool"],
        },
        tool: {
          id: "tool",
          message: {
            author: { role: "tool" },
            content: { content_type: "text", parts: ["search results…"] },
          },
          parent: "u",
          children: ["a"],
        },
        a: {
          id: "a",
          message: {
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["hello!"] },
          },
          parent: "tool",
          children: [],
        },
      },
    };
    const r = parseChatGptExport([conv]);
    expect(r.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      "user:hi",
      "assistant:hello!",
    ]);
  });

  it("keeps string parts of multimodal content, drops image objects", () => {
    const conv = {
      conversation_id: "c-mm",
      current_node: "u",
      mapping: {
        u: {
          id: "u",
          message: {
            author: { role: "user" },
            content: {
              content_type: "multimodal_text",
              parts: [
                { content_type: "image_asset_pointer", asset_pointer: "x" },
                "describe this image",
              ],
            },
          },
          parent: null,
          children: [],
        },
      },
    };
    const r = parseChatGptExport([conv]);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].text).toBe("describe this image");
  });
});

describe("parseChatGptExport — tolerance", () => {
  it("counts unparseable conversations instead of throwing", () => {
    const r = parseChatGptExport([
      branchedConversation(),
      { title: "no mapping here" },
      42,
      null,
      { conversation_id: "empty", mapping: {} },
    ]);
    expect(r.conversations).toHaveLength(1);
    expect(r.skipped).toBe(4);
  });

  it("returns empty (no throw) for a non-array / unknown top-level shape", () => {
    expect(parseChatGptExport("garbage")).toEqual({
      conversations: [],
      messages: [],
      skipped: 0,
    });
    expect(parseChatGptExport({ unexpected: true }).conversations).toEqual([]);
  });

  it("accepts a { conversations: [...] } wrapper variant", () => {
    const r = parseChatGptExport({ conversations: [branchedConversation()] });
    expect(r.conversations).toHaveLength(1);
  });

  it("falls back to time-sorted nodes when current_node is missing", () => {
    const conv = branchedConversation() as Record<string, unknown>;
    delete conv.current_node;
    const r = parseChatGptExport([conv]);
    // Without a selected branch it can't disambiguate the fork, but it must not
    // throw and must surface a non-empty, time-ordered transcript.
    expect(r.conversations).toHaveLength(1);
    expect(r.messages[0].text).toBe("What is 2+2?");
  });
});

describe("chatgptAdapter — through the import root", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ec-chatgpt-"));
    process.env.HERMES_EC_IMPORT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.HERMES_EC_IMPORT_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers staged .json exports and parses them whole (replace)", async () => {
    const dir = join(root, "chatgpt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "deadbeef.json"),
      JSON.stringify([branchedConversation()]),
    );

    expect(chatgptAdapter.available()).toBe(true);
    const files = await chatgptAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    expect(files[0].strategy).toBe("replace");

    const result = await chatgptAdapter.parseSlice(files[0], 0);
    expect(result.conversation).toBeNull();
    expect(result.conversations).toHaveLength(1);
    expect(result.messages.map((m) => m.text)).toContain("It is 4.");
    expect(result.bytesConsumed).toBe(files[0].size);
  });
});
