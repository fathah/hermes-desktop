import { describe, it, expect } from "vitest";
import { validateSkin, skinToCssVars } from "../src/shared/skins";
import { skinToSpsVars } from "../src/renderer/src/screens/SpsAgent/lib/skin";

describe("validateSkin", () => {
  it("accepts a well-formed skin", () => {
    const res = validateSkin({
      name: "Midnight",
      colors: { accent: "#5b8def", background: "#0b0d12" },
      fonts: { body: "Inter", mono: "JetBrains Mono" },
      density: "compact",
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.skin?.name).toBe("Midnight");
    expect(res.skin?.colors?.accent).toBe("#5b8def");
    expect(res.skin?.density).toBe("compact");
  });

  it("rejects a skin with no name", () => {
    expect(validateSkin({ colors: { accent: "#fff" } }).valid).toBe(false);
    expect(validateSkin("nope").valid).toBe(false);
    expect(validateSkin(null).valid).toBe(false);
  });

  it("trims the name", () => {
    expect(validateSkin({ name: "  Solar  " }).skin?.name).toBe("Solar");
  });

  it("drops non-string colors but keeps valid ones, reporting errors", () => {
    const res = validateSkin({
      name: "x",
      colors: { accent: "#fff", bad: 123 },
    });
    expect(res.valid).toBe(true);
    expect(res.skin?.colors).toEqual({ accent: "#fff" });
    expect(res.errors.some((e) => e.includes("bad"))).toBe(true);
  });

  it("rejects an invalid density value", () => {
    const res = validateSkin({ name: "x", density: "huge" });
    expect(res.skin?.density).toBeUndefined();
    expect(res.errors.some((e) => e.includes("density"))).toBe(true);
  });

  it("ignores fonts when not an object", () => {
    const res = validateSkin({ name: "x", fonts: "Inter" });
    expect(res.skin?.fonts).toBeUndefined();
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

describe("skinToCssVars", () => {
  it("maps known color tokens and fonts to CSS variables", () => {
    const vars = skinToCssVars({
      name: "x",
      colors: { accent: "#abc", text: "#111", unknownToken: "#999" },
      fonts: { body: "Inter", mono: "Menlo" },
    });
    expect(vars["--accent"]).toBe("#abc");
    expect(vars["--text-primary"]).toBe("#111");
    expect(vars["--font-body"]).toBe("Inter");
    expect(vars["--font-mono"]).toBe("Menlo");
    // unknown token does not map to any variable
    expect(Object.values(vars)).not.toContain("#999");
  });

  it("returns an empty map for a bare skin", () => {
    expect(skinToCssVars({ name: "x" })).toEqual({});
  });
});

describe("skinToSpsVars (SPS scope mapping)", () => {
  it("maps semantic tokens to SPS variable names", () => {
    const vars = skinToSpsVars({
      name: "Midnight",
      colors: {
        accent: "#5b8def",
        background: "#0b0d12",
        surface: "#15181f",
        text: "#e8e8e8",
        textSecondary: "#b0b0b0",
        textMuted: "#808080",
        border: "#2a2d35",
      },
      fonts: { body: "Inter", mono: "JetBrains Mono" },
    });
    expect(vars["--accent"]).toBe("#5b8def");
    // background drives both the app well and the document canvas
    expect(vars["--app-bg"]).toBe("#0b0d12");
    expect(vars["--canvas"]).toBe("#0b0d12");
    expect(vars["--surface"]).toBe("#15181f");
    expect(vars["--tx-1"]).toBe("#e8e8e8");
    expect(vars["--tx-2"]).toBe("#b0b0b0");
    expect(vars["--tx-3"]).toBe("#808080");
    expect(vars["--hairline"]).toBe("#2a2d35");
    expect(vars["--font-sans"]).toBe("Inter");
    expect(vars["--font-mono"]).toBe("JetBrains Mono");
  });

  it("only sets variables for tokens the skin specifies", () => {
    const vars = skinToSpsVars({
      name: "AccentOnly",
      colors: { accent: "#abc" },
    });
    expect(vars).toEqual({ "--accent": "#abc" });
  });

  it("returns an empty map for null / bare skin", () => {
    expect(skinToSpsVars(null)).toEqual({});
    expect(skinToSpsVars({ name: "x" })).toEqual({});
  });

  it("ignores unknown color tokens", () => {
    const vars = skinToSpsVars({
      name: "x",
      colors: { accent: "#abc", mystery: "#999" },
    });
    expect(Object.values(vars)).not.toContain("#999");
  });

  it("maps border to Sps border variables", () => {
    const vars = skinToSpsVars({
      name: "Borders",
      colors: { border: "#f0f" },
    });
    expect(vars["--hairline"]).toBe("#f0f");
    expect(vars["--hair"]).toBe("#f0f");
    expect(vars["--hair-soft"]).toBe("#f0f");
    expect(vars["--hair-strong"]).toBe("#f0f");
  });
});
