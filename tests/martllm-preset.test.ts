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

describe("MartLLM preset", () => {
  // @lat: [[provider-setup#MartLLM provider preset#Setup persistence]]
  it("keeps setup, saved model branding, discovery and credentials on the same route", () => {
    const preset = LOCAL_PRESETS.find((entry) => entry.id === "martllm");
    expect(preset).toBeDefined();
    expect(preset?.group).toBe("remote");
    expect(preset?.baseUrl).toBe("https://api.martllm.com/v1");
    expect(preset?.envKey).toBe("MARTLLM_API_KEY");
    expect(OPENAI_COMPAT_PROVIDERS.has("martllm")).toBe(true);
    expect(canonicalProviderBaseUrl("martllm")).toBe(preset?.baseUrl);
    expect(OPENAI_COMPATIBLE_BASE_URLS.martllm).toBe(preset?.baseUrl);
    expect(displayBrandFromConfig("custom", preset?.baseUrl || "")).toBe(
      "martllm",
    );
    expect(expectedEnvKeyForUrl(preset?.baseUrl)).toBe(preset?.envKey);
    expect(
      SETTINGS_SECTIONS.flatMap((section) => section.items),
    ).toContainEqual({
      key: "MARTLLM_API_KEY",
      label: "constants.martllmApiKey",
      type: "password",
      hint: "constants.martllmHint",
    });
  });
});
