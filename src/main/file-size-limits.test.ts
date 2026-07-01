import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  assertBase64DecodedByteLimit,
  assertFileWithinByteLimit,
} from "./file-size-limits";

let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("file-size limits", () => {
  it("rejects base64 payloads whose decoded size exceeds the limit", () => {
    const encoded = Buffer.alloc(5).toString("base64");

    expect(() => assertBase64DecodedByteLimit(encoded, 4)).toThrow(
      /too large/i,
    );
    expect(() => assertBase64DecodedByteLimit(encoded, 5)).not.toThrow();
  });

  it("rejects whole-file reads above the configured cap", () => {
    dir = mkdtempSync(join(tmpdir(), "file-limit-"));
    const file = join(dir, "large.bin");
    writeFileSync(file, Buffer.alloc(6));

    expect(() => assertFileWithinByteLimit(file, 5)).toThrow(/too large/i);
    expect(() => assertFileWithinByteLimit(file, 6)).not.toThrow();
  });
});
