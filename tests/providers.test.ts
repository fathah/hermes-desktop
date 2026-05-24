import { describe, expect, it } from "vitest";
import { providerDoesNotNeedApiKey } from "../src/main/providers";

describe("providerDoesNotNeedApiKey", () => {
  it("treats OpenAI Codex CLI as no-key because it uses local OAuth", () => {
    expect(providerDoesNotNeedApiKey("openai-codex")).toBe(true);
  });

  it("keeps API-key providers gated", () => {
    expect(providerDoesNotNeedApiKey("openai")).toBe(false);
    expect(providerDoesNotNeedApiKey("anthropic")).toBe(false);
    expect(providerDoesNotNeedApiKey("openrouter")).toBe(false);
  });
});
