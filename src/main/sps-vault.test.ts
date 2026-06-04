// sps-vault.test.ts — S2b: the additive markdown mirror (pure fs/path).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  exportPageMarkdownTo,
  readPageMarkdownFrom,
  isValidPageId,
  pageFilename,
} from "./sps-vault";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sps-vault-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("page id validation", () => {
  it("accepts internal ids", () => {
    expect(isValidPageId("home")).toBe(true);
    expect(isValidPageId("bx9f12")).toBe(true);
    expect(isValidPageId("page_1-2")).toBe(true);
  });
  it("rejects path-traversal and separators", () => {
    expect(isValidPageId("../etc/passwd")).toBe(false);
    expect(isValidPageId("a/b")).toBe(false);
    expect(isValidPageId("a.md")).toBe(false);
    expect(isValidPageId("")).toBe(false);
  });
});

describe("exportPageMarkdownTo / readPageMarkdownFrom", () => {
  it("writes a page file and reads it back verbatim", async () => {
    const md = '---\ntitle: "X"\n---\n\n# Hi\n\nbody';
    expect(await exportPageMarkdownTo(dir, "home", md)).toBe(true);
    expect(existsSync(join(dir, pageFilename("home")))).toBe(true);
    expect(await readFile(join(dir, "home.md"), "utf-8")).toBe(md);
    expect(await readPageMarkdownFrom(dir, "home")).toBe(md);
  });

  it("creates the vault directory if missing", async () => {
    const nested = join(dir, "sps-agent", "vault");
    expect(await exportPageMarkdownTo(nested, "p1", "x")).toBe(true);
    expect(existsSync(join(nested, "p1.md"))).toBe(true);
  });

  it("refuses to write a page with a hostile id (no file escapes the vault)", async () => {
    expect(await exportPageMarkdownTo(dir, "../escape", "pwned")).toBe(false);
    const entries = await readdir(dir);
    expect(entries).toEqual([]);
  });

  it("returns null when reading a missing or invalid page", async () => {
    expect(await readPageMarkdownFrom(dir, "nope")).toBeNull();
    expect(await readPageMarkdownFrom(dir, "../x")).toBeNull();
  });
});
