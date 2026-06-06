import { describe, it, expect } from "vitest";
import { contextChipLabel } from "./contextChip";

describe("contextChipLabel", () => {
  it("orders rules, memory, then notes", () => {
    expect(contextChipLabel({ notes: 3, memory: 1, rules: 2 })).toBe(
      "2 rules · 1 memory item · 3 notes",
    );
  });

  it("singularizes correctly", () => {
    expect(contextChipLabel({ notes: 1, memory: 0, rules: 1 })).toBe(
      "1 rule · 1 note",
    );
  });

  it("omits zero categories", () => {
    expect(contextChipLabel({ notes: 0, memory: 2, rules: 0 })).toBe(
      "2 memory items",
    );
  });

  it("returns empty string when nothing was used", () => {
    expect(contextChipLabel({ notes: 0, memory: 0, rules: 0 })).toBe("");
  });
});
