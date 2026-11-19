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

describe("AI Stupid Level preset", () => {
  // @lat: [[provider-setup#AI Stupid Level provider preset#Setup persistence]]
  it("keeps setup, saved model branding, discovery and credentials on the same route", () => {
    const preset = LOCAL_PRESETS.find((entry) => entry.id === "aistupidlevel");
    expect(preset).toBeDefined();
    expect(preset?.group).toBe("remote");
    expect(preset?.baseUrl).toBe("https://aistupidlevel.info/v1");
    expect(preset?.envKey).toBe("AISTUPIDLEVEL_API_KEY");
    expect(OPENAI_COMPAT_PROVIDERS.has("aistupidlevel")).toBe(true);
    expect(canonicalProviderBaseUrl("aistupidlevel")).toBe(preset?.baseUrl);
    expect(OPENAI_COMPATIBLE_BASE_URLS.aistupidlevel).toBe(preset?.baseUrl);
    expect(displayBrandFromConfig("custom", preset?.baseUrl || "")).toBe(
      "aistupidlevel",
    );
    expect(expectedEnvKeyForUrl(preset?.baseUrl)).toBe(preset?.envKey);
    expect(
      SETTINGS_SECTIONS.flatMap((section) => section.items),
    ).toContainEqual({
      key: "AISTUPIDLEVEL_API_KEY",
      label: "constants.aistupidlevelApiKey",
      type: "password",
      hint: "constants.aistupidlevelHint",
    });
  });
});
