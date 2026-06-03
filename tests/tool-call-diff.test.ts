import { describe, it, expect } from "vitest";
import { computeLineDiff } from "../src/shared/diff";

const NUL = String.fromCharCode(0);

describe("computeLineDiff", () => {
  it("flags an unchanged no-op", () => {
    const d = computeLineDiff("a\nb\n", "a\nb\n");
    expect(d.unchanged).toBe(true);
    expect(d.lines).toEqual([]);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it("detects a pure addition", () => {
    const d = computeLineDiff("a\nb\n", "a\nb\nc\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.lines).toContainEqual({ type: "add", text: "c" });
    expect(
      d.lines.filter((l) => l.type === "context").map((l) => l.text),
    ).toEqual(["a", "b"]);
  });

  it("detects a pure removal", () => {
    const d = computeLineDiff("a\nb\nc\n", "a\nc\n");
    expect(d.removed).toBe(1);
    expect(d.added).toBe(0);
    expect(d.lines).toContainEqual({ type: "remove", text: "b" });
  });

  it("detects a modification as remove+add", () => {
    const d = computeLineDiff("hello\nworld\n", "hello\nthere\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.lines).toContainEqual({ type: "remove", text: "world" });
    expect(d.lines).toContainEqual({ type: "add", text: "there" });
    expect(d.lines[0]).toEqual({ type: "context", text: "hello" });
  });

  it("treats NUL-containing input as binary and skips diffing", () => {
    const d = computeLineDiff("a", `a${NUL}b`);
    expect(d.binary).toBe(true);
    expect(d.lines).toEqual([]);
  });

  it("does NOT treat ordinary spaced text as binary", () => {
    const d = computeLineDiff("the quick brown fox", "the quick red fox");
    expect(d.binary).toBe(false);
    expect(d.added + d.removed).toBeGreaterThan(0);
  });

  it("truncates output beyond maxLines", () => {
    const oldText = Array.from({ length: 50 }, (_, i) => `old${i}`).join("\n");
    const newText = Array.from({ length: 50 }, (_, i) => `new${i}`).join("\n");
    const d = computeLineDiff(oldText, newText, { maxLines: 10 });
    expect(d.truncated).toBe(true);
    expect(d.lines.length).toBe(10);
  });

  it("falls back to replace-all above the LCS cap and marks truncated", () => {
    const big = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const big2 = Array.from({ length: 20 }, (_, i) => `m${i}`).join("\n");
    const d = computeLineDiff(big, big2, { lcsLineCap: 5, maxLines: 1000 });
    expect(d.truncated).toBe(true);
    expect(d.removed).toBe(20);
    expect(d.added).toBe(20);
  });

  it("handles empty old (new file) and empty new (deleted content)", () => {
    expect(computeLineDiff("", "a\nb\n").added).toBe(2);
    expect(computeLineDiff("a\nb\n", "").removed).toBe(2);
  });
});
