import { describe, expect, it } from "vitest";
import DEFAULT_MODELS from "../src/main/default-models";

describe("DEFAULT_MODELS", () => {
  it("seeds EvoLink through the custom OpenAI-compatible endpoint path", () => {
    expect(DEFAULT_MODELS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "EvoLink GPT-5.5",
          provider: "custom",
          model: "gpt-5.5",
          baseUrl: "https://direct.evolink.ai/v1",
        }),
      ]),
    );
  });
});
