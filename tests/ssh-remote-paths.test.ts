import { describe, expect, it } from "vitest";
import { findTopLevelKey, findYamlPath } from "../src/main/ssh-remote";

// Regression tests for #240: SSH-mode model config helpers used a loose
// `^\s*<key>:` regex against the remote config.yaml, with FLAT keys
// `provider` / `default` / `base_url`. Result: `personalities.default`'s
// description text was being reported as the model name in the desktop
// UI, and toggling the model would overwrite that personality string
// instead of `model.default`.
//
// The fix mirrors the local-mode fix (PR #248 / issue #247) — a dotted-
// path navigator that walks each segment at strictly-greater indent than
// its parent, and pins flat (single-segment) keys to column 0 so they
// can't silently match nested occurrences. These tests exercise the
// pure helpers; the SSH wrappers are thin glue over them.

describe("findYamlPath — dotted paths against remote-shaped config.yaml", () => {
  it("resolves model.default against typical hermes config", () => {
    const content = [
      "model:",
      '  default: "nemotron-120b"',
      '  provider: "nvidia"',
      '  base_url: "https://example/v1"',
      "personalities:",
      "  default: You give clear and accurate responses.",
      "",
    ].join("\n");

    expect(findYamlPath(content, "model.default")?.value).toBe("nemotron-120b");
    expect(findYamlPath(content, "model.provider")?.value).toBe("nvidia");
    expect(findYamlPath(content, "model.base_url")?.value).toBe(
      "https://example/v1",
    );
  });

  it("does NOT match personalities.default when asked for model.default (#240)", () => {
    // personalities.default appears BEFORE model.default in document
    // order — the old flat regex picked that first occurrence.
    const content = [
      "personalities:",
      "  default: You give clear and accurate responses.",
      "model:",
      '  default: "nemotron-120b"',
      "",
    ].join("\n");

    expect(findYamlPath(content, "model.default")?.value).toBe("nemotron-120b");
    expect(findYamlPath(content, "personalities.default")?.value).toBe(
      "You give clear and accurate responses.",
    );
  });

  it("returns null when the parent block is missing", () => {
    const content = ["display:", "  compact: true", ""].join("\n");
    expect(findYamlPath(content, "model.default")).toBeNull();
  });

  it("returns null when the leaf key is absent under an existing block", () => {
    const content = ["model:", '  provider: "openai"', ""].join("\n");
    expect(findYamlPath(content, "model.default")).toBeNull();
  });

  it("walks arbitrary nesting depth (e.g. agent.personalities.helpful)", () => {
    const content = [
      "agent:",
      "  max_turns: 60",
      "  personalities:",
      "    helpful: 'You are a helpful assistant.'",
      "    concise: 'Be brief.'",
      "",
    ].join("\n");

    expect(findYamlPath(content, "agent.personalities.helpful")?.value).toBe(
      "You are a helpful assistant.",
    );
    expect(findYamlPath(content, "agent.personalities.concise")?.value).toBe(
      "Be brief.",
    );
  });

  it("ignores grandchildren — model.default matches only the direct child", () => {
    const content = [
      "model:",
      '  default: "real-model"',
      "  fallback:",
      '    default: "decoy"', // grandchild of model: must NOT match model.default
      "",
    ].join("\n");

    expect(findYamlPath(content, "model.default")?.value).toBe("real-model");
    expect(findYamlPath(content, "model.fallback.default")?.value).toBe(
      "decoy",
    );
  });

  it("doesn't cross block boundaries mid-walk", () => {
    // service_tier appears as a top-level key AFTER agent — it's not
    // nested under agent, so agent.service_tier must not satisfy on it.
    const content = [
      "agent:",
      "  max_turns: 60",
      "service_tier: top-level-orphan",
      "",
    ].join("\n");

    expect(findYamlPath(content, "agent.service_tier")).toBeNull();
  });

  it("handles bare, single-quoted, and double-quoted values", () => {
    const content = [
      "model:",
      "  default: bare-value",
      "  provider: 'single-quoted'",
      '  base_url: "double-quoted"',
      "",
    ].join("\n");

    expect(findYamlPath(content, "model.default")?.value).toBe("bare-value");
    expect(findYamlPath(content, "model.provider")?.value).toBe(
      "single-quoted",
    );
    expect(findYamlPath(content, "model.base_url")?.value).toBe(
      "double-quoted",
    );
  });

  it("returns offsets pointing at the raw value substring (used by writers)", () => {
    const content = ["model:", '  default: "nemotron"', ""].join("\n");
    const hit = findYamlPath(content, "model.default");
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(content.slice(hit.valueStart, hit.valueEnd)).toBe('"nemotron"');
  });
});

describe("findTopLevelKey — flat keys pinned to column 0", () => {
  it("matches a true top-level key", () => {
    const content = [
      "timezone: 'America/New_York'",
      "model:",
      "  default: gpt-5",
      "",
    ].join("\n");

    expect(findTopLevelKey(content, "timezone")?.value).toBe(
      "America/New_York",
    );
  });

  it("does NOT match an indented occurrence", () => {
    // Old behavior would have happily matched the indented `default:` line.
    const content = ["model:", "  default: gpt-5", ""].join("\n");

    expect(findTopLevelKey(content, "default")).toBeNull();
  });

  it("returns null when the key is absent at column 0", () => {
    const content = [
      "agent:",
      "  service_tier: fast",
      "telegram:",
      "  service_tier: 'oops'",
      "",
    ].join("\n");

    expect(findTopLevelKey(content, "service_tier")).toBeNull();
  });
});
