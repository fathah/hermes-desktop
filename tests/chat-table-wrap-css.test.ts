import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(import.meta.dirname, "../src/renderer/src/assets/main.css"),
  "utf-8",
);

describe("Agent markdown table cell wrapping", () => {
  // @lat: [[code-blocks#Table cells wrap long unbreakable text]]
  it("lets long unbreakable text wrap inside table cells", () => {
    const cellRule = CSS.match(
      /\.chat-bubble-agent th,\s*\.chat-bubble-agent td\s*\{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(cellRule).toBeDefined();
    expect(cellRule).toContain("overflow-wrap: anywhere");
    expect(CSS).not.toMatch(
      /\.chat-bubble-agent table\s*\{[^}]*table-layout:\s*fixed/,
    );
  });
});
