import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Dual-engine compat: when the desktop seeds a custom-provider key into
 * `.env`, it writes both the historical `CUSTOM_PROVIDER_<NAME>_KEY`
 * form (for the runtime spawn) AND the host-derived `<VENDOR>_API_KEY`
 * form (for the long-running gateway, which only sees what's in `.env`
 * at startGateway time).
 *
 * Without the second write, gateway-mode chat (the primary path the
 * desktop uses when the gateway is up) breaks on engines that have
 * `_host_derived_api_key()` — they refuse to forward OPENAI_API_KEY
 * to a non-openai host and look for the host-derived form instead.
 */

let testHome: string;

async function freshModels(): Promise<typeof import("../src/main/models")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/models");
}

interface ProviderEntry {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

function writeCustomProviders(entries: ProviderEntry[]): void {
  // `loadCustomProviders` reads from config.yaml's `custom_providers:` block.
  const yaml =
    "custom_providers:\n" +
    entries
      .map(
        (e) =>
          `  - name: "${e.name}"\n` +
          `    provider: "${e.provider}"\n` +
          `    model: "${e.model}"\n` +
          `    base_url: "${e.baseUrl}"\n` +
          `    api_key: "${e.apiKey}"\n`,
      )
      .join("");
  writeFileSync(join(testHome, "config.yaml"), yaml, "utf-8");
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "hermes-compat-persist-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testHome, { recursive: true, force: true });
});

describe("custom-provider env persistence — dual-engine compat", () => {
  it("writes BOTH CUSTOM_PROVIDER_<NAME>_KEY and host-derived DEEPSEEK_API_KEY for api.deepseek.com", async () => {
    writeCustomProviders([
      {
        name: "MyDeepseek",
        provider: "custom",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-deepseek-test-123",
      },
    ]);

    const { listModels } = await freshModels();
    listModels(); // triggers seedDefaults → persists env

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYDEEPSEEK_KEY=sk-deepseek-test-123$/m,
    );
    expect(envContent).toMatch(/^DEEPSEEK_API_KEY=sk-deepseek-test-123$/m);
  });

  it("writes the host-derived form for groq and mistral too", async () => {
    writeCustomProviders([
      {
        name: "MyGroq",
        provider: "custom",
        model: "llama-x",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "gsk-groq-test",
      },
      {
        name: "MyMistral",
        provider: "custom",
        model: "mistral-large",
        baseUrl: "https://api.mistral.ai/v1",
        apiKey: "mk-mistral-test",
      },
    ]);

    const { listModels } = await freshModels();
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(/^GROQ_API_KEY=gsk-groq-test$/m);
    expect(envContent).toMatch(/^MISTRAL_API_KEY=mk-mistral-test$/m);
  });

  it("does NOT write a host-derived form for unknown hosts (no false-positive vendor binding)", async () => {
    writeCustomProviders([
      {
        name: "MyUnsloth",
        provider: "custom",
        model: "unsloth-model",
        baseUrl: "https://api.unsloth.ai/v1",
        apiKey: "sk-unsloth-test",
      },
    ]);

    const { listModels } = await freshModels();
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYUNSLOTH_KEY=sk-unsloth-test$/m,
    );
    // No UNSLOTH_API_KEY — the lookup correctly returns null for unknown hosts
    expect(envContent).not.toMatch(/^UNSLOTH_API_KEY/m);
  });

  it("does NOT shadow OPENAI_API_KEY via this path (a literal openai.com URL stays custom-prefix-only)", async () => {
    writeCustomProviders([
      {
        name: "MyOpenAI",
        provider: "custom",
        model: "gpt-x",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-custom-not-real-openai",
      },
    ]);

    const { listModels } = await freshModels();
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYOPENAI_KEY=sk-custom-not-real-openai$/m,
    );
    // OPENAI_API_KEY is reserved for the canonical OpenAI provider —
    // custom-provider entries do NOT clobber it through this path.
    expect(envContent).not.toMatch(
      /^OPENAI_API_KEY=sk-custom-not-real-openai$/m,
    );
  });

  it("does NOT shadow ANTHROPIC_API_KEY either", async () => {
    writeCustomProviders([
      {
        name: "MyAnthropic",
        provider: "custom",
        model: "claude-x",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "sk-ant-custom",
      },
    ]);

    const { listModels } = await freshModels();
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYANTHROPIC_KEY=sk-ant-custom$/m,
    );
    expect(envContent).not.toMatch(/^ANTHROPIC_API_KEY=sk-ant-custom$/m);
  });

  it("idempotent — re-running seed doesn't duplicate either env var", async () => {
    writeCustomProviders([
      {
        name: "MyDeepseek",
        provider: "custom",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-deepseek-test-123",
      },
    ]);

    // First listModels call seeds
    let { listModels } = await freshModels();
    listModels();

    // Second listModels call after a fresh module load should not append.
    ({ listModels } = await freshModels());
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    const customMatches =
      envContent.match(/^CUSTOM_PROVIDER_MYDEEPSEEK_KEY=/gm) || [];
    const deepseekMatches = envContent.match(/^DEEPSEEK_API_KEY=/gm) || [];
    expect(customMatches).toHaveLength(1);
    expect(deepseekMatches).toHaveLength(1);
  });

  it("does NOT persist the no-key-required sentinel to custom or host-derived env vars", async () => {
    writeCustomProviders([
      {
        name: "LocalDeepseekCompat",
        provider: "custom",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "no-key-required",
      },
    ]);

    const { listModels } = await freshModels();
    listModels();

    const envFile = join(testHome, ".env");
    const envContent = existsSync(envFile)
      ? readFileSync(envFile, "utf-8")
      : "";
    expect(envContent).not.toMatch(
      /^CUSTOM_PROVIDER_LOCALDEEPSEEKCOMPAT_KEY=/m,
    );
    expect(envContent).not.toMatch(/^DEEPSEEK_API_KEY=/m);
  });
});
