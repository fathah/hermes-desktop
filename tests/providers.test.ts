import { describe, expect, it } from "vitest";
import { providerDoesNotNeedApiKey } from "../src/main/providers";

describe("providerDoesNotNeedApiKey", () => {
  it("treats OpenAI Codex CLI as no-key because it uses local OAuth", () => {
    expect(providerDoesNotNeedApiKey("openai-codex")).toBe(true);
  });

  it("treats OAuth subscription providers as no-key", () => {
    expect(providerDoesNotNeedApiKey("xai-oauth")).toBe(true);
    expect(providerDoesNotNeedApiKey("qwen-oauth")).toBe(true);
  });

  it("treats Vertex AI as no-key because it uses ADC or service-account credentials", () => {
    expect(providerDoesNotNeedApiKey("vertex")).toBe(true);
  });

  it("keeps API-key providers gated", () => {
    expect(providerDoesNotNeedApiKey("openai")).toBe(false);
    expect(providerDoesNotNeedApiKey("anthropic")).toBe(false);
    expect(providerDoesNotNeedApiKey("openrouter")).toBe(false);
    expect(providerDoesNotNeedApiKey("kimi-coding")).toBe(false);
  });
});
