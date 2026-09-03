import { describe, expect, it } from "vitest";
import { worktreeFileIconKind } from "./WorktreePanel";

describe("worktreeFileIconKind", () => {
  // @lat: [[context-folder#Muted tree icons#Browser-safe file icons]]
  it.each([
    ["App.tsx", "code"],
    [".gitignore", "code"],
    ["README.md", "text"],
    ["logo.webp", "image"],
    ["release.tar.gz", "archive"],
    ["metrics.csv", "spreadsheet"],
    ["payload.bin", "file"],
  ] as const)("maps %s to the %s icon", (filename, expected) => {
    expect(worktreeFileIconKind(filename)).toBe(expected);
  });
});
