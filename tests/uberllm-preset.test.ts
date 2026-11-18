import { describe, expect, it } from "vitest";
import {
  LOCAL_PRESETS,
  OPENAI_COMPATIBLE_BASE_URLS,
  SETTINGS_SECTIONS,
  displayBrandFromConfig,
} from "../src/renderer/src/constants";
import { canonicalProviderBaseUrl } from "../src/main/provider-registry";
import {
  OPENAI_COMPAT_PROVIDERS,
  expectedEnvKeyForUrl,
} from "../src/shared/url-key-map";

describe("UberLLM preset", () => {
  // @lat: [[provider-setup#UberLLM provider preset#Setup persistence]]
  it("keeps setup, saved model branding, discovery and credentials on the same route", () => {
    const preset = LOCAL_PRESETS.find((entry) => entry.id === "uberllm");
    expect(preset).toBeDefined();
    expect(preset?.group).toBe("remote");
    expect(preset?.baseUrl).toBe("https://api.uberllm.dev/v1");
    expect(preset?.envKey).toBe("UBERLLM_API_KEY");
    expect(OPENAI_COMPAT_PROVIDERS.has("uberllm")).toBe(true);
    expect(canonicalProviderBaseUrl("uberllm")).toBe(preset?.baseUrl);
    expect(OPENAI_COMPATIBLE_BASE_URLS.uberllm).toBe(preset?.baseUrl);
    expect(displayBrandFromConfig("custom", preset?.baseUrl || "")).toBe(
      "uberllm",
    );
    expect(expectedEnvKeyForUrl(preset?.baseUrl)).toBe(preset?.envKey);
    expect(
      SETTINGS_SECTIONS.flatMap((section) => section.items),
    ).toContainEqual({
      key: "UBERLLM_API_KEY",
      label: "constants.uberllmApiKey",
      type: "password",
      hint: "constants.uberllmHint",
    });
  });
});
