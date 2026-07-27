// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isLossyChunkCopy } from "./lossyText";

/**
 * The chunk-copy matcher backs both stream reconciliations (assistant bubble
 * merge + reasoning-row dedup). It must accept genuine chunk-dropped copies
 * and reject unrelated text whose characters merely embed as a scattered
 * subsequence — the review-flagged false positive that would erase real
 * pre-tool-call content or a distinct short thought.
 */
describe("isLossyChunkCopy", () => {
  it("accepts real chunk-dropped copies", () => {
    expect(
      isLossyChunkCopy(
        "! What are we working on?",
        "Hey! What are we working on today?",
      ),
    ).toBe(true);
    expect(
      isLossyChunkCopy(
        "Sat planet from the Sun — ring system made ice and rock particles.",
        "Saturn is the sixth planet from the Sun — a gas giant famous for its stunning ring system made of ice and rock particles.",
      ),
    ).toBe(true);
    expect(
      isLossyChunkCopy(
        "I'm running moon-k3 via provider ous.",
        "I'm running moonshotai/kimi-k3 via provider nous.",
      ),
    ).toBe(true);
  });

  it("rejects a scattered character subsequence (not contiguous runs)", () => {
    // Every character of the partial appears in order in the full text, but
    // only as 1-char fragments — a coincidental embedding (what a plain
    // subsequence test would wrongly accept), not a chunk-dropped copy.
    expect(isLossyChunkCopy("abcdefghijkl", "a1b2c3d4e5f6g7h8i9j0k1l2")).toBe(
      false,
    );
  });

  it("rejects tiny fragments and low coverage", () => {
    // Below the minimum length.
    expect(isLossyChunkCopy("On it.", "Onwards — it is done.")).toBe(false);
    // A real prefix, but far under 30% of the full text.
    const long = "x".repeat(200);
    expect(isLossyChunkCopy("xxxxxxxxxxxx", long)).toBe(false);
  });

  it("rejects equal or longer partials (nothing was dropped)", () => {
    expect(isLossyChunkCopy("same text here", "same text here")).toBe(false);
    expect(isLossyChunkCopy("longer than the full", "short full")).toBe(false);
  });

  it("allows a short final run (trailing punctuation survives chunking)", () => {
    // Runs: "Hello there my friend" + trailing "!" (1 char, final run).
    expect(
      isLossyChunkCopy("Hello there my friend!", "Hello there my friend, hi!"),
    ).toBe(true);
  });
});
