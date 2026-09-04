import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(import.meta.dirname, "../src/renderer/src/assets/main.css"),
  "utf-8",
);

describe("onboarding theme", () => {
  it("owns a dark surface independently of the saved application theme", () => {
    const rule = CSS.match(/\.onboard-screen\s*\{(?<body>[\s\S]*?)\n\}/)?.groups
      ?.body;

    expect(rule).toBeDefined();
    expect(rule).toContain("color-scheme: dark");
    expect(rule).toContain("--bg-primary: #0d0f17");
    expect(rule).toContain("--text-primary: #eef0f6");
    expect(rule).toContain("background: var(--bg-primary)");
  });
});
