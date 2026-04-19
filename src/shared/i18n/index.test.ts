import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("shared i18n", () => {
  it("returns English text by default", () => {
    expect(t("welcome.title")).toBe("Welcome to Hermes");
  });

  it("falls back to the key when an English key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });
});
