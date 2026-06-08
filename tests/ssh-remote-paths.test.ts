import { describe, expect, it } from "vitest";
import { getYamlValue } from "../src/main/yaml-utils";

describe("getYamlValue against remote-shaped config.yaml (originally findYamlPath regression tests)", () => {
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

    expect(getYamlValue(content, "model.default")).toBe("nemotron-120b");
    expect(getYamlValue(content, "model.provider")).toBe("nvidia");
    expect(getYamlValue(content, "model.base_url")).toBe(
      "https://example/v1",
    );
  });

  it("does NOT match personalities.default when asked for model.default (#240)", () => {
    const content = [
      "personalities:",
      "  default: You give clear and accurate responses.",
      "model:",
      '  default: "nemotron-120b"',
      "",
    ].join("\n");

    expect(getYamlValue(content, "model.default")).toBe("nemotron-120b");
    expect(getYamlValue(content, "personalities.default")).toBe(
      "You give clear and accurate responses.",
    );
  });

  it("returns null when the parent block is missing", () => {
    const content = ["display:", "  compact: true", ""].join("\n");
    expect(getYamlValue(content, "model.default")).toBeNull();
  });

  it("returns null when the leaf key is absent under an existing block", () => {
    const content = ["model:", '  provider: "openai"', ""].join("\n");
    expect(getYamlValue(content, "model.default")).toBeNull();
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

    expect(getYamlValue(content, "agent.personalities.helpful")).toBe(
      "You are a helpful assistant.",
    );
    expect(getYamlValue(content, "agent.personalities.concise")).toBe(
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

    expect(getYamlValue(content, "model.default")).toBe("real-model");
    expect(getYamlValue(content, "model.fallback.default")).toBe(
      "decoy",
    );
  });

  it("doesn't cross block boundaries mid-walk", () => {
    const content = [
      "agent:",
      "  max_turns: 60",
      "service_tier: top-level-orphan",
      "",
    ].join("\n");

    expect(getYamlValue(content, "agent.service_tier")).toBeNull();
  });

  it("handles bare, single-quoted, and double-quoted values", () => {
    const content = [
      "model:",
      "  default: bare-value",
      "  provider: 'single-quoted'",
      '  base_url: "double-quoted"',
      "",
    ].join("\n");

    expect(getYamlValue(content, "model.default")).toBe("bare-value");
    expect(getYamlValue(content, "model.provider")).toBe(
      "single-quoted",
    );
    expect(getYamlValue(content, "model.base_url")).toBe(
      "double-quoted",
    );
  });
});

describe("getYamlValue with flat keys pinned to top level", () => {
  it("matches a true top-level key", () => {
    const content = [
      "timezone: 'America/New_York'",
      "model:",
      "  default: gpt-5",
      "",
    ].join("\n");

    expect(getYamlValue(content, "timezone")).toBe(
      "America/New_York",
    );
  });

  it("does NOT match an indented occurrence", () => {
    const content = ["model:", "  default: gpt-5", ""].join("\n");
    expect(getYamlValue(content, "default")).toBeNull();
  });

  it("returns null when the key is absent at column 0", () => {
    const content = [
      "agent:",
      "  service_tier: fast",
      "telegram:",
      "  service_tier: 'oops'",
      "",
    ].join("\n");

    expect(getYamlValue(content, "service_tier")).toBeNull();
  });
});
