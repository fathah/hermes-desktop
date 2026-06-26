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
  const yaml =
    "custom_providers:\n" +
    entries
      .map(
        (entry) =>
          `  - name: "${entry.name}"\n` +
          `    provider: "${entry.provider}"\n` +
          `    model: "${entry.model}"\n` +
          `    base_url: "${entry.baseUrl}"\n` +
          `    api_key: "${entry.apiKey}"\n`,
      )
      .join("");
  writeFileSync(join(testHome, "config.yaml"), yaml, "utf-8");
}

describe("custom-provider env persistence host-derived compatibility", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-compat-persist-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("writes both the custom-provider key and host-derived DEEPSEEK_API_KEY", async () => {
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
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYDEEPSEEK_KEY=sk-deepseek-test-123$/m,
    );
    expect(envContent).toMatch(/^DEEPSEEK_API_KEY=sk-deepseek-test-123$/m);
  });

  it("writes host-derived keys for other mapped vendors", async () => {
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

  it("does not write a host-derived key for unknown hosts", async () => {
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
    expect(envContent).not.toMatch(/^UNSLOTH_API_KEY=/m);
  });

  it("does not shadow OpenAI or Anthropic provider keys", async () => {
    writeCustomProviders([
      {
        name: "MyOpenAI",
        provider: "custom",
        model: "gpt-x",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-custom-openai",
      },
      {
        name: "MyAnthropic",
        provider: "custom",
        model: "claude-x",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "sk-custom-anthropic",
      },
    ]);

    const { listModels } = await freshModels();
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYOPENAI_KEY=sk-custom-openai$/m,
    );
    expect(envContent).toMatch(
      /^CUSTOM_PROVIDER_MYANTHROPIC_KEY=sk-custom-anthropic$/m,
    );
    expect(envContent).not.toMatch(/^OPENAI_API_KEY=sk-custom-openai$/m);
    expect(envContent).not.toMatch(/^ANTHROPIC_API_KEY=sk-custom-anthropic$/m);
  });

  it("does not duplicate either env var on repeated seeding", async () => {
    writeCustomProviders([
      {
        name: "MyDeepseek",
        provider: "custom",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-deepseek-test-123",
      },
    ]);

    let { listModels } = await freshModels();
    listModels();
    ({ listModels } = await freshModels());
    listModels();

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent.match(/^CUSTOM_PROVIDER_MYDEEPSEEK_KEY=/gm)).toHaveLength(
      1,
    );
    expect(envContent.match(/^DEEPSEEK_API_KEY=/gm)).toHaveLength(1);
  });

  it("does not persist the no-key-required sentinel", async () => {
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
