import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";
import { grokAdapter } from "./grok";
import type { SourceAdapter, ParsedMessage } from "./types";

const FIX = path.resolve(
  __dirname,
  "../../../../tests/fixtures/external-context",
);

beforeAll(() => {
  process.env.HERMES_EC_CLAUDE_ROOT = path.join(FIX, "claude-code");
  process.env.HERMES_EC_CODEX_ROOT = path.join(FIX, "codex");
  process.env.HERMES_EC_GEMINI_ROOT = path.join(FIX, "gemini");
  process.env.HERMES_EC_GROK_ROOT = path.join(FIX, "grok");
});

async function parseAll(adapter: SourceAdapter): Promise<{
  messages: ParsedMessage[];
  conversations: number;
  projects: Set<string | null>;
}> {
  const files = await adapter.discoverFiles();
  const messages: ParsedMessage[] = [];
  const projects = new Set<string | null>();
  let conversations = 0;
  for (const file of files) {
    const result = await adapter.parseSlice(file, 0);
    if (result.conversation) {
      conversations += 1;
      projects.add(result.conversation.projectPath);
    }
    messages.push(...result.messages);
  }
  return { messages, conversations, projects };
}

describe("claudeCodeAdapter", () => {
  it("is available against the fixture root", () => {
    expect(claudeCodeAdapter.available()).toBe(true);
  });

  it("parses user + assistant text, dropping thinking/tool_use/queue lines", async () => {
    const { messages, conversations } = await parseAll(claudeCodeAdapter);
    expect(conversations).toBe(1);
    expect(messages).toHaveLength(2);
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
    expect(messages[1].text).toContain("worker pool");
    // thinking content must NOT be indexed
    expect(messages.some((m) => m.text.includes("internal reasoning"))).toBe(
      false,
    );
  });

  it("captures cwd + gitBranch as conversation metadata", async () => {
    const files = await claudeCodeAdapter.discoverFiles();
    const result = await claudeCodeAdapter.parseSlice(files[0], 0);
    expect(result.conversation?.projectPath).toBe("/Users/test/proj");
    expect(result.conversation?.gitBranch).toBe("main");
    expect(result.conversation?.conversationId).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });
});

describe("codexAdapter", () => {
  it("parses BOTH new (event_msg) and old (bare message) formats", async () => {
    const { messages, conversations, projects } = await parseAll(codexAdapter);
    expect(conversations).toBe(2);
    // new format: 1 user + 1 assistant; old format: 1 user + 1 assistant
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(2);
    expect(messages.some((m) => m.text.includes("affine and appflowy"))).toBe(
      true,
    );
    expect(messages.some((m) => m.text.includes("split auth"))).toBe(true);
    expect(projects.has("/Users/test/codexproj")).toBe(true);
  });

  it("drops reasoning/function_call noise", async () => {
    const { messages } = await parseAll(codexAdapter);
    expect(messages.some((m) => m.text.includes("opaque"))).toBe(false);
  });
});

describe("geminiAdapter", () => {
  it("maps projectHash → real path via .project_root", async () => {
    const files = await geminiAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    const result = await geminiAdapter.parseSlice(files[0], 0);
    expect(result.conversation?.projectPath).toBe("/tmp/test-project");
    expect(result.conversation?.title).toBe(
      "Save to Knowledge Base via Mac helper",
    );
    expect(files[0].strategy).toBe("replace");
  });

  it("normalises gemini role to assistant", async () => {
    const { messages } = await parseAll(geminiAdapter);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("grokAdapter", () => {
  it("derives project path from the url-encoded directory", async () => {
    const files = await grokAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    const result = await grokAdapter.parseSlice(files[0], 0);
    expect(result.conversation?.projectPath).toBe("/tmp/test-proj");
    expect(result.conversation?.conversationId).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("indexes user (block) + assistant (string), dropping system/reasoning/tool_result", async () => {
    const { messages } = await parseAll(grokAdapter);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages.some((m) => m.text.includes("continuity layer"))).toBe(
      true,
    );
    expect(messages.some((m) => m.text.includes("to drop"))).toBe(false);
  });
});

describe("append cursor (parseSlice fromOffset)", () => {
  it("re-parses only the tail when given a non-zero offset", async () => {
    const files = await grokAdapter.discoverFiles();
    const whole = await grokAdapter.parseSlice(files[0], 0);
    // Offset past the first two lines should yield fewer messages.
    const tail = await grokAdapter.parseSlice(files[0], files[0].size);
    expect(tail.messages.length).toBeLessThan(whole.messages.length);
  });
});
