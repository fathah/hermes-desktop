import { describe, expect, it } from "vitest";
import { APP_LOCALES, resources, setLocale, t, type AppLocale } from "./index";

describe("shared i18n", () => {
  it("exposes English as the only runtime locale", () => {
    expect(APP_LOCALES).toEqual(["en"]);
    expect(Object.keys(resources)).toEqual(["en"]);
  });

  it("returns English text by default", () => {
    expect(t("welcome.title")).toBe("Welcome to SPS");
  });

  it("falls back to the key when an English key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });

  it("uses SPS-first English labels for employee-facing surfaces", () => {
    expect(t("common.appName")).toBe("SPS");
    expect(t("navigation.controlCenterTitle")).toBe("SPS Control Center");
    expect(t("navigation.overview")).toBe("Overview");
    expect(t("navigation.aiSetup")).toBe("AI Setup");
    expect(t("navigation.connectedApps")).toBe("Connected Apps");
    expect(t("navigation.troubleshooting")).toBe("Troubleshooting");
    expect(t("settings.runDiagnosis")).toBe("Run Health Check");
    expect(t("settings.debugDump")).toBe("Create Debug Report");
  });

  it("normalizes stale non-English runtime locale values to English", () => {
    expect(setLocale("es" as unknown as AppLocale)).toBe("en");
    expect(t("welcome.title")).toBe("Welcome to SPS");
  });

  it("preserves interpolation placeholders in English", () => {
    expect(t("common.updateAvailable", "en", { version: "1.2.3" })).toBe(
      "Update v1.2.3",
    );
  });

  it("keeps recall-sqlite memory provider copy in the English registry", () => {
    expect(t("memory.providers.recall-sqlite")).toBe(
      "Local SQLite recall store with FTS search and no API key required.",
    );
  });
});
