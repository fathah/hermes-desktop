import { describe, expect, it } from "vitest";
import DEFAULT_MODELS from "../src/main/default-models";

describe("default models", () => {
  it("seeds saved model affordances for Qwen OAuth, Kimi, DeepSeek, and GLM", () => {
    const byProvider = new Map(DEFAULT_MODELS.map((m) => [m.provider, m]));

    expect(byProvider.get("qwen-oauth")?.model).toBe("qwen3-coder-plus");
    expect(byProvider.get("kimi-coding")?.model).toBe("kimi-for-coding");
    expect(byProvider.get("deepseek")?.model).toBe("deepseek-chat");
    expect(byProvider.get("zai")?.model).toBe("glm-5");
  });
});
