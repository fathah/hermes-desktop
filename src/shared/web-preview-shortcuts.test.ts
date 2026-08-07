import { describe, expect, it } from "vitest";
import {
  matchWebPreviewShortcut,
  webPreviewShortcutLabel,
} from "./web-preview-shortcuts";

describe("web preview shortcuts", () => {
  it("matches macOS and non-macOS primary modifiers", () => {
    expect(
      matchWebPreviewShortcut(
        {
          key: "e",
          meta: true,
          control: false,
          shift: true,
          alt: false,
          type: "keyDown",
        },
        true,
      ),
    ).toBe("edit");
    expect(
      matchWebPreviewShortcut(
        {
          key: "Enter",
          meta: false,
          control: true,
          shift: false,
          alt: false,
          type: "keyDown",
        },
        false,
      ),
    ).toBe("commit");
  });

  it("ignores key-up, alt, and incomplete chords", () => {
    expect(
      matchWebPreviewShortcut(
        {
          key: "r",
          meta: true,
          control: false,
          shift: false,
          alt: false,
          type: "keyUp",
        },
        true,
      ),
    ).toBeNull();
    expect(
      matchWebPreviewShortcut(
        {
          key: "r",
          meta: true,
          control: false,
          shift: false,
          alt: true,
        },
        true,
      ),
    ).toBeNull();
  });

  it("formats platform-native labels", () => {
    expect(webPreviewShortcutLabel("annotate", true)).toBe("⌘⇧C");
    expect(webPreviewShortcutLabel("reload", false)).toBe("Ctrl+R");
  });
});
