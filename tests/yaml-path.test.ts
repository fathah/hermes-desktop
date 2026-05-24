import { describe, expect, it } from "vitest";
import { getYamlPath } from "../src/main/yaml-path";

const HERMES_LIKE_CONFIG = `
# A real-world-shaped Hermes config.yaml fragment.
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  provider: honcho
delegation:
  model: ''
  provider: ''
  base_url: ''
  inherit_mcp_toolsets: true
providers: {}
fallback_providers: []
agent:
  max_turns: 90
  gateway_timeout: 1800
  service_tier: ''
network:
  force_ipv4: false
  proxy: ''
security:
  redact_secrets: true
model:
  provider: openai
  default: gpt-4o
  base_url: https://api.openai.com/v1
`;

describe("getYamlPath", () => {
  it("returns the leaf scalar for a nested dotted-path key", () => {
    expect(getYamlPath(HERMES_LIKE_CONFIG, "memory.provider")).toBe("honcho");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "model.provider")).toBe("openai");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "model.default")).toBe("gpt-4o");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "model.base_url")).toBe(
      "https://api.openai.com/v1",
    );
    expect(getYamlPath(HERMES_LIKE_CONFIG, "agent.service_tier")).toBe("");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "network.force_ipv4")).toBe("false");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "security.redact_secrets")).toBe(
      "true",
    );
  });

  it("disambiguates same-name keys at different nesting levels", () => {
    // Both memory.provider AND model.provider exist. Plain regex would match
    // whichever appears first; dotted-path must return the requested one.
    expect(getYamlPath(HERMES_LIKE_CONFIG, "memory.provider")).toBe("honcho");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "model.provider")).toBe("openai");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "delegation.provider")).toBe("");
  });

  it("returns null for keys that don't exist", () => {
    expect(getYamlPath(HERMES_LIKE_CONFIG, "memory.nonexistent")).toBeNull();
    expect(getYamlPath(HERMES_LIKE_CONFIG, "nonexistent.provider")).toBeNull();
    expect(getYamlPath(HERMES_LIKE_CONFIG, "")).toBeNull();
  });

  it("handles inline empty maps and lists by returning the literal", () => {
    expect(getYamlPath(HERMES_LIKE_CONFIG, "providers")).toBe("{}");
    expect(getYamlPath(HERMES_LIKE_CONFIG, "fallback_providers")).toBe("[]");
  });

  it("strips quotes from quoted scalar values", () => {
    expect(getYamlPath("k: 'honcho'", "k")).toBe("honcho");
    expect(getYamlPath('k: "honcho"', "k")).toBe("honcho");
  });

  it("strips trailing line comments", () => {
    expect(getYamlPath("model: gpt-4  # default", "model")).toBe("gpt-4");
  });

  it("returns top-level keys without nesting", () => {
    expect(getYamlPath("top: value\n", "top")).toBe("value");
  });

  it("returns null when an intermediate parent isn't a map", () => {
    // memory.provider.something doesn't exist — `provider: honcho` is a scalar
    expect(
      getYamlPath(HERMES_LIKE_CONFIG, "memory.provider.something"),
    ).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const crlf = "memory:\r\n  provider: honcho\r\n";
    expect(getYamlPath(crlf, "memory.provider")).toBe("honcho");
  });
});
