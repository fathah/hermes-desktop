import { describe, expect, it } from "vitest";
import {
  clampIntegratedTerminalHeight,
  DEFAULT_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
} from "./integratedTerminalLayout";
import { INTEGRATED_TERMINAL_THEME } from "./integratedTerminalTheme";

describe("integrated terminal bottom drawer", () => {
  it("keeps the default height within a normal desktop viewport", () => {
    expect(clampIntegratedTerminalHeight(DEFAULT_TERMINAL_HEIGHT, 900)).toBe(
      DEFAULT_TERMINAL_HEIGHT,
    );
  });

  it("preserves enough room for chat when resized upward", () => {
    expect(clampIntegratedTerminalHeight(900, 700)).toBe(420);
  });

  it("does not let the drawer shrink below its full default height", () => {
    expect(clampIntegratedTerminalHeight(20, 900)).toBe(MIN_TERMINAL_HEIGHT);
    expect(MIN_TERMINAL_HEIGHT).toBe(DEFAULT_TERMINAL_HEIGHT);
  });

  it("provides distinct normal and bright ANSI colors", () => {
    const normal = ["red", "green", "yellow", "blue", "magenta", "cyan"];

    for (const color of normal) {
      const bright = `bright${color[0].toUpperCase()}${color.slice(1)}`;
      expect(INTEGRATED_TERMINAL_THEME[color]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(INTEGRATED_TERMINAL_THEME[bright]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(INTEGRATED_TERMINAL_THEME[bright]).not.toBe(
        INTEGRATED_TERMINAL_THEME[color],
      );
    }
  });
});
