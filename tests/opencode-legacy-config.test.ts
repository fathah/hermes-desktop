import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadConfig(): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/config");
}

async function loadModels(): Promise<typeof import("../src/main/models")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/models");
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "hermes-opencode-legacy-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(testHome, { recursive: true, force: true });
});

describe("legacy OpenCode custom configuration", () => {
  it("does not rewrite config.yaml or copy CUSTOM_API_KEY", async () => {
    const config = [
      "model:",
      '  provider: "custom"',
      '  default: "mimo-v2.5"',
      '  base_url: "https://opencode.ai/zen/go/v1"',
      '  api_key: "no-key-required"',
      '  api_mode: "chat_completions"',
      "",
    ].join("\n");
    const env = "CUSTOM_API_KEY=legacy-key\n";
    const configPath = join(testHome, "config.yaml");
    const envPath = join(testHome, ".env");
    writeFileSync(configPath, config);
    writeFileSync(envPath, env);

    const { getModelConfig, readEnv } = await loadConfig();

    expect(getModelConfig()).toEqual({
      provider: "custom",
      model: "mimo-v2.5",
      baseUrl: "https://opencode.ai/zen/go/v1",
    });
    expect(readEnv()).toEqual({ CUSTOM_API_KEY: "legacy-key" });
    expect(readFileSync(configPath, "utf-8")).toBe(config);
    expect(readFileSync(envPath, "utf-8")).toBe(env);
  });

  it("does not rewrite a custom OpenCode model attachment", async () => {
    const models = [
      {
        id: "legacy-go-row",
        name: "MiMo",
        provider: "custom",
        providerLabel: "OpenAI Compatible / Local",
        model: "mimo-v2.5",
        baseUrl: "https://opencode.ai/zen/go/v1",
        apiMode: "chat_completions",
        createdAt: 1,
      },
    ];
    const modelsPath = join(testHome, "models.json");
    const serialized = JSON.stringify(models, null, 2);
    writeFileSync(modelsPath, serialized);

    const { listModels } = await loadModels();

    expect(listModels()).toEqual([
      expect.objectContaining({
        id: "legacy-go-row",
        provider: "custom",
        providerLabel: "OpenAI Compatible / Local",
        model: "mimo-v2.5",
        baseUrl: "https://opencode.ai/zen/go/v1",
        apiMode: "chat_completions",
      }),
    ]);
    expect(readFileSync(modelsPath, "utf-8")).toBe(serialized);
  });
});
