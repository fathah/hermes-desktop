// @vitest-environment node
// adm-zip's deflate relies on node:zlib, which the default jsdom environment
// breaks (empty buffers); these are pure-node fs/zip tests anyway.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractImportPayload } from "./import-extract";

let work: string;
let tmp: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "ec-extract-src-"));
  tmp = mkdtempSync(join(tmpdir(), "ec-extract-tmp-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

describe("extractImportPayload", () => {
  it("returns a bare .jsonl unchanged (Grok session)", () => {
    const src = join(work, "session.jsonl");
    writeFileSync(src, '{"type":"user","content":"hi"}\n');
    const r = extractImportPayload("grok-export", src, tmp);
    expect(r.extracted).toBe(false);
    expect(r.payloadPath).toBe(src);
  });

  it("extracts conversations.json from a ChatGPT ZIP (nested path)", () => {
    const zip = new AdmZip();
    zip.addFile("user.json", Buffer.from('{"id":1}'));
    zip.addFile(
      "chatgpt-export/conversations.json",
      Buffer.from('[{"conversation_id":"x"}]'),
    );
    const zipPath = join(work, "export.zip");
    zip.writeZip(zipPath);

    const r = extractImportPayload("chatgpt", zipPath, tmp);
    expect(r.extracted).toBe(true);
    expect(r.payloadPath).toBe(join(tmp, "conversations.json"));
    expect(readFileSync(r.payloadPath, "utf8")).toBe(
      '[{"conversation_id":"x"}]',
    );
  });

  it("extracts MyActivity.json for Gemini Takeout", () => {
    const zip = new AdmZip();
    zip.addFile(
      "Takeout/My Activity/Gemini Apps/MyActivity.json",
      Buffer.from('[{"title":"hi","time":"2026-01-01T00:00:00Z"}]'),
    );
    const zipPath = join(work, "takeout.zip");
    zip.writeZip(zipPath);

    const r = extractImportPayload("gemini-takeout", zipPath, tmp);
    expect(r.extracted).toBe(true);
    expect(r.payloadPath).toBe(join(tmp, "MyActivity.json"));
  });

  it("sniffs ZIP magic bytes even without a .zip extension", () => {
    const zip = new AdmZip();
    zip.addFile("conversations.json", Buffer.from("[]"));
    const zipPath = join(work, "export.bin"); // wrong extension
    zip.writeZip(zipPath);

    const r = extractImportPayload("claude-ai", zipPath, tmp);
    expect(r.extracted).toBe(true);
    expect(r.payloadPath).toBe(join(tmp, "conversations.json"));
  });

  it("falls back to any .json entry when the named one is absent", () => {
    const zip = new AdmZip();
    zip.addFile("weird-name.json", Buffer.from("[]"));
    const zipPath = join(work, "export.zip");
    zip.writeZip(zipPath);

    const r = extractImportPayload("chatgpt", zipPath, tmp);
    expect(r.payloadPath).toBe(join(tmp, "weird-name.json"));
  });

  it("throws when the archive has no JSON payload", () => {
    const zip = new AdmZip();
    zip.addFile("readme.txt", Buffer.from("nothing here"));
    const zipPath = join(work, "empty.zip");
    zip.writeZip(zipPath);

    expect(() => extractImportPayload("chatgpt", zipPath, tmp)).toThrow(
      /no conversation export/,
    );
  });

  it("throws when the file does not exist", () => {
    expect(() =>
      extractImportPayload("chatgpt", join(work, "ghost.zip"), tmp),
    ).toThrow(/not found/);
  });
});
