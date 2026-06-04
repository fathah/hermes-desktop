import { describe, it, expect } from "vitest";
import { contextWindowForModel, DEFAULT_CONTEXT_WINDOW } from "./contextWindows";

describe("contextWindowForModel", () => {
  it("maps Groq's Llama / GPT-OSS models to 131072", () => {
    expect(contextWindowForModel("llama-3.1-8b-instant")).toBe(131072);
    expect(contextWindowForModel("llama-3.3-70b-versatile")).toBe(131072);
    expect(contextWindowForModel("openai/gpt-oss-20b")).toBe(131072);
  });

  it("maps known commercial families", () => {
    expect(contextWindowForModel("gpt-4o-mini")).toBe(128000);
    expect(contextWindowForModel("claude-sonnet-4-6")).toBe(200000);
    expect(contextWindowForModel("deepseek-chat")).toBe(65536);
  });

  it("is case-insensitive", () => {
    expect(contextWindowForModel("LLAMA-3.1-8B-INSTANT")).toBe(131072);
  });

  it("falls back to the default for unknown models and empty input", () => {
    expect(contextWindowForModel("some-unknown-model")).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
    expect(contextWindowForModel(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowForModel(null)).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});
