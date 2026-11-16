import { describe, expect, it } from "vitest";
import {
  t,
  getLocaleDirection,
  APP_LOCALES,
  resources,
  sharedI18n,
} from "./index";

describe("shared i18n", () => {
  // @lat: [[rtl-chat#Persian locale#Complete locale registration]]
  it("registers Persian resources, RTL direction and English fallback with intact interpolation", () => {
    expect(APP_LOCALES).toContain("fa");
    expect(getLocaleDirection("fa")).toBe("rtl");
    expect(resources.fa.translation.common.save).toBe("ذخیره");
    expect(sharedI18n.hasResourceBundle("fa", "translation")).toBe(true);
    expect(t("common.save", "fa")).toBe("ذخیره");
    expect(t("common.updateAvailable", "fa", { version: "1.2.3" })).toContain(
      "1.2.3",
    );
    expect(t("welcome.title", "fa")).toBe(t("welcome.title", "en"));
  });

  it("returns English text by default", () => {
    expect(t("welcome.title")).toBe("Welcome to Hermes One");
  });

  it("falls back to the key when an English key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });

  it("returns zh-CN text when available", () => {
    expect(t("welcome.title", "zh-CN")).toBe("欢迎使用 Hermes");
  });

  it("returns Chinese Discover translations instead of falling back to English", () => {
    expect(t("discover.title", "zh-CN")).toBe("发现");
    expect(t("discover.refresh", "zh-CN")).toBe("刷新");
    expect(t("discover.searchPlaceholder", "zh-CN", { kind: "技能" })).toBe(
      "搜索技能...",
    );
    expect(t("discover.uninstallConfirm", "zh-CN", { name: "foo" })).toContain(
      "foo",
    );
    expect(t("discover.title", "zh-TW")).not.toBe(t("discover.title", "en"));
    expect(t("discover.refresh", "zh-TW")).not.toBe(
      t("discover.refresh", "en"),
    );
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
});
