import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(import.meta.dirname, "../src/renderer/src/assets/main.css"),
  "utf-8",
);

describe("native focus treatment", () => {
  it("suppresses pointer rings without hiding keyboard focus", () => {
    expect(CSS).not.toMatch(/\n:focus\s*\{\s*outline:\s*none;\s*\}/);
    expect(CSS).toMatch(
      /:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none;\s*\}/,
    );

    const keyboardRule = CSS.match(/\n:focus-visible\s*\{(?<body>[\s\S]*?)\n\}/)
      ?.groups?.body;
    expect(keyboardRule).toContain("outline: none");
    expect(keyboardRule).toContain("box-shadow:");
    expect(keyboardRule).toContain("inset 0 0 0 1px");
    expect(keyboardRule).toContain("filter: brightness(1.08)");
    expect(CSS).not.toMatch(/outline:\s*\d+px solid var\(--accent\)/);
    const annotationFocusRule = CSS.match(
      /\.web-preview-annotation-composer:focus-within\s*\{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;
    expect(annotationFocusRule).toContain("inset 0 0 0 1px");
    expect(annotationFocusRule).not.toContain("var(--accent)");
    expect(CSS).toContain("@media (prefers-contrast: more)");
    expect(CSS).toContain("@media (forced-colors: active)");
  });
});
