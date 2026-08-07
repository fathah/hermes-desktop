import { describe, expect, it } from "vitest";
import { isIntegratedTerminalShortcut } from "./integratedTerminalShortcut";

const shortcutEvent = (
  overrides: Partial<Parameters<typeof isIntegratedTerminalShortcut>[0]> = {},
): Parameters<typeof isIntegratedTerminalShortcut>[0] => ({
  altKey: false,
  code: "Backquote",
  ctrlKey: true,
  metaKey: false,
  repeat: false,
  shiftKey: false,
  ...overrides,
});

describe("integrated terminal shortcut", () => {
  it("matches Control plus backtick", () => {
    expect(isIntegratedTerminalShortcut(shortcutEvent())).toBe(true);
  });

  it("does not match Command, shifted, or repeated key presses", () => {
    expect(
      isIntegratedTerminalShortcut(
        shortcutEvent({ ctrlKey: false, metaKey: true }),
      ),
    ).toBe(false);
    expect(
      isIntegratedTerminalShortcut(shortcutEvent({ shiftKey: true })),
    ).toBe(false);
    expect(isIntegratedTerminalShortcut(shortcutEvent({ repeat: true }))).toBe(
      false,
    );
  });
});
