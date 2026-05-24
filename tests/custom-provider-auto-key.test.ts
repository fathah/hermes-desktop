import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Workaround coverage for fathah/hermes-desktop#260:
 * setModelConfig should auto-populate `model.api_key` for custom
 * providers that point at a known commercial host (DeepSeek, Groq,
 * Mistral, …) using the matching `<NAME>_API_KEY` value from the
 * profile's .env, so the upstream gateway's broken OPENAI_API_KEY
 * fallback never gets a chance to leak.
 */

let testHome: string;

async function loadConfig(): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

function writeBaseFiles(env: string, yaml: string): void {
  writeFileSync(join(testHome, ".env"), env, "utf-8");
  writeFileSync(join(testHome, "config.yaml"), yaml, "utf-8");
}

const SEED_YAML = `model:
  provider: "auto"
  default: ""
  base_url: ""
`;

describe("setModelConfig — known-host custom provider auto-api-key (issue #260)", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-auto-key-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("writes api_key for custom+deepseek when DEEPSEEK_API_KEY is set", async () => {
    writeBaseFiles("DEEPSEEK_API_KEY=sk-deepseek-real-key\n", SEED_YAML);
    const { setModelConfig } = await loadConfig();

    setModelConfig(
      "custom",
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    );

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).toContain('provider: "custom"');
    expect(out).toContain('default: "deepseek-reasoner"');
    expect(out).toContain('base_url: "https://api.deepseek.com/v1"');
    expect(out).toContain('api_key: "sk-deepseek-real-key"');
  });

  it("strips surrounding quotes from .env values", async () => {
    writeBaseFiles('DEEPSEEK_API_KEY="sk-quoted-key"\n', SEED_YAML);
    const { setModelConfig } = await loadConfig();

    setModelConfig(
      "custom",
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    );

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).toContain('api_key: "sk-quoted-key"');
    expect(out).not.toContain('api_key: ""sk-quoted-key""');
  });

  it("works for groq", async () => {
    writeBaseFiles("GROQ_API_KEY=gsk_test_value\n", SEED_YAML);
    const { setModelConfig } = await loadConfig();

    setModelConfig("custom", "llama-3.1-70b", "https://api.groq.com/openai/v1");

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).toContain('api_key: "gsk_test_value"');
  });

  it("does NOT write api_key when env var is missing", async () => {
    writeBaseFiles("UNRELATED=x\n", SEED_YAML);
    const { setModelConfig } = await loadConfig();

    setModelConfig(
      "custom",
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    );

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).not.toContain("api_key:");
  });

  it("does NOT write api_key for unknown hosts (local LLM)", async () => {
    // Even with an OPENAI_API_KEY present, a custom provider pointed at a
    // local URL must not have it auto-copied — the env-var leak is
    // exactly what we're protecting against.
    writeBaseFiles("OPENAI_API_KEY=sk-something\n", SEED_YAML);
    const { setModelConfig } = await loadConfig();

    setModelConfig("custom", "llama3", "http://localhost:11434/v1");

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).not.toContain("api_key:");
  });

  it("does NOT write api_key when provider is not 'custom'", async () => {
    writeBaseFiles("DEEPSEEK_API_KEY=sk-deepseek\n", SEED_YAML);
    const { setModelConfig } = await loadConfig();

    // Built-in providers go through their own gateway path; the workaround
    // is scoped strictly to bare-`custom`.
    setModelConfig(
      "deepseek",
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    );

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).not.toContain("api_key:");
  });

  it("removes a stale api_key when conditions no longer match", async () => {
    // Existing config already has a stale auto-written api_key.
    const stale = `model:
  provider: "custom"
  default: "deepseek-reasoner"
  base_url: "https://api.deepseek.com/v1"
  api_key: "sk-old-deepseek"
`;
    writeBaseFiles("ANTHROPIC_API_KEY=sk-ant-xxx\n", stale);
    const { setModelConfig } = await loadConfig();

    // User switches to Anthropic (built-in provider) — the leftover
    // api_key for the prior custom provider should not linger.
    setModelConfig("anthropic", "claude-3-5-sonnet", "");

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).not.toContain("api_key:");
  });

  it("does not clobber api_key lines outside the model: block (auxiliary scoping)", async () => {
    // Real-world configs have `api_key: ''` lines under `auxiliary.vision`,
    // `auxiliary.web_extract`, etc.  A naive `/^api_key:/m` replace would
    // mangle those.  The model-block-scoped logic must leave them alone.
    const realisticYaml = `model:
  provider: "auto"
  default: ""
  base_url: ""
providers: {}
auxiliary:
  vision:
    provider: auto
    model: ''
    base_url: ''
    api_key: ''
    timeout: 120
  web_extract:
    provider: auto
    model: ''
    base_url: ''
    api_key: ''
    timeout: 360
`;
    writeBaseFiles("DEEPSEEK_API_KEY=sk-deepseek-real\n", realisticYaml);
    const { setModelConfig } = await loadConfig();

    setModelConfig(
      "custom",
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    );

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    // Model block must have the auto-key
    const modelBlock = out.match(/^model:[\s\S]*?(?=^\S)/m)?.[0] || "";
    expect(modelBlock).toContain('api_key: "sk-deepseek-real"');
    // Auxiliary sections must still have their original empty api_key
    expect(out).toContain(
      "vision:\n    provider: auto\n    model: ''\n    base_url: ''\n    api_key: ''",
    );
    expect(out).toContain(
      "web_extract:\n    provider: auto\n    model: ''\n    base_url: ''\n    api_key: ''",
    );
    // Exactly one non-empty api_key value in the whole file (the model one)
    const realKeys = out.match(/api_key:\s*"[^"]+"/g) || [];
    expect(realKeys).toHaveLength(1);
  });

  it("updates the existing api_key in place when the env var changes", async () => {
    const initial = `model:
  provider: "custom"
  default: "deepseek-reasoner"
  base_url: "https://api.deepseek.com/v1"
  api_key: "sk-deepseek-old"
`;
    writeBaseFiles("DEEPSEEK_API_KEY=sk-deepseek-new\n", initial);
    const { setModelConfig } = await loadConfig();

    setModelConfig(
      "custom",
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    );

    const out = readFileSync(join(testHome, "config.yaml"), "utf-8");
    expect(out).toContain('api_key: "sk-deepseek-new"');
    expect(out).not.toContain("sk-deepseek-old");
    // Sanity: only one api_key line.
    expect(out.match(/api_key:/g) || []).toHaveLength(1);
  });
});
