import { describe, expect, it } from "vitest";
import {
  URL_KEY_MAP,
  expectedEnvKeyForUrl,
  isLocalBaseUrl,
  isKnownProviderUrl,
  CUSTOM_API_KEY_ENV,
} from "../src/shared/url-key-map";

/**
 * The shared URL → env-var-name table backs three call sites:
 *   - Gateway spawn env hydration (main/hermes.ts)
 *   - Edit Model dialog API-key read-back (renderer/Models.tsx)
 *   - Setup wizard's custom-host save path (renderer/Setup.tsx)
 *
 * Whenever one of those drifts, users with a key configured under one
 * env-var name see the gateway look for a different one and fail with a
 * 401 from the upstream provider. Pin the contract.
 */

describe("URL_KEY_MAP", () => {
  it("covers each known commercial OpenAI-compatible host", () => {
    const expected: Record<string, string> = {
      "https://openrouter.ai/api/v1": "OPENROUTER_API_KEY",
      "https://api.anthropic.com/v1": "ANTHROPIC_API_KEY",
      "https://api.openai.com/v1": "OPENAI_API_KEY",
      "https://huggingface.co/api": "HF_TOKEN",
      "https://api.groq.com/openai/v1": "GROQ_API_KEY",
      "https://api.deepseek.com/v1": "DEEPSEEK_API_KEY",
      "https://api.together.xyz/v1": "TOGETHER_API_KEY",
      "https://api.fireworks.ai/inference/v1": "FIREWORKS_API_KEY",
      "https://api.cerebras.ai/v1": "CEREBRAS_API_KEY",
      "https://api.mistral.ai/v1": "MISTRAL_API_KEY",
      "https://api.perplexity.ai": "PERPLEXITY_API_KEY",
    };
    for (const [url, envKey] of Object.entries(expected)) {
      expect(expectedEnvKeyForUrl(url)).toBe(envKey);
    }
  });

  it("matches case-insensitively (URL the user typed may vary in case)", () => {
    expect(expectedEnvKeyForUrl("https://OpenRouter.ai/api/v1")).toBe(
      "OPENROUTER_API_KEY",
    );
    expect(expectedEnvKeyForUrl("HTTPS://API.OPENAI.COM/V1")).toBe(
      "OPENAI_API_KEY",
    );
  });

  it("falls back to CUSTOM_API_KEY for unknown hosts", () => {
    expect(expectedEnvKeyForUrl("https://www.arccodex.com/api/codex/v1")).toBe(
      CUSTOM_API_KEY_ENV,
    );
    expect(expectedEnvKeyForUrl("http://localhost:11434/v1")).toBe(
      CUSTOM_API_KEY_ENV,
    );
    expect(expectedEnvKeyForUrl("http://192.168.1.50:1234/v1")).toBe(
      CUSTOM_API_KEY_ENV,
    );
  });

  it("treats empty / null / undefined URL as CUSTOM_API_KEY", () => {
    expect(expectedEnvKeyForUrl("")).toBe(CUSTOM_API_KEY_ENV);
    expect(expectedEnvKeyForUrl(null)).toBe(CUSTOM_API_KEY_ENV);
    expect(expectedEnvKeyForUrl(undefined)).toBe(CUSTOM_API_KEY_ENV);
  });

  it("matches by hostname substring (path doesn't matter)", () => {
    expect(expectedEnvKeyForUrl("https://openrouter.ai")).toBe(
      "OPENROUTER_API_KEY",
    );
    expect(
      expectedEnvKeyForUrl("https://openrouter.ai/api/v1/chat/completions"),
    ).toBe("OPENROUTER_API_KEY");
  });
});

describe("isKnownProviderUrl", () => {
  it("returns true for hosts in URL_KEY_MAP", () => {
    expect(isKnownProviderUrl("https://api.openai.com/v1")).toBe(true);
    expect(isKnownProviderUrl("https://openrouter.ai/api/v1")).toBe(true);
  });

  it("returns false for unknown hosts and falsy inputs", () => {
    expect(isKnownProviderUrl("https://example.com")).toBe(false);
    expect(isKnownProviderUrl("http://localhost:11434")).toBe(false);
    expect(isKnownProviderUrl("")).toBe(false);
    expect(isKnownProviderUrl(null)).toBe(false);
    expect(isKnownProviderUrl(undefined)).toBe(false);
  });
});

describe("isLocalBaseUrl", () => {
  it("recognizes localhost, loopback, and private LAN base URLs", () => {
    const localUrls = [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://0.0.0.0:1234/v1",
      "http://[::1]:1234/v1",
      "http://192.168.1.50:1234/v1",
      "http://10.0.0.12:1234/v1",
      "http://172.16.4.2:1234/v1",
      "http://172.31.4.2:1234/v1",
    ];
    for (const url of localUrls) {
      expect(isLocalBaseUrl(url)).toBe(true);
    }
  });

  it("does not treat public provider hosts as local", () => {
    expect(isLocalBaseUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLocalBaseUrl("https://openrouter.ai/api/v1")).toBe(false);
    expect(isLocalBaseUrl("http://172.32.0.1:1234/v1")).toBe(false);
    expect(isLocalBaseUrl("")).toBe(false);
    expect(isLocalBaseUrl(null)).toBe(false);
    expect(isLocalBaseUrl(undefined)).toBe(false);
  });
});

describe("URL_KEY_MAP shape", () => {
  it("every entry has a unique env var name", () => {
    const envKeys = URL_KEY_MAP.map((m) => m.envKey);
    expect(new Set(envKeys).size).toBe(envKeys.length);
  });

  it("every pattern is case-insensitive", () => {
    for (const { pattern } of URL_KEY_MAP) {
      expect(pattern.flags).toContain("i");
    }
  });
});
