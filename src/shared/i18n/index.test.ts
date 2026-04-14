import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("shared i18n", () => {
  it("returns zh-CN text when available", () => {
    expect(t("welcome.title", "zh-CN")).toBe("欢迎使用 Hermes");
  });

  it("falls back to en when zh-CN key is missing", () => {
    expect(t("common.devOnly", "zh-CN")).toBe("Developer only");
  });
});
