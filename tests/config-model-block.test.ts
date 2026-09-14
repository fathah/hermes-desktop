import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Regression tests for issue #242: a `default:` (or `provider:`, `base_url:`)
// key under a *sibling* block such as `personalities:` was being picked up
// as the model's value because the readers/writers used loose regexes
// against the whole file. Both `getModelConfig` and `setModelConfig`
// should now scope strictly to the top-level `model:` block.

const TEST_DIR = join(tmpdir(), `hermes-test-model-block-${Date.now()}`);

async function importConfigWithHome(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getModelConfig — scoped to model: block", () => {
  it("returns the value from model.default, not personalities.default (issue #242)", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "gpt-5.5"',
        '  provider: "openai-codex"',
        '  base_url: "https://chatgpt.com/backend-api/codex"',
        "personalities:",
        "  default: You give clear, accurate, and actionable responses.",
        "  coding: You are an expert coding assistant.",
        "",
      ].join("\n"),
    );

    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    const mc = getModelConfig();

    expect(mc.model).toBe("gpt-5.5");
    expect(mc.provider).toBe("openai-codex");
    expect(mc.baseUrl).toBe("https://chatgpt.com/backend-api/codex");
  });

  it("ignores `default:` inside nested blocks even when it appears first in the file", async () => {
    // personalities: comes BEFORE model:, so the old regex (which picked
    // the first occurrence anywhere) would have returned the personality
    // description as the model name. The block-scoped reader must not.
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "agent:",
        "  personalities:",
        "    default: You give clear, accurate, and actionable responses.",
        "personalities:",
        "  default: You are an expert coding assistant.",
        "model:",
        '  default: "claude-sonnet-4"',
        '  provider: "anthropic"',
        "",
      ].join("\n"),
    );

    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    const mc = getModelConfig();

    expect(mc.model).toBe("claude-sonnet-4");
    expect(mc.provider).toBe("anthropic");
  });

  it("returns defaults when the model: block is absent", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "personalities:",
        "  default: Just a personality.",
        "agent:",
        "  provider: should-not-be-picked",
        "",
      ].join("\n"),
    );

    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    const mc = getModelConfig();

    // Defaults from getModelConfig() when nothing relevant is found.
    expect(mc.provider).toBe("auto");
    expect(mc.model).toBe("");
    expect(mc.baseUrl).toBe("");
  });

  it("returns defaults when the config file doesn't exist", async () => {
    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    const mc = getModelConfig();
    expect(mc).toEqual({ provider: "auto", model: "", baseUrl: "" });
  });

  it("ignores grandchildren (deeper nesting under model:) — only direct siblings count", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "real-model"',
        "  fallback:",
        '    default: "decoy-model"', // 4-space indent: nested, must not be picked
        '    provider: "decoy-provider"',
        "",
      ].join("\n"),
    );

    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    const mc = getModelConfig();
    expect(mc.model).toBe("real-model");
  });

  it("ignores `provider:` set under unrelated blocks (e.g. auxiliary.vision)", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "auxiliary:",
        "  vision:",
        "    provider: auto",
        "model:",
        '  default: "gpt-4o"',
        '  provider: "openai"',
        "",
      ].join("\n"),
    );

    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    expect(
      (await importConfigWithHome(TEST_DIR)).getModelConfig().provider,
    ).toBe("openai");
    void getModelConfig;
  });

  it("handles single-quoted, double-quoted, and bare values", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        "  default: bare-value",
        "  provider: 'single-quoted'",
        '  base_url: "https://example.com"',
        "",
      ].join("\n"),
    );

    const { getModelConfig } = await importConfigWithHome(TEST_DIR);
    const mc = getModelConfig();
    expect(mc.model).toBe("bare-value");
    expect(mc.provider).toBe("single-quoted");
    expect(mc.baseUrl).toBe("https://example.com");
  });
});

describe("setModelConfig — scoped to model: block", () => {
  it("updates model.default in place without touching personalities.default", async () => {
    const before = [
      "model:",
      '  default: "gpt-3.5"',
      '  provider: "openai"',
      "personalities:",
      "  default: You give clear, accurate, and actionable responses.",
      "  coding: You are an expert coding assistant.",
      "",
    ].join("\n");
    writeFileSync(join(TEST_DIR, "config.yaml"), before);

    const { setModelConfig } = await importConfigWithHome(TEST_DIR);
    setModelConfig("openai", "gpt-4o", "", undefined);

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).toContain('default: "gpt-4o"');
    // The personality description must remain intact.
    expect(after).toContain(
      "default: You give clear, accurate, and actionable responses.",
    );
  });

  it("inserts the model.default key at the block's existing indent when it was missing", async () => {
    const before = [
      "model:",
      '  provider: "openai"',
      "personalities:",
      "  default: keep me intact",
      "",
    ].join("\n");
    writeFileSync(join(TEST_DIR, "config.yaml"), before);

    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("openai", "gpt-4o", "https://api.openai.com/v1");

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    // The new keys land inside the model: block, indented like its existing children.
    expect(after).toMatch(/^model:\n(?: {2}[a-zA-Z_]+: .*\n)+/m);
    expect(after).toContain('  default: "gpt-4o"');
    expect(after).toContain('  base_url: "https://api.openai.com/v1"');
    expect(after).toContain("default: keep me intact");

    // Round-trip through the reader to confirm structure is preserved.
    const mc = getModelConfig();
    expect(mc).toEqual({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("creates the model: block if it doesn't exist yet", async () => {
    const before = ["personalities:", "  default: keep me intact", ""].join(
      "\n",
    );
    writeFileSync(join(TEST_DIR, "config.yaml"), before);

    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("anthropic", "claude-sonnet", "");

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    // Model block exists with both keys correctly indented under it.
    // Insertion order isn't load-bearing — we round-trip through the
    // reader below to confirm the values are correctly scoped.
    expect(after).toMatch(/^model:\n(?: {2}[a-zA-Z_]+: .*\n)+/m);
    expect(after).toContain('  provider: "anthropic"');
    expect(after).toContain('  default: "claude-sonnet"');
    // Personality description must remain intact.
    expect(after).toContain("default: keep me intact");

    const mc = getModelConfig();
    expect(mc.provider).toBe("anthropic");
    expect(mc.model).toBe("claude-sonnet");
  });

  it("invalidates cached reads after a write", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["model:", '  default: "gpt-3.5"', '  provider: "openai"', ""].join("\n"),
    );

    const { getModelConfig, setModelConfig } =
      await importConfigWithHome(TEST_DIR);
    expect(getModelConfig().model).toBe("gpt-3.5");
    setModelConfig("openai", "gpt-4o", "");
    expect(getModelConfig().model).toBe("gpt-4o");
  });

  // Regression tests for #228: previously setModelConfig early-returned
  // when config.yaml didn't exist, so users on a fresh / custom
  // HERMES_HOME had their model selection silently dropped — the desktop
  // appeared to save, but the Python gateway saw an empty model and
  // returned 404s. The fix bootstraps an empty config.yaml when missing
  // and threads through upsertBlockChild as usual.

  it("creates config.yaml from scratch when it doesn't exist (issue #228)", async () => {
    // Note: no writeFileSync — the file genuinely does not exist.
    const configFile = join(TEST_DIR, "config.yaml");
    expect(existsSync(configFile)).toBe(false);

    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("gemini", "gemini-2.5-flash", "");

    expect(existsSync(configFile)).toBe(true);
    const after = readFileSync(configFile, "utf-8");

    // The file should start with `model:` (no stray leading blank line)
    // and contain both keys.
    expect(after).toMatch(/^model:\n/);
    expect(after).toContain('  provider: "gemini"');
    expect(after).toContain('  default: "gemini-2.5-flash"');

    // Round-trip confirms the values are scoped to model: and parse back.
    const mc = getModelConfig();
    expect(mc).toEqual({
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "",
    });
  });

  it("creates config.yaml with all three model fields when base_url is given", async () => {
    const configFile = join(TEST_DIR, "config.yaml");
    expect(existsSync(configFile)).toBe(false);

    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("custom", "qwen-coder-30b", "http://localhost:1234/v1");

    expect(existsSync(configFile)).toBe(true);
    const mc = getModelConfig();
    expect(mc).toEqual({
      provider: "custom",
      model: "qwen-coder-30b",
      baseUrl: "http://localhost:1234/v1",
    });
  });

  it("creates the file under the profile directory for a named profile", async () => {
    const profileDir = join(TEST_DIR, "profiles", "work");
    const configFile = join(profileDir, "config.yaml");
    // Neither the profile dir nor the file exists yet — safeWriteFile
    // should create both.
    expect(existsSync(configFile)).toBe(false);

    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("anthropic", "claude-sonnet-4", "", "work");

    expect(existsSync(configFile)).toBe(true);
    const mc = getModelConfig("work");
    expect(mc.provider).toBe("anthropic");
    expect(mc.model).toBe("claude-sonnet-4");
  });
});

describe("setModelConfig — context_length override", () => {
  it("writes model.context_length when a positive value is passed", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["model:", '  default: "qwen-max"', '  provider: "qwen"', ""].join("\n"),
    );

    const { setModelConfig, getModelContextLengthOverride } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("qwen", "qwen-max", "", undefined, 65536);

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    // Written unquoted so YAML parses it as a number, not a string.
    expect(after).toContain("context_length: 65536");
    expect(after).not.toContain('context_length: "65536"');
    expect(getModelContextLengthOverride()).toEqual({
      model: "qwen-max",
      contextLength: 65536,
    });
  });

  it("leaves an existing context_length untouched when passed undefined", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "qwen-max"',
        '  provider: "qwen"',
        '  context_length: "65536"',
        "",
      ].join("\n"),
    );

    const { setModelConfig, getModelContextLengthOverride } =
      await importConfigWithHome(TEST_DIR);
    // No 5th arg — the override must survive a plain provider/model write.
    setModelConfig("qwen", "qwen-max", "");

    expect(getModelContextLengthOverride()?.contextLength).toBe(65536);
  });

  it("removes model.context_length when null (or non-positive) is passed", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "qwen-max"',
        '  provider: "qwen"',
        '  context_length: "65536"',
        '  base_url: "https://example.com"',
        "",
      ].join("\n"),
    );

    const { setModelConfig, getModelContextLengthOverride } =
      await importConfigWithHome(TEST_DIR);
    setModelConfig("qwen", "qwen-max", "https://example.com", undefined, null);

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).not.toContain("context_length");
    // Sibling keys must remain intact after the line removal.
    expect(after).toContain('default: "qwen-max"');
    expect(after).toContain('base_url: "https://example.com"');
    expect(getModelContextLengthOverride()).toBeNull();
  });

  it("getModelContextLengthOverride returns null for absent/invalid values", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["model:", '  default: "m"', '  context_length: "0"', ""].join("\n"),
    );
    const { getModelContextLengthOverride } =
      await importConfigWithHome(TEST_DIR);
    expect(getModelContextLengthOverride()).toBeNull();
  });
});

// Regression for the cross-provider switch bug: switching between an
// Anthropic-compatible and an OpenAI-compatible custom endpoint left a stale
// `model.api_mode` behind, so the new endpoint was hit over the wrong protocol
// (e.g. /v1/messages against a chat/completions server → 404 / lost
// connection). setModelConfig must rewrite or clear api_mode on every switch.
describe("setModelConfig — api_mode override", () => {
  it("writes model.api_mode when a non-empty mode is passed", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "claude-sonnet-4"',
        '  provider: "custom"',
        '  base_url: "https://example.com/anthropic"',
        "",
      ].join("\n"),
    );

    const { setModelConfig } = await importConfigWithHome(TEST_DIR);
    setModelConfig(
      "custom",
      "claude-sonnet-4",
      "https://example.com/anthropic",
      undefined,
      undefined,
      "anthropic_messages",
    );

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).toContain('api_mode: "anthropic_messages"');
  });

  it("leaves an existing api_mode untouched when passed undefined", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "claude-sonnet-4"',
        '  provider: "custom"',
        '  api_mode: "anthropic_messages"',
        "",
      ].join("\n"),
    );

    const { setModelConfig } = await importConfigWithHome(TEST_DIR);
    // No 6th arg — a plain provider/model write must not disturb api_mode.
    setModelConfig("custom", "claude-sonnet-4", "");

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).toContain('api_mode: "anthropic_messages"');
  });

  it("clears a stale api_mode when null is passed (the switch-provider fix)", async () => {
    // Start on an Anthropic-compatible endpoint with an explicit mode...
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "model:",
        '  default: "claude-sonnet-4"',
        '  provider: "custom"',
        '  base_url: "https://example.com/anthropic"',
        '  api_mode: "anthropic_messages"',
        "",
      ].join("\n"),
    );

    const { setModelConfig } = await importConfigWithHome(TEST_DIR);
    // ...then switch to an OpenAI-compatible endpoint that has no explicit
    // mode (apiMode = null). The stale anthropic_messages must be removed so
    // the agent re-detects chat_completions from the new base_url.
    setModelConfig(
      "custom",
      "gpt-4o",
      "https://api.openai-compatible.example/v1",
      undefined,
      undefined,
      null,
    );

    const after = readFileSync(join(TEST_DIR, "config.yaml"), "utf-8");
    expect(after).not.toContain("api_mode");
    // Sibling keys must survive the line removal.
    expect(after).toContain('default: "gpt-4o"');
    expect(after).toContain(
      'base_url: "https://api.openai-compatible.example/v1"',
    );
  });
});
