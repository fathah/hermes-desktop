import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * Pre-send chat readiness — exercises the main-process validator
 * against a real on-disk profile so we cover the integration with
 * getModelConfig/readEnv/expectedEnvKeyForModel without filesystem
 * mocking.
 *
 * Fail-open semantics: any *uncertain* state (unknown provider+URL,
 * exception thrown) must return `{ok: true}`. The only "block" case
 * is a known provider missing its expected env var.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-validation-${Date.now()}`);

async function freshValidation(
  home: string,
): Promise<typeof import("../src/main/validation")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/validation");
}

function writeConfig(content: string): void {
  writeFileSync(join(TEST_DIR, "config.yaml"), content);
}

function writeEnv(content: string): void {
  writeFileSync(join(TEST_DIR, ".env"), content);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("validateChatReadiness", () => {
  it("returns ok for auto provider (key check makes no sense)", async () => {
    writeConfig(["model:", "  provider: auto", "  default: ''", ""].join("\n"));
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("blocks when configured provider's API key is missing from .env", async () => {
    writeConfig(
      [
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    // .env exists but doesn't have OPENROUTER_API_KEY
    writeEnv("SOME_OTHER_KEY=irrelevant\n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("MISSING_API_KEY");
    expect(r.expectedEnvKey).toBe("OPENROUTER_API_KEY");
    expect(r.fixLocation).toBe("providers");
  });

  it("allows when configured provider's API key is present", async () => {
    writeConfig(
      [
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    writeEnv("OPENROUTER_API_KEY=sk-or-test-12345\n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("treats whitespace-only key value as missing", async () => {
    writeConfig(
      [
        "model:",
        "  provider: deepseek",
        "  default: deepseek-chat",
        "  base_url: https://api.deepseek.com/v1",
        "",
      ].join("\n"),
    );
    writeEnv("DEEPSEEK_API_KEY=   \n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness().ok).toBe(false);
  });

  it("fails open for OAuth providers (codex, qwen-oauth, etc.)", async () => {
    writeConfig(
      ["model:", "  provider: openai-codex", "  default: gpt-5-codex", ""].join(
        "\n",
      ),
    );
    // No env file at all
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  // (`nous` previously fell open here on the assumption that the
  // gateway always had its own credential cache. Issue #367 showed
  // that's not true — Nous Portal supports BOTH OAuth and API key,
  // and the user can land in a state where neither is configured.
  // The Nous-specific tests below cover the new behaviour.)

  it("fails open for localhost base_url even with no key", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://localhost:11434/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for 127.0.0.1 base_url", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://127.0.0.1:1234/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for private LAN base_url", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://192.168.1.50:1234/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for unknown provider + unknown URL (we can't decide which key to check)", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: gpt-5.5",
        "  base_url: https://www.arccodex.com/api/codex/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("blocks for custom provider on a known commercial host with no key", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: gpt-4",
        "  base_url: https://api.openai.com/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.expectedEnvKey).toBe("OPENAI_API_KEY");
  });

  // ── Nous Portal (issue #367) ─────────────────────────────────
  //
  // Nous supports both API key (NOUS_API_KEY in .env) and OAuth (token
  // cached in auth.json). The validator should fail open whenever the
  // engine has a usable credential — either source — and block only
  // when neither is present.

  it("blocks for nous provider when neither NOUS_API_KEY nor auth.json evidence is present (#367)", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    // No .env, no auth.json
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("MISSING_API_KEY");
    expect(r.expectedEnvKey).toBe("NOUS_API_KEY");
  });

  it("allows nous when NOUS_API_KEY is set in .env", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    writeEnv("NOUS_API_KEY=sk-nous-test-12345\n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("allows nous when auth.json has a properly-shaped OAuth entry", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    // No NOUS_API_KEY in .env — OAuth-only setup
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify(
        {
          version: 1,
          providers: {
            nous: {
              access_token: "oauth-token-from-nous-portal",
              refresh_token: "rt-...",
              auth_type: "oauth_device_code",
            },
          },
        },
        null,
        2,
      ),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("allows nous when credential_pool.nous has a usable entry", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify(
        {
          version: 1,
          credential_pool: {
            nous: [
              {
                id: "n1",
                label: "Key 1",
                auth_type: "api_key",
                access_token: "sk-nous-pooled-key",
                base_url: "https://inference-api.nousresearch.com/v1",
                priority: 0,
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("blocks nous when auth.json has only an empty providers entry (the wrong-schema case from #367)", async () => {
    // The exact malformed shape the credential-pool UI was writing —
    // `key` field instead of `access_token`. Engine can't read it.
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify(
        {
          version: 1,
          credential_pool: {
            nous: [
              { key: "sk-nous-but-saved-under-wrong-field", label: "Key 1" },
            ],
          },
        },
        null,
        2,
      ),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.expectedEnvKey).toBe("NOUS_API_KEY");
  });

  it("nous-api variant is also recognized", async () => {
    writeConfig(
      ["model:", "  provider: nous-api", "  default: hermes-4", ""].join("\n"),
    );
    // No creds anywhere
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.expectedEnvKey).toBe("NOUS_API_KEY");
  });
});
