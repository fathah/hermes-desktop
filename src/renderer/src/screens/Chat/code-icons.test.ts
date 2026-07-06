import { describe, expect, it } from "vitest";
import { getIconForFile, getSVGStringFromFileType } from "@wesbos/code-icons";

// Regression guard for the @wesbos/code-icons dependency (audit MED-9): the
// WorktreePanel file tree renders icons via these two functions, and the
// package's vulnerable transitive vite/esbuild subtree is pinned via npm
// overrides. If an override (or future bump) breaks the data API, this fails
// before the UI silently renders empty icon wrappers.
describe("@wesbos/code-icons (WorktreePanel icon source)", () => {
  it("maps common source files to an icon type", () => {
    expect(getIconForFile("index.ts")).toBeTruthy();
    expect(getIconForFile("App.tsx")).toBeTruthy();
    expect(getIconForFile("main.py")).toBeTruthy();
  });

  it("returns inline SVG markup for a mapped icon type", () => {
    const iconType = getIconForFile("index.ts");
    const iconData = iconType ? getSVGStringFromFileType(iconType) : null;
    const svg =
      iconData && typeof iconData === "object" && "svg" in iconData
        ? String(iconData.svg)
        : "";
    expect(svg).toContain("<svg");
  });
});
