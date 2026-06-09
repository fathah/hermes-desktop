import { describe, it, expect } from "vitest";
import {
  upsertPlatformToolsets,
  readPlatformToolsets,
  READ_INFO_TELEGRAM_TOOLSETS,
} from "./tools";

const CONFIG = `model:
  provider: xai
platform_toolsets:
  cli:
      - terminal
      - web
known_plugin_toolsets:
  cli:
      - web
approvals:
  mode: manual
`;

describe("upsertPlatformToolsets", () => {
  it("inserts a telegram sub-block, leaving cli + other sections intact", () => {
    const out = upsertPlatformToolsets(CONFIG, "telegram", ["web", "vision"]);
    expect(out).toContain("platform_toolsets:");
    expect(out).toMatch(/ {2}telegram:\n {6}- web\n {6}- vision/);
    // cli untouched
    expect(out).toMatch(/ {2}cli:\n {6}- terminal\n {6}- web/);
    // did NOT touch known_plugin_toolsets (still has its own cli)
    expect(out).toContain("known_plugin_toolsets:");
    expect(out).toContain("mode: manual");
  });

  it("replaces an existing block-form telegram list", () => {
    const withTg = upsertPlatformToolsets(CONFIG, "telegram", [
      "terminal",
      "file",
    ]);
    const rescoped = upsertPlatformToolsets(withTg, "telegram", ["web"]);
    expect(readPlatformToolsets(rescoped, "telegram")).toEqual(["web"]);
    // only one telegram sub-block
    expect((rescoped.match(/ {2}telegram:/g) || []).length).toBe(1);
  });

  it("rewrites an inline-form telegram: [preset] into a block", () => {
    const inline = CONFIG.replace(
      "platform_toolsets:\n",
      "platform_toolsets:\n  telegram: [hermes-telegram]\n",
    );
    const out = upsertPlatformToolsets(
      inline,
      "telegram",
      READ_INFO_TELEGRAM_TOOLSETS,
    );
    expect(out).not.toContain("[hermes-telegram]");
    expect(readPlatformToolsets(out, "telegram")).toEqual(
      READ_INFO_TELEGRAM_TOOLSETS,
    );
  });

  it("appends a platform_toolsets section when none exists", () => {
    const out = upsertPlatformToolsets(
      "model:\n  provider: xai\n",
      "telegram",
      ["web"],
    );
    expect(out).toContain("platform_toolsets:\n  telegram:\n      - web");
  });
});

describe("readPlatformToolsets", () => {
  it("reads block-form lists", () => {
    expect(readPlatformToolsets(CONFIG, "cli")).toEqual(["terminal", "web"]);
  });
  it("reads inline-form lists", () => {
    const inline = CONFIG.replace(
      "platform_toolsets:\n",
      "platform_toolsets:\n  telegram: [web, vision]\n",
    );
    expect(readPlatformToolsets(inline, "telegram")).toEqual(["web", "vision"]);
  });
  it("returns null when the platform isn't configured", () => {
    expect(readPlatformToolsets(CONFIG, "telegram")).toBeNull();
  });
});
