import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import {
  modelConfigBaseUrlForProvider,
  envKeyUsedByOtherModel,
  type SavedModel,
} from "./Models";

describe("modelConfigBaseUrlForProvider", () => {
  it("preserves explicit custom local-provider URLs when syncing the active model", () => {
    expect(
      modelConfigBaseUrlForProvider("ollama", " http://localhost:11435/v1 "),
    ).toBe("http://localhost:11435/v1");
    expect(
      modelConfigBaseUrlForProvider("lmstudio", "http://127.0.0.1:2234/v1"),
    ).toBe("http://127.0.0.1:2234/v1");
    expect(
      modelConfigBaseUrlForProvider("atomicchat", "http://localhost:1338/v1"),
    ).toBe("http://localhost:1338/v1");
  });

  it("keeps remote built-in providers on backend canonical URL substitution", () => {
    expect(
      modelConfigBaseUrlForProvider("deepseek", "https://proxy.local/v1"),
    ).toBe("");
  });

  it("preserves custom provider URLs", () => {
    expect(
      modelConfigBaseUrlForProvider("custom", " https://custom.local/v1 "),
    ).toBe("https://custom.local/v1");
  });
});

function makeModel(overrides: Partial<SavedModel>): SavedModel {
  return {
    id: "id",
    name: "name",
    provider: "custom",
    model: "model",
    baseUrl: "https://unknown-host.example/v1",
    createdAt: 0,
    ...overrides,
  };
}

describe("envKeyUsedByOtherModel", () => {
  it("is false when no other model shares the derived key, so it's safe to delete", () => {
    const models = [
      makeModel({ id: "a", name: "Alpha", baseUrl: "https://a.example/v1" }),
      makeModel({ id: "b", name: "Beta", baseUrl: "https://b.example/v1" }),
    ];
    expect(
      envKeyUsedByOtherModel("CUSTOM_PROVIDER_ALPHA_KEY", "a", models),
    ).toBe(false);
  });

  it("is true when two custom entries on a known vendor host share the vendor key", () => {
    // Both point at Groq's base URL, so both resolve to GROQ_API_KEY —
    // deleting/renaming "a" must not wipe the key "b" still relies on.
    const groqUrl = "https://api.groq.com/openai/v1";
    const models = [
      makeModel({ id: "a", name: "My Groq", baseUrl: groqUrl }),
      makeModel({ id: "b", name: "Other Groq", baseUrl: groqUrl }),
    ];
    expect(envKeyUsedByOtherModel("GROQ_API_KEY", "a", models)).toBe(true);
  });

  it("is true when two unknown-URL custom entries derive the same name-based key", () => {
    const models = [
      makeModel({ id: "a", name: "Same Name", baseUrl: "https://a.example/v1" }),
      makeModel({ id: "b", name: "Same Name", baseUrl: "https://b.example/v1" }),
    ];
    expect(
      envKeyUsedByOtherModel("CUSTOM_PROVIDER_SAME_NAME_KEY", "a", models),
    ).toBe(true);
  });
});
