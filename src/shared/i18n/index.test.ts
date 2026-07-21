import { describe, expect, it } from "vitest";
import { APP_LOCALES, resources, t, getLocaleDirection } from "./index";

function collectKeys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [];

  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return value && typeof value === "object"
        ? collectKeys(value, path)
        : [path];
    },
  );
}

describe("shared i18n", () => {
  it("returns English text by default", () => {
    expect(t("welcome.title")).toBe("Welcome to Hermes One");
  });

  it("falls back to the key when an English key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });

  it("returns zh-CN text when available", () => {
    expect(t("welcome.title", "zh-CN")).toBe("欢迎使用 Hermes");
  });

  it("returns zh-TW text when available", () => {
    expect(t("welcome.title", "zh-TW")).toBe("歡迎使用 Hermes");
  });

  it("returns es text when available", () => {
    expect(t("welcome.title", "es")).toBe("Bienvenido a Hermes");
  });

  it("returns id text when available", () => {
    expect(t("welcome.title", "id")).toBe("Selamat datang di Hermes");
  });

  it("returns pl text when available", () => {
    expect(t("welcome.title", "pl")).toBe("Witamy w Hermes");
  });

  it("returns he text when available", () => {
    expect(t("welcome.title", "he")).toBe("ברוכים הבאים ל-Hermes");
  });

  it("reports he as a right-to-left locale", () => {
    expect(getLocaleDirection("he")).toBe("rtl");
    expect(getLocaleDirection("en")).toBe("ltr");
  });

  it("returns ru text when available", () => {
    expect(APP_LOCALES).toContain("ru");
    expect(t("welcome.title", "ru")).toBe("Добро пожаловать в Hermes");
  });

  it("keeps ru translation keys aligned with en", () => {
    expect(collectKeys(resources.ru.translation).sort()).toEqual(
      collectKeys(resources.en.translation).sort(),
    );
  });

  it("falls back to en when zh-CN key is missing", () => {
    expect(t("nonExistent.fallbackKey", "zh-CN")).toBe(
      "nonExistent.fallbackKey",
    );
  });

  it("preserves interpolation placeholders in es", () => {
    expect(t("common.updateAvailable", "es", { version: "1.2.3" })).toBe(
      "Actualizar a v1.2.3",
    );
  });

  it("preserves interpolation placeholders in pl", () => {
    expect(t("common.updateAvailable", "pl", { version: "1.2.3" })).toBe(
      "Aktualizacja v1.2.3",
    );
  });

  it("preserves interpolation placeholders in ru", () => {
    expect(t("common.updateAvailable", "ru", { version: "1.2.3" })).toBe(
      "Обновить до v1.2.3",
    );
  });
});
