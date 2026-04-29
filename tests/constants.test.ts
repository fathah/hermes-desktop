import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  GATEWAY_PLATFORMS,
  GATEWAY_SECTIONS,
  SETTINGS_SECTIONS,
  LOCAL_PRESETS,
  THEME_OPTIONS,
} from "../src/renderer/src/constants";

// ─── PROVIDERS ──────────────────────────────────────────

describe("PROVIDERS", () => {
  it("has auto-detect as first option", () => {
    expect(PROVIDERS.options[0]).toEqual({
      value: "auto",
      label: "Auto-detect",
    });
  });

  it("includes all v0.9.0 providers", () => {
    const values = PROVIDERS.options.map((o) => o.value);
    expect(values).toContain("openrouter");
    expect(values).toContain("anthropic");
    expect(values).toContain("openai");
    expect(values).toContain("google");
    expect(values).toContain("xai");
    expect(values).toContain("nous");
    expect(values).toContain("qwen");
    expect(values).toContain("minimax");
    expect(values).toContain("custom");
  });

  it("has labels for every non-auto provider option", () => {
    for (const opt of PROVIDERS.options) {
      if (opt.value === "auto") continue;
      expect(PROVIDERS.labels[opt.value]).toBeTruthy();
    }
  });

  it("setup entries have required fields", () => {
    for (const entry of PROVIDERS.setup) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.configProvider).toBeTruthy();
      expect(typeof entry.needsKey).toBe("boolean");
    }
  });

  it("setup entries that need a key have envKey and url", () => {
    for (const entry of PROVIDERS.setup) {
      if (entry.needsKey) {
        expect(entry.envKey).toBeTruthy();
        expect(entry.url).toBeTruthy();
      }
    }
  });

  it("no duplicate option values", () => {
    const values = PROVIDERS.options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("no duplicate setup IDs", () => {
    const ids = PROVIDERS.setup.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── GATEWAY_PLATFORMS ──────────────────────────────────

describe("GATEWAY_PLATFORMS", () => {
  it("has 16 platforms (matching v0.9.0 release)", () => {
    expect(GATEWAY_PLATFORMS.length).toBe(16);
  });

  it("includes all core platforms", () => {
    const keys = GATEWAY_PLATFORMS.map((p) => p.key);
    expect(keys).toContain("telegram");
    expect(keys).toContain("discord");
    expect(keys).toContain("slack");
    expect(keys).toContain("whatsapp");
    expect(keys).toContain("signal");
    expect(keys).toContain("matrix");
    expect(keys).toContain("email");
    expect(keys).toContain("sms");
    expect(keys).toContain("bluebubbles"); // iMessage
    expect(keys).toContain("dingtalk");
    expect(keys).toContain("feishu");
    expect(keys).toContain("wecom");
    expect(keys).toContain("weixin"); // WeChat
    expect(keys).toContain("webhooks");
    expect(keys).toContain("home_assistant");
    expect(keys).toContain("mattermost");
  });

  it("no duplicate platform keys", () => {
    const keys = GATEWAY_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every platform has at least one field", () => {
    for (const p of GATEWAY_PLATFORMS) {
      expect(p.fields.length).toBeGreaterThan(0);
    }
  });

  it("every platform has label and description", () => {
    for (const p of GATEWAY_PLATFORMS) {
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("every platform field exists in GATEWAY_SECTIONS", () => {
    const allSectionKeys = new Set(
      GATEWAY_SECTIONS.flatMap((s) => s.items.map((i) => i.key)),
    );
    for (const p of GATEWAY_PLATFORMS) {
      for (const field of p.fields) {
        expect(allSectionKeys.has(field)).toBe(true);
      }
    }
  });
});

// ─── GATEWAY_SECTIONS ───────────────────────────────────

describe("GATEWAY_SECTIONS", () => {
  it("has at least one section", () => {
    expect(GATEWAY_SECTIONS.length).toBeGreaterThan(0);
  });

  it("every item has key, label, type, hint", () => {
    for (const section of GATEWAY_SECTIONS) {
      for (const item of section.items) {
        expect(item.key).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.type).toBeTruthy();
        expect(typeof item.hint).toBe("string");
      }
    }
  });

  it("no duplicate field keys across sections", () => {
    const allKeys = GATEWAY_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it("password type fields contain sensitive keywords", () => {
    for (const section of GATEWAY_SECTIONS) {
      for (const item of section.items) {
        if (item.type === "password") {
          const lk = item.key.toLowerCase();
          expect(
            lk.includes("token") ||
              lk.includes("key") ||
              lk.includes("secret") ||
              lk.includes("password"),
          ).toBe(true);
        }
      }
    }
  });
});

// ─── SETTINGS_SECTIONS ──────────────────────────────────

describe("SETTINGS_SECTIONS", () => {
  it("includes LLM Providers section", () => {
    expect(
      SETTINGS_SECTIONS.find((s) => s.title === "LLM Providers"),
    ).toBeTruthy();
  });

  it("includes Google AI Studio and xAI keys", () => {
    const allKeys = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(allKeys).toContain("GOOGLE_API_KEY");
    expect(allKeys).toContain("XAI_API_KEY");
  });

  it("includes existing keys (backward compat)", () => {
    const allKeys = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(allKeys).toContain("OPENROUTER_API_KEY");
    expect(allKeys).toContain("OPENAI_API_KEY");
    expect(allKeys).toContain("ANTHROPIC_API_KEY");
    expect(allKeys).toContain("HF_TOKEN");
    expect(allKeys).toContain("EXA_API_KEY");
    expect(allKeys).toContain("FAL_KEY");
    expect(allKeys).toContain("BROWSERBASE_API_KEY");
  });

  it("no duplicate keys across all settings sections", () => {
    const allKeys = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});

// ─── Static constants ───────────────────────────────────

describe("LOCAL_PRESETS", () => {
  it("has expected presets", () => {
    const ids = LOCAL_PRESETS.map((p) => p.id);
    expect(ids).toContain("lmstudio");
    expect(ids).toContain("ollama");
  });
});

describe("THEME_OPTIONS", () => {
  it("has system, light, dark", () => {
    const values = THEME_OPTIONS.map((t) => t.value);
    expect(values).toEqual(["system", "light", "dark"]);
  });
});
