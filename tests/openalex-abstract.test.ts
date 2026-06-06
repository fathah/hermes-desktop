import { describe, it, expect } from "vitest";
import { reconstructAbstract } from "../src/shared/openalex/core";

describe("reconstructAbstract", () => {
  it("returns empty string for null/undefined/non-object", () => {
    expect(reconstructAbstract(null)).toBe("");
    expect(reconstructAbstract(undefined)).toBe("");
    // @ts-expect-error — guarding the runtime path for malformed input
    expect(reconstructAbstract("nope")).toBe("");
  });

  it("orders tokens by their positions", () => {
    const inv = { quick: [1], The: [0], fox: [3], brown: [2] };
    expect(reconstructAbstract(inv)).toBe("The quick brown fox");
  });

  it("handles a token appearing at multiple positions", () => {
    const inv = { the: [0, 2], cat: [1], hat: [3] };
    expect(reconstructAbstract(inv)).toBe("the cat the hat");
  });

  it("collapses gaps from missing positions into single spaces", () => {
    // positions 0 and 3 present, 1 and 2 missing → gap collapses
    const inv = { start: [0], end: [3] };
    expect(reconstructAbstract(inv)).toBe("start end");
  });

  it("ignores non-array / non-numeric / negative positions", () => {
    const inv = {
      good: [0],
      // @ts-expect-error — malformed positions are tolerated at runtime
      bad: "x",
      // @ts-expect-error
      worse: [-1, "y"],
      tail: [1],
    };
    expect(reconstructAbstract(inv)).toBe("good tail");
  });

  it("returns empty for an empty index", () => {
    expect(reconstructAbstract({})).toBe("");
  });
});
