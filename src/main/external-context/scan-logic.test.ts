import { describe, it, expect } from "vitest";
import { decideFileAction, type FileRecord } from "./scan-logic";
import type { DiscoveredFile } from "./adapters/types";

function file(over: Partial<DiscoveredFile>): DiscoveredFile {
  return {
    source: "claude-code",
    absPath: "/x.jsonl",
    size: 100,
    mtimeMs: 1000,
    strategy: "append",
    ...over,
  };
}

function record(over: Partial<FileRecord>): FileRecord {
  return {
    path: "/x.jsonl",
    strategy: "append",
    offset: 100,
    size: 100,
    mtimeMs: 1000,
    ...over,
  };
}

describe("decideFileAction", () => {
  it("parses from 0 when there is no prior record", () => {
    expect(decideFileAction(file({}), undefined)).toEqual({
      kind: "parse",
      fromOffset: 0,
      reparse: false,
    });
  });

  it("skips an unchanged append file", () => {
    expect(
      decideFileAction(file({ size: 100 }), record({ offset: 100, size: 100 })),
    ).toEqual({
      kind: "skip",
    });
  });

  it("parses only the appended tail when an append file grew", () => {
    const action = decideFileAction(
      file({ size: 250 }),
      record({ offset: 100, size: 100 }),
    );
    expect(action).toEqual({ kind: "parse", fromOffset: 100, reparse: false });
  });

  it("re-parses from 0 when an append file shrank (truncation/rotation)", () => {
    const action = decideFileAction(
      file({ size: 40 }),
      record({ offset: 100, size: 100 }),
    );
    expect(action).toEqual({ kind: "parse", fromOffset: 0, reparse: true });
  });

  it("re-parses a replace file from 0 when mtime changes", () => {
    const action = decideFileAction(
      file({ strategy: "replace", size: 100, mtimeMs: 2000 }),
      record({ strategy: "replace", size: 100, mtimeMs: 1000 }),
    );
    expect(action).toEqual({ kind: "parse", fromOffset: 0, reparse: true });
  });

  it("skips an unchanged replace file", () => {
    const action = decideFileAction(
      file({ strategy: "replace", size: 100, mtimeMs: 1000 }),
      record({ strategy: "replace", size: 100, mtimeMs: 1000 }),
    );
    expect(action).toEqual({ kind: "skip" });
  });
});
