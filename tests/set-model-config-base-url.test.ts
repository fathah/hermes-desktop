import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * `setModelConfig` must write the right `base_url:` into `config.yaml` —
 * specifically, when the renderer passes an empty `baseUrl` (because the
 * user picked a built-in provider entry whose model library row doesn't
 * carry an explicit URL), it should substitute the provider's canonical
 * URL from `provider-registry.ts` rather than leaving the previous
 * `base_url:` untouched.
 *
 * Concrete failure mode this prevents (the bug that motivated this fix):
 *
 *   1. User selects OAuth Codex → `model.base_url` becomes
 *      `https://chatgpt.com/backend-api/codex`.
 *   2. User then picks DeepSeek's `deepseek-v4-pro` (a built-in provider
 *      entry; the library row has no baseUrl).
 *   3. `setModelConfig("deepseek", "deepseek-v4-pro", "")` would
 *      historically leave the Codex URL in place — the next chat hits
 *      OpenAI's Codex endpoint carrying the DeepSeek key, and the user
 *      sees a 401 from `platform.openai.com`.
 *
 * The fix: substitute the canonical URL for built-in providers; clear
 * the field when the provider has no canonical and the caller supplied
 * nothing.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-set-model-base-url-${Date.now()}`);

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

describe("setModelConfig — base_url substitution", () => {
  it("writes the canonical URL when the user picks a built-in provider with no explicit baseUrl", async () => {
    const configFile = join(TEST_DIR, "config.yaml");
    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);

    setModelConfig("deepseek", "deepseek-v4-pro", "");

    const mc = getModelConfig();
    expect(mc.provider).toBe("deepseek");
    expect(mc.model).toBe("deepseek-v4-pro");
    // Canonical URL got written even though the caller passed "".
    expect(mc.baseUrl).toBe("https://api.deepseek.com/v1");
    // And it landed in the actual `model:` block on disk.
    const content = readFileSync(configFile, "utf-8");
    expect(content).toMatch(/^model:/m);
    expect(content).toContain('  base_url: "https://api.deepseek.com/v1"');
  });

  it("respects an explicit baseUrl when the caller supplies one", async () => {
    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);

    // User configured a self-hosted DeepSeek-compatible proxy on their LAN.
    setModelConfig(
      "deepseek",
      "deepseek-v4-pro",
      "https://my-llm-proxy.lan/v1",
    );

    const mc = getModelConfig();
    expect(mc.baseUrl).toBe("https://my-llm-proxy.lan/v1");
  });

  it("overwrites a stale base_url when switching to a different built-in provider — the actual bug repro", async () => {
    const configFile = join(TEST_DIR, "config.yaml");

    // Step 1 — user was previously on OAuth Codex.
    writeFileSync(
      configFile,
      [
        "model:",
        '  provider: "openai-codex"',
        '  default: "gpt-5-codex"',
        '  base_url: "https://chatgpt.com/backend-api/codex"',
        "",
      ].join("\n"),
      "utf-8",
    );

    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);

    // Step 2 — user picks DeepSeek's deepseek-v4-pro from the model picker.
    //          The library row has no baseUrl, so the renderer passes "".
    setModelConfig("deepseek", "deepseek-v4-pro", "");

    const mc = getModelConfig();
    expect(mc.provider).toBe("deepseek");
    expect(mc.model).toBe("deepseek-v4-pro");
    // Critical: the stale Codex URL is gone, replaced by DeepSeek's
    // canonical URL. Before this fix, mc.baseUrl would still be
    // "https://chatgpt.com/backend-api/codex" and chat would 401.
    expect(mc.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("leaves base_url unset for `custom` providers with no explicit baseUrl", async () => {
    const configFile = join(TEST_DIR, "config.yaml");
    const { setModelConfig, getModelConfig } =
      await importConfigWithHome(TEST_DIR);

    // `custom` has no canonical — there's nothing sensible to fill in,
    // and writing a fake URL would be worse than leaving it empty (the
    // user already saw the validation that prompts them for a URL).
    setModelConfig("custom", "my-local-model", "");

    const mc = getModelConfig();
    expect(mc.provider).toBe("custom");
    expect(mc.baseUrl).toBe("");

    const content = readFileSync(configFile, "utf-8");
    expect(content).not.toMatch(/^\s+base_url:/m);
  });

  it("covers every built-in remote provider — the full coverage check", async () => {
    // If this test starts failing because a built-in remote provider
    // got added to constants.ts:LOCAL_PRESETS without a corresponding
    // entry in provider-registry.ts, the right fix is to add the URL —
    // not to weaken the assertion here.
    const provider_to_canonical: Record<string, string> = {
      deepseek: "https://api.deepseek.com/v1",
      aimlapi: "https://api.aimlapi.com/v1",
      groq: "https://api.groq.com/openai/v1",
      mistral: "https://api.mistral.ai/v1",
      together: "https://api.together.xyz/v1",
      fireworks: "https://api.fireworks.ai/inference/v1",
      cerebras: "https://api.cerebras.ai/v1",
      xiaomi: "https://api.xiaomimimo.com/v1",
    };

    for (const [provider, expected] of Object.entries(provider_to_canonical)) {
      // Fresh import each iteration to reset the file.
      rmSync(TEST_DIR, { recursive: true, force: true });
      mkdirSync(TEST_DIR, { recursive: true });

      const { setModelConfig, getModelConfig } =
        await importConfigWithHome(TEST_DIR);
      setModelConfig(provider, "some-model", "");

      const mc = getModelConfig();
      expect(mc.baseUrl).toBe(expected);
    }
  });

  it("writes default base URLs for explicit local providers", async () => {
    const provider_to_canonical: Record<string, string> = {
      lmstudio: "http://localhost:1234/v1",
      atomicchat: "http://localhost:1337/v1",
      ollama: "http://localhost:11434/v1",
      vllm: "http://localhost:8000/v1",
      llamacpp: "http://localhost:8080/v1",
    };

    for (const [provider, expected] of Object.entries(provider_to_canonical)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
      mkdirSync(TEST_DIR, { recursive: true });

      const { setModelConfig, getModelConfig } =
        await importConfigWithHome(TEST_DIR);
      setModelConfig(provider, "some-local-model", "");

      const mc = getModelConfig();
      expect(mc.provider).toBe(provider);
      expect(mc.baseUrl).toBe(expected);
    }
  });
});
