import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(import.meta.dirname, "../src/renderer/src/assets/main.css"),
  "utf-8",
);

describe("Fast Mode popover icon alignment", () => {
  // @lat: [[window-chrome#Modal & popover glass is near-opaque (compositing-independent)#Fast-mode icon alignment]]
  it("keeps description typography from overriding the icon flex container", () => {
    const iconRule = CSS.match(
      /\.chat-fast-popover-icon\s*\{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(iconRule).toContain("display: inline-flex");
    expect(iconRule).toContain("align-items: center");
    expect(iconRule).toContain("justify-content: center");
    expect(CSS).not.toMatch(/\.chat-fast-popover\s+span\s*\{/);
    expect(CSS).toMatch(/\.chat-fast-popover\s*>\s*span\s*\{/);
  });
});
