import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pasteAdapter } from "./paste";

/** The staged envelope shape the paste IPC writes: raw text + tool of origin. */
function envelope(text: string, origin = "Perplexity"): string {
  return JSON.stringify({ origin, text });
}

describe("pasteAdapter — through the import root", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ec-paste-"));
    process.env.HERMES_EC_IMPORT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.HERMES_EC_IMPORT_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  function stage(name: string, body: string): void {
    const dir = join(root, "paste");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), body);
  }

  it("discovers a staged envelope and parses it as one conversation", async () => {
    stage(
      "cafef00d.json",
      envelope("You\nWhat is a monad?\nPerplexity\nA monad is a monoid…"),
    );

    expect(pasteAdapter.available()).toBe(true);
    const files = await pasteAdapter.discoverFiles();
    expect(files).toHaveLength(1);
    expect(files[0].source).toBe("paste");
    expect(files[0].strategy).toBe("replace");

    const result = await pasteAdapter.parseSlice(files[0], 0);
    // Multi-conversation contract: one envelope ≈ one conversation.
    expect(result.conversation).toBeNull();
    expect(result.conversations).toHaveLength(1);
    expect(result.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      "user:What is a monad?",
      "assistant:A monad is a monoid…",
    ]);
    // The origin is carried as the conversation's projectPath (provenance).
    expect(result.conversations?.[0].projectPath).toBe("Perplexity");
    // bytesConsumed == file size so the cursor advances to EOF (whole-file).
    expect(result.bytesConsumed).toBe(files[0].size);
  });

  it("stamps the staged file's mtime as the message timestamp", async () => {
    stage("beefcafe.json", envelope("You\nhi\nChatGPT\nhello"));
    const [file] = await pasteAdapter.discoverFiles();
    const result = await pasteAdapter.parseSlice(file, 0);
    // ts is the floored staged-file mtime (capture time), not null.
    expect(result.messages[0].ts).toBe(Math.floor(file.mtimeMs));
  });

  it("yields an empty result for an envelope with no usable text", async () => {
    stage("empty.json", JSON.stringify({ origin: "Perplexity", text: "   " }));
    const [file] = await pasteAdapter.discoverFiles();
    const result = await pasteAdapter.parseSlice(file, 0);
    expect(result.conversations).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(result.bytesConsumed).toBe(file.size);
  });

  it("tolerates a malformed (non-JSON) staged file without throwing", async () => {
    stage("junk.json", "this is not json at all");
    const [file] = await pasteAdapter.discoverFiles();
    const result = await pasteAdapter.parseSlice(file, 0);
    expect(result.messages).toEqual([]);
  });

  it("reports unavailable when the paste import root does not exist", () => {
    // Point the env at a fresh dir with no `paste/` subfolder.
    process.env.HERMES_EC_IMPORT_ROOT = join(root, "does-not-exist");
    expect(pasteAdapter.available()).toBe(false);
  });
});
