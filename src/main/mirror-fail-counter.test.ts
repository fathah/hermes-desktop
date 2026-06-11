// mirror-fail-counter.test.ts — pure persisted counter for vault-mirror write failures.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readMirrorFailRecord,
  recordMirrorFailure,
  normalizeMirrorFailRecord,
} from "./mirror-fail-counter";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mirror-fail-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("readMirrorFailRecord", () => {
  it("returns a zeroed record when no file exists", () => {
    expect(readMirrorFailRecord(home)).toEqual({ count: 0 });
  });

  it("returns a zeroed record when the file is corrupt", () => {
    writeFileSync(join(home, "mirror-failures.json"), "{ not json", "utf-8");
    expect(readMirrorFailRecord(home)).toEqual({ count: 0 });
  });
});

describe("recordMirrorFailure", () => {
  it("bumps the count, stamps the error + time, and persists", () => {
    const result = recordMirrorFailure(
      home,
      new Error("ENOSPC: disk full"),
      1000,
    );
    expect(result).toEqual({
      count: 1,
      lastError: "ENOSPC: disk full",
      lastAt: 1000,
    });
    // Survives a fresh read (persisted to disk).
    expect(readMirrorFailRecord(home)).toEqual(result);
  });

  it("accumulates across calls and keeps the latest error/timestamp", () => {
    recordMirrorFailure(home, new Error("first"), 1000);
    const second = recordMirrorFailure(home, new Error("second"), 2000);
    expect(second).toEqual({ count: 2, lastError: "second", lastAt: 2000 });
  });

  it("stringifies non-Error failures", () => {
    const result = recordMirrorFailure(home, "raw string failure", 42);
    expect(result.lastError).toBe("raw string failure");
  });

  it("writes valid JSON that round-trips through the reader", () => {
    recordMirrorFailure(home, new Error("boom"), 7);
    const raw = readFileSync(join(home, "mirror-failures.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ count: 1, lastError: "boom", lastAt: 7 });
  });
});

describe("normalizeMirrorFailRecord", () => {
  it("clamps invalid or negative counts to zero", () => {
    expect(normalizeMirrorFailRecord({ count: -5 })).toEqual({ count: 0 });
    expect(normalizeMirrorFailRecord({ count: "nope" })).toEqual({ count: 0 });
    expect(normalizeMirrorFailRecord(null)).toEqual({ count: 0 });
    expect(normalizeMirrorFailRecord("string")).toEqual({ count: 0 });
  });

  it("floors fractional counts and preserves optional fields", () => {
    expect(
      normalizeMirrorFailRecord({ count: 3.9, lastError: "x", lastAt: 9 }),
    ).toEqual({ count: 3, lastError: "x", lastAt: 9 });
  });

  it("drops non-string lastError and non-finite lastAt", () => {
    expect(
      normalizeMirrorFailRecord({ count: 1, lastError: 5, lastAt: Infinity }),
    ).toEqual({ count: 1 });
  });
});
