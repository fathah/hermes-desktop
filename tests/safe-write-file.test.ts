import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { safeWriteFile } from "../src/main/utils";

const faults = vi.hoisted(() => ({ partialWrite: false }));
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const mockFs = {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>): void => {
      if (faults.partialWrite) {
        actual.writeFileSync(args[0], "partial");
        throw new Error("disk full");
      }
      actual.writeFileSync(...args);
    },
  };
  return { ...mockFs, default: mockFs };
});

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
  it("preserves verified binary payloads byte-for-byte", () => {
    const filePath = join(TEST_DIR, "binary", "payload.bin");
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    safeWriteFile(filePath, bytes);
    expect(readFileSync(filePath)).toEqual(bytes);
  });
});

afterEach(() => {
  faults.partialWrite = false;
});
afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
// @lat: [[connections#Failed local write cleanup]]
it("cleans a partially written temporary file and preserves the original", () => {
  const dir = join(TEST_DIR, "partial");
  const target = join(dir, "settings.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, "original");
  faults.partialWrite = true;
  expect(() => safeWriteFile(target, "replacement")).toThrow("disk full");
  expect(readFileSync(target, "utf8")).toBe("original");
  expect(readdirSync(dir)).toEqual(["settings.json"]);
});

it("cleans its temporary file after a rename failure", () => {
  const dir = join(TEST_DIR, "rename-failure");
  const target = join(dir, "settings.json");
  mkdirSync(target, { recursive: true });
  expect(() => safeWriteFile(target, "replacement")).toThrow();
  expect(readdirSync(dir)).toEqual(["settings.json"]);
});
