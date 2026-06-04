// sps-vault.test.ts — S2b: the additive markdown mirror (pure fs/path).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile } from "fs/promises";
import {
  exportPageMarkdownTo,
  readPageMarkdownFrom,
  deletePageIn,
  isValidPageId,
  pageFilename,
  exportRowMarkdownTo,
  deleteRowIn,
  listRowIdsIn,
  readVaultPages,
  readVaultManifest,
  writeVaultManifest,
  backupFile,
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

describe("deletePageIn (F3 orphan cleanup)", () => {
  it("deletes an existing page file and reports success", async () => {
    await exportPageMarkdownTo(dir, "gone", "# Gone");
    expect(existsSync(join(dir, "gone.md"))).toBe(true);
    expect(await deletePageIn(dir, "gone")).toBe(true);
    expect(existsSync(join(dir, "gone.md"))).toBe(false);
  });

  it("returns false for a missing file (best-effort, no throw)", async () => {
    expect(await deletePageIn(dir, "never")).toBe(false);
  });

  it("refuses a hostile id and removes nothing outside the vault", async () => {
    await exportPageMarkdownTo(dir, "keep", "# Keep");
    expect(await deletePageIn(dir, "../keep")).toBe(false);
    expect(await deletePageIn(dir, "a/b")).toBe(false);
    expect(await deletePageIn(dir, "")).toBe(false);
    expect(existsSync(join(dir, "keep.md"))).toBe(true);
  });
});

describe("database rows (S4)", () => {
  it("writes, lists, and deletes row files in a database folder", async () => {
    expect(await exportRowMarkdownTo(dir, "db1", "r1", "a")).toBe(true);
    expect(await exportRowMarkdownTo(dir, "db1", "r2", "b")).toBe(true);
    expect(existsSync(join(dir, "db1", "r1.md"))).toBe(true);
    expect((await listRowIdsIn(dir, "db1")).sort()).toEqual(["r1", "r2"]);

    expect(await deleteRowIn(dir, "db1", "r1")).toBe(true);
    expect((await listRowIdsIn(dir, "db1")).sort()).toEqual(["r2"]);
  });

  it("rejects hostile folder or row segments (no escape)", async () => {
    expect(await exportRowMarkdownTo(dir, "../evil", "r", "x")).toBe(false);
    expect(await exportRowMarkdownTo(dir, "db", "../r", "x")).toBe(false);
    expect(await exportRowMarkdownTo(dir, "a/b", "r", "x")).toBe(false);
    expect(await deleteRowIn(dir, "../evil", "r")).toBe(false);
    const entries = await readdir(dir);
    expect(entries).toEqual([]);
  });

  it("lists nothing for a missing folder or bad segment", async () => {
    expect(await listRowIdsIn(dir, "missing")).toEqual([]);
    expect(await listRowIdsIn(dir, "../x")).toEqual([]);
  });
});

describe("vault-as-authoritative I/O (S6)", () => {
  it("reads root page files only (not db-row subfolders or the manifest)", async () => {
    await exportPageMarkdownTo(dir, "home", "# Home");
    await exportPageMarkdownTo(dir, "sub", "# Sub");
    await exportRowMarkdownTo(dir, "db1", "r1", "row"); // subfolder
    await writeVaultManifest(dir, "{}"); // _manifest.json
    const pages = await readVaultPages(dir);
    expect(Object.keys(pages).sort()).toEqual(["home", "sub"]);
    expect(pages.home).toBe("# Home");
  });

  it("round-trips the structure manifest", async () => {
    expect(await readVaultManifest(dir)).toBeNull();
    expect(await writeVaultManifest(dir, '{"page":"home"}')).toBe(true);
    expect(await readVaultManifest(dir)).toBe('{"page":"home"}');
  });

  it("backs up a file to a timestamped sibling", async () => {
    const f = join(dir, "workspace.json");
    await writeFile(f, "BLOB", "utf-8");
    const backup = await backupFile(f, 12345);
    expect(backup).toBe(`${f}.bak-12345`);
    expect(await readPageMarkdownFromRaw(backup!)).toBe("BLOB");
  });

  it("returns null when backing up a missing file", async () => {
    expect(await backupFile(join(dir, "nope.json"), 1)).toBeNull();
  });
});

// small helper: read any file as utf-8 (backup isn't a page)
async function readPageMarkdownFromRaw(path: string): Promise<string> {
  const { readFile } = await import("fs/promises");
  return readFile(path, "utf-8");
}
