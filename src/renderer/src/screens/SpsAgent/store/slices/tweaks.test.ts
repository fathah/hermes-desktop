import { afterEach, describe, expect, it } from "vitest";
import { TWEAK_DEFAULTS } from "../../lib/theme";
import { loadTweaks, saveTweaks } from "./tweaks";

afterEach(() => {
  localStorage.clear();
});

describe("SPS tweak defaults", () => {
  it("opens new profiles on the cockpit surface", () => {
    expect(loadTweaks().homeSurface).toBe("cockpit");
  });

  it("preserves an existing customized home surface", () => {
    saveTweaks({ ...TWEAK_DEFAULTS, homeSurface: "doc" });

    expect(loadTweaks().homeSurface).toBe("doc");
  });
});
