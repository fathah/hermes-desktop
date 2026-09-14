import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedOAuthPickerProviders,
  type LibModel,
} from "../src/renderer/src/screens/Providers/provider-picker";

describe("authenticated OAuth provider picker entries", () => {
  // @lat: [[provider-setup#Provider setup#Active model is picked from configured providers#Authenticated OAuth providers are selectable]]
  it("includes an authenticated Codex plan without an API key or saved models", () => {
    const providers = buildAuthenticatedOAuthPickerProviders(
      { "openai-codex": true },
      new Map(),
    );

    expect(providers).toEqual([
      {
        key: "brand:openai-codex",
        brand: "openai-codex",
        label: "ChatGPT (Codex Plan)",
        provider: "openai-codex",
        baseUrl: "",
        keyEnv: "",
        models: [],
      },
    ]);
  });

  it("attaches saved OAuth models and omits unauthenticated plans", () => {
    const codexModel: LibModel = {
      id: "codex",
      name: "GPT-5 Codex",
      provider: "openai-codex",
      model: "gpt-5-codex",
      baseUrl: "",
    };
    const providers = buildAuthenticatedOAuthPickerProviders(
      { "openai-codex": true, "xai-oauth": false },
      new Map([["openai-codex", [codexModel]]]),
    );

    expect(providers).toHaveLength(1);
    expect(providers[0].models).toEqual([codexModel]);
  });

  it("does not duplicate an OAuth provider already configured by API key", () => {
    const providers = buildAuthenticatedOAuthPickerProviders(
      { nous: true },
      new Map(),
      new Set(["nous"]),
    );

    expect(providers).toEqual([]);
  });
});
