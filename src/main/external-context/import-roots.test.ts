import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyExportToImportRoot,
  hashFileContent,
  importRootBase,
  importRootFor,
} from "./import-roots";

let home: string;
let srcDir: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ec-home-"));
  srcDir = mkdtempSync(join(tmpdir(), "ec-src-"));
  delete process.env.HERMES_EC_IMPORT_ROOT;
});

afterEach(() => {
  delete process.env.HERMES_EC_IMPORT_ROOT;
  rmSync(home, { recursive: true, force: true });
  rmSync(srcDir, { recursive: true, force: true });
});

describe("importRootFor", () => {
  it("places each source under <home>/external-imports/<source>", () => {
    expect(importRootBase(home)).toBe(join(home, "external-imports"));
    expect(importRootFor("chatgpt", home)).toBe(
      join(home, "external-imports", "chatgpt"),
    );
  });

  it("HERMES_EC_IMPORT_ROOT overrides the home-derived base", () => {
    const override = mkdtempSync(join(tmpdir(), "ec-override-"));
    process.env.HERMES_EC_IMPORT_ROOT = override;
    expect(importRootFor("gemini-takeout", home)).toBe(
      join(override, "gemini-takeout"),
    );
    rmSync(override, { recursive: true, force: true });
  });
});

describe("hashFileContent", () => {
  it("is stable for identical bytes and differs for different bytes", () => {
    const a = join(srcDir, "a.json");
    const b = join(srcDir, "b.json");
    writeFileSync(a, '{"x":1}');
    writeFileSync(b, '{"x":2}');
    expect(hashFileContent(a)).toBe(hashFileContent(a));
    expect(hashFileContent(a)).not.toBe(hashFileContent(b));
  });
});

describe("copyExportToImportRoot", () => {
  it("stages the export under a content-hash name, preserving extension", () => {
    const src = join(srcDir, "conversations.json");
    writeFileSync(src, '{"hello":"world"}');

    const result = copyExportToImportRoot("chatgpt", src, home);

    expect(result.reused).toBe(false);
    expect(result.destPath).toBe(
      join(home, "external-imports", "chatgpt", `${result.hash}.json`),
    );
    expect(existsSync(result.destPath)).toBe(true);
    expect(readFileSync(result.destPath, "utf8")).toBe('{"hello":"world"}');
  });

  it("is idempotent: re-importing identical bytes is a no-op (reused)", () => {
    const src = join(srcDir, "export.json");
    writeFileSync(src, '{"same":true}');

    const first = copyExportToImportRoot("claude-ai", src, home);
    const second = copyExportToImportRoot("claude-ai", src, home);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.destPath).toBe(first.destPath);
  });

  it("different content lands at a different staged path", () => {
    const one = join(srcDir, "one.zip");
    const two = join(srcDir, "two.zip");
    writeFileSync(one, "alpha");
    writeFileSync(two, "beta");

    const a = copyExportToImportRoot("grok-export", one, home);
    const b = copyExportToImportRoot("grok-export", two, home);

    expect(a.destPath).not.toBe(b.destPath);
    expect(a.destPath.endsWith(".zip")).toBe(true);
  });

  it("rejects a missing source path", () => {
    expect(() =>
      copyExportToImportRoot("chatgpt", join(srcDir, "nope.json"), home),
    ).toThrow(/readable file/);
  });
});
