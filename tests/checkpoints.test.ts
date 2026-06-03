import { describe, it, expect } from "vitest";
import {
  parseCheckpointList,
  isNoCheckpoints,
  listCommand,
  restoreCommand,
  diffCommand,
} from "../src/shared/checkpoints";

const SAMPLE = [
  "📸 Checkpoints for /work/proj:",
  "",
  "  1. a1b2c3d  2026-06-03 14:30  before edit  (3 files, +10/-5)",
  "  2. e4f5g6h  2026-06-03 14:25  initial state",
  "",
  "  /rollback <N>             restore to checkpoint N",
].join("\n");

describe("parseCheckpointList", () => {
  it("parses rows with and without stats", () => {
    const cps = parseCheckpointList(SAMPLE);
    expect(cps).toHaveLength(2);
    expect(cps[0]).toEqual({
      number: 1,
      shortHash: "a1b2c3d",
      timestamp: "2026-06-03 14:30",
      reason: "before edit",
      filesChanged: 3,
      insertions: 10,
      deletions: 5,
    });
    expect(cps[1]).toMatchObject({
      number: 2,
      shortHash: "e4f5g6h",
      reason: "initial state",
      filesChanged: undefined,
    });
  });

  it("ignores headers and help lines", () => {
    expect(parseCheckpointList(SAMPLE).every((c) => c.number > 0)).toBe(true);
  });

  it("returns [] for empty or non-matching text", () => {
    expect(parseCheckpointList("")).toEqual([]);
    expect(parseCheckpointList("nothing here")).toEqual([]);
  });
});

describe("isNoCheckpoints", () => {
  it("detects the empty / disabled states", () => {
    expect(isNoCheckpoints("No checkpoints found for /x")).toBe(true);
    expect(isNoCheckpoints("Checkpoints are not enabled")).toBe(true);
    expect(isNoCheckpoints(SAMPLE)).toBe(false);
  });
});

describe("command builders", () => {
  it("builds the slash commands", () => {
    expect(listCommand()).toBe("/rollback");
    expect(restoreCommand(2)).toBe("/rollback 2");
    expect(diffCommand(3)).toBe("/rollback diff 3");
  });
});
