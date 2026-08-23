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

  it("rejects unrelated CJK text that only coincidentally shares 3-char runs (#793)", () => {
    // partial and full are independently generated, unrelated strings drawn
    // from a handful of common single-character CJK particles. Because each
    // CJK "word" here is only 1 character wide (unlike English, where a
    // 3-letter run is often a whole word or more), a 3-char run recurs
    // constantly by chance and the no-backtrack matcher anchors on four
    // separate coincidental positions, consuming all of `partial` and
    // returning true even though `full` does not contain `partial`.
    const partial = "了是我我你我是你是的你是的";
    const full =
      "你你的我在了在是是的我的的你你了的我了是我了你的我我你我是你了在我是的你是你的在你你";
    expect(full.includes(partial)).toBe(false);
    expect(isLossyChunkCopy(partial, full)).toBe(false);
  });

  it("still accepts a genuine CJK chunk-dropped copy", () => {
    const full =
      "今天天气非常好，阳光明媚，气温适宜，非常适合出门散步和运动锻炼身体。";
    const partial = "今天天气非常好，阳光明媚非常适合出门散步和运动锻炼身体。";
    expect(isLossyChunkCopy(partial, full)).toBe(true);
  });

  it("treats CJK Compatibility Ideographs and Hangul Jamo as dense-script too", () => {
    // Same coincidental-3-char-run trap as the #793 test above, but drawn
    // from the CJK Compatibility Ideographs and Hangul Jamo blocks, which
    // were missing from DENSE_SCRIPT_RANGES: without them isDenseScriptHeavy
    // returns false for this text, the matcher falls back to the 3-char
    // run, and the coincidental match below would be wrongly accepted.
    const compatFull =
      "契龜龜滑豈龜龜豈龜滑滑滑龜滑龜滑龜滑龜豈龜豈龜滑豈龜滑龜滑豈豈滑豈滑豈豈滑滑龜滑豈滑龜滑豈";
    const compatPartial = "豈龜龜滑龜滑龜龜滑豈滑豈滑滑";
    expect(compatFull.includes(compatPartial)).toBe(false);
    expect(isLossyChunkCopy(compatPartial, compatFull)).toBe(false);

    const jamoFull =
      "ᄀᄀᄄᄀᄄᄀᄀᄀᄄᄄᄈᄀᄀᄀᄀᄀᄈᄀᄄᄀᄄᄄᄈᄈᄄᄄᄄᄈᄀᄄᄈᄄᄈᄄᄄᄈᄈᄀᄈᄈᄀᄄᄀᄀᄀ";
    const jamoPartial = "ᄀᄀᄄᄀᄀᄄᄈᄄᄈᄄᄄᄄᄀᄀ";
    expect(jamoFull.includes(jamoPartial)).toBe(false);
    expect(isLossyChunkCopy(jamoPartial, jamoFull)).toBe(false);
  });

  it("still accepts a genuine chunk-dropped copy in CJK Compatibility Ideographs", () => {
    const full = "豈更車賈滑串句龜龜契金喇奈懶癩羅蘿螺";
    const partial = "豈更車賈滑串句龜龜羅蘿螺";
    expect(isLossyChunkCopy(partial, full)).toBe(true);
  });

  it("treats CJK Unified Ideographs Extension C as dense-script too", () => {
    // Same coincidental-run trap as the tests above, drawn from Extension C
    // (U+2A700+, supplementary plane), which was also missing from the
    // original DENSE_SCRIPT_RANGES table: without it isDenseScriptHeavy
    // returns false for this text, the matcher falls back to the 3-char
    // run, and the coincidental match below would be wrongly accepted.
    const extCFull =
      "𪜁𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜁𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀";
    const extCPartial = "𪜁𪜀𪜀𪜀𪜁𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀𪜀";
    expect(extCFull.includes(extCPartial)).toBe(false);
    expect(isLossyChunkCopy(extCPartial, extCFull)).toBe(false);
  });

  it("measures the dense-script run length in characters, not UTF-16 code units", () => {
    // Extension B and later ideographs are supplementary-plane, i.e. surrogate
    // pairs: two UTF-16 code units per character. Indexing the raw strings
    // instead of code-point arrays would measure a 6-unit probe as only 3
    // real characters here, silently halving DENSE_SCRIPT_MIN_RUN for
    // exactly the text it was raised to protect, and wrongly accept this
    // coincidental match.
    const extBFull =
      "𠀁𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀁𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀";
    const extBPartial = "𠀁𠀀𠀀𠀀𠀁𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀𠀀";
    expect(extBFull.includes(extBPartial)).toBe(false);
    expect(isLossyChunkCopy(extBPartial, extBFull)).toBe(false);
  });

  it("still accepts a genuine chunk-dropped copy in supplementary-plane ideographs", () => {
    const full =
      "𠀄𠀁𠀄𠀄𠀁𠀄𠀁𠀄𠀀𠀂𠀄𠀂𠀃𠀁𠀄𠀁𠀁𠀀𠀁𠀃𠀃𠀂𠀀𠀂𠀄𠀃𠀁𠀀𠀂𠀀𠀁𠀃𠀃𠀀𠀁𠀄𠀂𠀁𠀁𠀄";
    const partial =
      "𠀄𠀁𠀄𠀄𠀁𠀄𠀁𠀄𠀀𠀂𠀄𠀂𠀃𠀁𠀄𠀃𠀁𠀀𠀂𠀀𠀁𠀃𠀃𠀀𠀁𠀄𠀂𠀁𠀁𠀄";
    expect(full.includes(partial)).toBe(false);
    expect(isLossyChunkCopy(partial, full)).toBe(true);
  });
});
