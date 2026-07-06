import { describe, expect, it } from "vitest";
import {
  PROFILE_COLORS,
  defaultColorForName,
} from "../src/shared/profileColors";

describe("defaultColorForName", () => {
  it("always returns a colour from the palette", () => {
    for (const name of ["default", "coder", "work", "a", "zzz", "Ünïcode"]) {
      expect(PROFILE_COLORS as readonly string[]).toContain(
        defaultColorForName(name),
      );
    }
  });

  it("is deterministic for the same name", () => {
    expect(defaultColorForName("coder")).toBe(defaultColorForName("coder"));
  });

  it("spreads different names across the palette", () => {
    const names = ["default", "coder", "research", "ops", "design", "qa"];
    const colors = new Set(names.map(defaultColorForName));
    // Not a strict guarantee, but these sample names should not all collide.
    expect(colors.size).toBeGreaterThan(1);
  });
});
