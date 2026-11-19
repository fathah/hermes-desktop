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

describe("Runcrate preset", () => {
  // @lat: [[provider-setup#Runcrate provider preset#Setup persistence]]
  it("keeps setup, saved model branding, discovery and credentials on the same route", () => {
    const preset = LOCAL_PRESETS.find((entry) => entry.id === "runcrate");
    expect(preset).toBeDefined();
    expect(preset?.group).toBe("remote");
    expect(preset?.baseUrl).toBe("https://api.runcrate.ai/v1");
    expect(preset?.envKey).toBe("RUNCRATE_API_KEY");
    expect(OPENAI_COMPAT_PROVIDERS.has("runcrate")).toBe(true);
    expect(canonicalProviderBaseUrl("runcrate")).toBe(preset?.baseUrl);
    expect(OPENAI_COMPATIBLE_BASE_URLS.runcrate).toBe(preset?.baseUrl);
    expect(displayBrandFromConfig("custom", preset?.baseUrl || "")).toBe(
      "runcrate",
    );
    expect(expectedEnvKeyForUrl(preset?.baseUrl)).toBe(preset?.envKey);
    expect(
      SETTINGS_SECTIONS.flatMap((section) => section.items),
    ).toContainEqual({
      key: "RUNCRATE_API_KEY",
      label: "constants.runcrateApiKey",
      type: "password",
      hint: "constants.runcrateHint",
    });
  });
});
