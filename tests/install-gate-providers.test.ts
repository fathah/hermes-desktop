import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { expectedEnvKeyForModel } from "../src/main/installer";

// Regression tests for #236: the install gate's .env check hard-coded
// only OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY, so users
// configured for DeepSeek, Groq, Mistral, etc. saw the "set AI provider"
// first-run screen every restart, even with a valid key in .env.
//
// The new `expectedEnvKeyForModel(provider, baseUrl)` returns the
// canonical env var name the gateway expects per provider, falling back
// to URL-pattern matching for `custom` / `auto` providers pointed at a
// known endpoint, then to null for unrecognized configurations (where
// the caller does a permissive `*_API_KEY` scan).

describe("expectedEnvKeyForModel — provider-name lookup", () => {
  it.each([
    ["openrouter", "OPENROUTER_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
    ["google", "GOOGLE_API_KEY"],
    ["xai", "XAI_API_KEY"],
    ["deepseek", "DEEPSEEK_API_KEY"], // the specific provider from issue #236
    ["groq", "GROQ_API_KEY"],
    ["mistral", "MISTRAL_API_KEY"],
    ["together", "TOGETHER_API_KEY"],
    ["fireworks", "FIREWORKS_API_KEY"],
    ["cerebras", "CEREBRAS_API_KEY"],
    ["perplexity", "PERPLEXITY_API_KEY"],
    ["huggingface", "HF_TOKEN"], // exception to the *_API_KEY convention
    ["qwen", "QWEN_API_KEY"],
    ["minimax", "MINIMAX_API_KEY"],
    ["glm", "GLM_API_KEY"],
    ["zai", "GLM_API_KEY"],
    ["kimi", "KIMI_API_KEY"],
    ["kimi-coding", "KIMI_API_KEY"],
    ["vertex", "GOOGLE_APPLICATION_CREDENTIALS"],
  ])("maps provider %s → %s", (provider, expected) => {
    expect(expectedEnvKeyForModel(provider, "")).toBe(expected);
  });

  it("is case-insensitive on the provider name", () => {
    expect(expectedEnvKeyForModel("DeepSeek", "")).toBe("DEEPSEEK_API_KEY");
    expect(expectedEnvKeyForModel("ANTHROPIC", "")).toBe("ANTHROPIC_API_KEY");
  });

  it("trims surrounding whitespace from the provider name", () => {
    expect(expectedEnvKeyForModel("  groq  ", "")).toBe("GROQ_API_KEY");
  });
});

describe("expectedEnvKeyForModel — URL fallback for custom/auto providers", () => {
  it("recognizes a known endpoint when provider is 'custom'", () => {
    expect(
      expectedEnvKeyForModel("custom", "https://api.deepseek.com/v1"),
    ).toBe("DEEPSEEK_API_KEY");
    expect(
      expectedEnvKeyForModel("custom", "https://api.groq.com/openai/v1"),
    ).toBe("GROQ_API_KEY");
    expect(
      expectedEnvKeyForModel("custom", "https://openrouter.ai/api/v1"),
    ).toBe("OPENROUTER_API_KEY");
    expect(expectedEnvKeyForModel("custom", "https://api.moonshot.ai/v1")).toBe(
      "KIMI_API_KEY",
    );
    expect(
      expectedEnvKeyForModel("custom", "https://api.z.ai/api/paas/v4"),
    ).toBe("GLM_API_KEY");
  });

  it("recognizes a known endpoint when provider is 'auto'", () => {
    expect(expectedEnvKeyForModel("auto", "https://api.mistral.ai/v1")).toBe(
      "MISTRAL_API_KEY",
    );
  });

  it("returns null for unknown provider with unknown URL", () => {
    expect(
      expectedEnvKeyForModel("custom", "http://localhost:1234/v1"),
    ).toBeNull();
    expect(expectedEnvKeyForModel("custom", "")).toBeNull();
    expect(expectedEnvKeyForModel("", "")).toBeNull();
  });

  it("provider-name match wins over URL fallback when both are present", () => {
    // If somehow provider is "anthropic" but baseUrl points at deepseek
    // (configuration error), trust the provider name — the gateway
    // dispatches by provider, not URL.
    expect(
      expectedEnvKeyForModel("anthropic", "https://api.deepseek.com/v1"),
    ).toBe("ANTHROPIC_API_KEY");
  });
});

describe("checkInstallStatus — configured provider key gate", () => {
  const homes: string[] = [];

  afterEach(() => {
    delete process.env.HERMES_HOME;
    vi.resetModules();
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  async function freshInstaller(
    home: string,
  ): Promise<typeof import("../src/main/installer")> {
    vi.resetModules();
    process.env.HERMES_HOME = home;
    return import("../src/main/installer");
  }

  function seedInstalledHome(): string {
    const home = join(
      tmpdir(),
      `hermes-install-gate-${Date.now()}-${homes.length}`,
    );
    homes.push(home);
    const repo = join(home, "hermes-agent");
    const bin = join(repo, "venv", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "python"), "#!/bin/sh\nexit 0\n", "utf-8");
    chmodSync(join(bin, "python"), 0o755);
    writeFileSync(join(repo, "hermes"), "#!/bin/sh\nexit 0\n", "utf-8");
    chmodSync(join(repo, "hermes"), 0o755);
    return home;
  }

  function writeOpenRouterConfig(home: string): void {
    writeFileSync(
      join(home, "config.yaml"),
      [
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  it("treats an installed OpenRouter profile with a blank removed key as missing", async () => {
    const home = seedInstalledHome();
    writeOpenRouterConfig(home);
    writeFileSync(join(home, ".env"), "OPENROUTER_API_KEY=\n", "utf-8");

    const { checkInstallStatus } = await freshInstaller(home);

    expect(checkInstallStatus()).toMatchObject({
      installed: true,
      configured: true,
      hasApiKey: false,
    });
  });

  it("treats a configured OmniRoute-style local provider as setup-ready without a GUI key", async () => {
    const home = seedInstalledHome();
    writeFileSync(
      join(home, "config.yaml"),
      [
        "model:",
        "  provider: omniroute",
        "  default: qwen/qwen3-coder",
        "providers:",
        "  omniroute:",
        "    api: http://localhost:3333/v1",
        "    default_model: qwen/qwen3-coder",
        "",
      ].join("\n"),
      "utf-8",
    );

    const { checkInstallStatus } = await freshInstaller(home);

    expect(checkInstallStatus()).toMatchObject({
      installed: true,
      configured: true,
      hasApiKey: true,
    });
  });

  it("treats a named remote provider as setup-ready when key_env points at a populated env value", async () => {
    const home = seedInstalledHome();
    writeFileSync(
      join(home, "config.yaml"),
      [
        "model:",
        "  provider: omniroute",
        "  default: openai/gpt-4o",
        "providers:",
        "  omniroute:",
        "    api: https://omniroute.example/v1",
        "    default_model: openai/gpt-4o",
        "    key_env: OMNIROUTE_TOKEN",
        "",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(home, ".env"),
      "OMNIROUTE_TOKEN=sk-omni-test\n",
      "utf-8",
    );

    const { checkInstallStatus } = await freshInstaller(home);

    expect(checkInstallStatus()).toMatchObject({
      installed: true,
      configured: true,
      hasApiKey: true,
    });
  });

  it("keeps a known commercial custom endpoint gated when no usable key is configured", async () => {
    const home = seedInstalledHome();
    writeFileSync(
      join(home, "config.yaml"),
      [
        "model:",
        "  provider: custom",
        "  default: gpt-4o",
        "  base_url: https://api.openai.com/v1",
        "",
      ].join("\n"),
      "utf-8",
    );

    const { checkInstallStatus } = await freshInstaller(home);

    expect(checkInstallStatus()).toMatchObject({
      installed: true,
      configured: true,
      hasApiKey: false,
    });
  });
});
