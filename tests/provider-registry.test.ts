import { describe, it, expect } from "vitest";
import {
  PROVIDER_BASE_URLS,
  canonicalProviderBaseUrl,
} from "../src/main/provider-registry";

describe("provider-registry", () => {
  describe("canonicalProviderBaseUrl", () => {
    it("returns the canonical URL for built-in OpenAI-compatible providers", () => {
      expect(canonicalProviderBaseUrl("deepseek")).toBe(
        "https://api.deepseek.com/v1",
      );
      expect(canonicalProviderBaseUrl("groq")).toBe(
        "https://api.groq.com/openai/v1",
      );
      expect(canonicalProviderBaseUrl("mistral")).toBe(
        "https://api.mistral.ai/v1",
      );
      expect(canonicalProviderBaseUrl("together")).toBe(
        "https://api.together.xyz/v1",
      );
      expect(canonicalProviderBaseUrl("fireworks")).toBe(
        "https://api.fireworks.ai/inference/v1",
      );
      expect(canonicalProviderBaseUrl("cerebras")).toBe(
        "https://api.cerebras.ai/v1",
      );
    });

    it("returns the canonical URL for the Big3 (openai / anthropic / openrouter)", () => {
      expect(canonicalProviderBaseUrl("openai")).toBe(
        "https://api.openai.com/v1",
      );
      expect(canonicalProviderBaseUrl("anthropic")).toBe(
        "https://api.anthropic.com/v1",
      );
      expect(canonicalProviderBaseUrl("openrouter")).toBe(
        "https://openrouter.ai/api/v1",
      );
    });

    it("returns the canonical URL for xai and xai-oauth providers", () => {
      expect(canonicalProviderBaseUrl("xai")).toBe("https://api.x.ai/v1");
      expect(canonicalProviderBaseUrl("xai-oauth")).toBe("https://api.x.ai/v1");
    });

    it("returns canonical URLs for Qwen OAuth, Kimi, and GLM providers", () => {
      expect(canonicalProviderBaseUrl("qwen-oauth")).toBe(
        "https://portal.qwen.ai/v1",
      );
      expect(canonicalProviderBaseUrl("kimi-coding")).toBe(
        "https://api.moonshot.ai/v1",
      );
      expect(canonicalProviderBaseUrl("zai")).toBe(
        "https://api.z.ai/api/paas/v4",
      );
      expect(canonicalProviderBaseUrl("glm")).toBe(
        "https://api.z.ai/api/paas/v4",
      );
    });

    it("is case-insensitive on the provider id", () => {
      expect(canonicalProviderBaseUrl("DeepSeek")).toBe(
        "https://api.deepseek.com/v1",
      );
      expect(canonicalProviderBaseUrl("MISTRAL")).toBe(
        "https://api.mistral.ai/v1",
      );
    });

    it("returns null for providers that don't have a canonical URL", () => {
      // `custom` and `auto` are intentionally not in the registry — the
      // user must supply their own baseUrl.
      expect(canonicalProviderBaseUrl("custom")).toBeNull();
      expect(canonicalProviderBaseUrl("auto")).toBeNull();
      // Unknown/user-defined provider ids.
      expect(canonicalProviderBaseUrl("my-private-llm")).toBeNull();
      expect(canonicalProviderBaseUrl("")).toBeNull();
    });

    it("the registry covers every built-in remote OpenAI-compat provider", () => {
      // These are the provider ids that hermes-desktop's renderer
      // exposes as built-in "remote" presets (constants.ts:LOCAL_PRESETS,
      // group: "remote"). They MUST have canonical URLs here — otherwise
      // setModelConfig would silently leave `base_url:` empty when the
      // user picks them, which is the regression this module exists to
      // prevent.
      const requiredBuiltins = [
        "groq",
        "deepseek",
        "kimi-coding",
        "zai",
        "together",
        "fireworks",
        "cerebras",
        "mistral",
      ];
      for (const provider of requiredBuiltins) {
        expect(PROVIDER_BASE_URLS[provider]).toBeTruthy();
      }
    });
  });
});
