import { describe, expect, it } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { validateImportArchivePath } from "../src/main/installer";

const TEST_DIR = join(tmpdir(), `hermes-import-validation-${Date.now()}`);

describe("validateImportArchivePath", () => {
  it("requires a non-empty path", () => {
    expect(validateImportArchivePath("")).toEqual({
      success: false,
      error: "Import archive path is required.",
    });
  });

  it("rejects missing paths", () => {
    expect(validateImportArchivePath(join(TEST_DIR, "missing.tar.gz"))).toEqual(
      {
        success: false,
        error: "Import archive does not exist.",
      },
    );
  });

  it("rejects directories", () => {
    mkdirSync(TEST_DIR, { recursive: true });

    expect(validateImportArchivePath(TEST_DIR)).toEqual({
      success: false,
      error: "Import archive must be a file.",
    });
  });

  it("returns a resolved path for regular files", () => {
    const archivePath = join(TEST_DIR, "backup.tar.gz");
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(archivePath, "archive");

    expect(validateImportArchivePath(archivePath)).toEqual({
      success: true,
      path: archivePath,
    });
  });
});
