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

describe("Standard Compute preset", () => {
  // @lat: [[provider-setup#Standard Compute provider preset#Setup persistence]]
  it("keeps setup, saved model branding, discovery and credentials on the same route", () => {
    const preset = LOCAL_PRESETS.find(
      (entry) => entry.id === "standardcompute",
    );
    expect(preset).toBeDefined();
    expect(preset?.group).toBe("remote");
    expect(preset?.baseUrl).toBe("https://api.stdcmpt.com/v1");
    expect(preset?.envKey).toBe("STDCMPT_API_KEY");
    expect(OPENAI_COMPAT_PROVIDERS.has("standardcompute")).toBe(true);
    expect(canonicalProviderBaseUrl("standardcompute")).toBe(preset?.baseUrl);
    expect(OPENAI_COMPATIBLE_BASE_URLS.standardcompute).toBe(preset?.baseUrl);
    expect(displayBrandFromConfig("custom", preset?.baseUrl || "")).toBe(
      "standardcompute",
    );
    expect(expectedEnvKeyForUrl(preset?.baseUrl)).toBe(preset?.envKey);
    expect(
      SETTINGS_SECTIONS.flatMap((section) => section.items),
    ).toContainEqual({
      key: "STDCMPT_API_KEY",
      label: "constants.standardcomputeApiKey",
      type: "password",
      hint: "constants.standardcomputeHint",
    });
  });
});
