import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { safeWriteFile } from "../src/main/utils";

const TEST_DIR = join(tmpdir(), `hermes-safe-write-${Date.now()}`);

describe("safeWriteFile", () => {
  it("creates parent directories before writing", () => {
    const filePath = join(TEST_DIR, "nested", "config.yaml");

    safeWriteFile(filePath, "provider: openai\n");

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("provider: openai\n");
  });

  it("replaces an existing file through a same-directory temp file", () => {
    const dir = join(TEST_DIR, "replace");
    const filePath = join(dir, "models.json");
    mkdirSync(dir, { recursive: true });

    safeWriteFile(filePath, "old");
    safeWriteFile(filePath, "new");

    expect(readFileSync(filePath, "utf-8")).toBe("new");
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
  });

  it("restricts file permissions to owner-only read/write (0600)", () => {
    const filePath = join(TEST_DIR, "secure.txt");
    safeWriteFile(filePath, "secret content");

    if (process.platform !== "win32") {
      const stat = statSync(filePath);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});
