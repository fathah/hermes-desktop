import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("shared i18n", () => {
  it("returns Chinese text by default", () => {
    expect(t("welcome.title")).toBe("欢迎使用 Hermes");
  });

  it("falls back to the key when a Chinese key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });
});
