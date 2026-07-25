import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  GATEWAY_PLATFORMS,
  GATEWAY_SECTIONS,
  SETTINGS_SECTIONS,
  LOCAL_PRESETS,
  OPENAI_COMPATIBLE_BASE_URLS,
  DASHSCOPE_ENDPOINTS,
  THEME_OPTIONS,
  providerKeyRank,
  providerNameForEnvKey,
  providerRouteForEnvKey,
} from "../src/renderer/src/constants";

// ─── PROVIDERS ──────────────────────────────────────────

describe("PROVIDERS", () => {
  it("has auto-detect as first option", () => {
    expect(PROVIDERS.options[0]).toEqual({
      value: "auto",
      label: "constants.autoDetect",
    });
  });

  it("includes all v0.9.0 providers", () => {
    const values = PROVIDERS.options.map((o) => o.value);
    expect(values).toContain("openrouter");
    expect(values).toContain("aimlapi");
    expect(values).toContain("anthropic");
    expect(values).toContain("openai");
    expect(values).toContain("openai-codex");
    expect(values).toContain("google");
    expect(values).toContain("xai");
    expect(values).toContain("xiaomi");
    expect(values).toContain("nous");
    expect(values).toContain("alibaba");
    expect(values).toContain("qwen-oauth");
    expect(values).toContain("minimax");
    expect(values).toContain("lmstudio");
    expect(values).toContain("ollama");
    expect(values).toContain("vllm");
    expect(values).toContain("llamacpp");
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

  it("offers DashScope setup through Alibaba with a mainland default", () => {
    const dashscope = PROVIDERS.setup.find((s) => s.id === "alibaba");
    expect(dashscope).toBeTruthy();
    expect(dashscope?.configProvider).toBe("alibaba");
    expect(dashscope?.envKey).toBe("DASHSCOPE_API_KEY");
    expect(dashscope?.baseUrl).toBe(DASHSCOPE_ENDPOINTS[0].baseUrl);
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
      SETTINGS_SECTIONS.find(
        (s) => s.title === "constants.sectionLlmProviders",
      ),
    ).toBeTruthy();
  });

  it("includes Google AI Studio and xAI keys", () => {
    const allKeys = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(allKeys).toContain("GOOGLE_API_KEY");
    expect(allKeys).toContain("XAI_API_KEY");
    expect(allKeys).toContain("XIAOMI_API_KEY");
    expect(allKeys).toContain("AIMLAPI_API_KEY");
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
    expect(ids).toContain("aimlapi");
    expect(ids).toContain("ollama");
    expect(ids).toContain("vllm");
    expect(ids).toContain("llamacpp");
  });

  it("exposes every local preset as a provider dropdown option", () => {
    const options = new Set(PROVIDERS.options.map((o) => o.value));
    for (const preset of LOCAL_PRESETS.filter((p) => p.group === "local")) {
      expect(options.has(preset.id)).toBe(true);
      expect(PROVIDERS.labels[preset.id]).toBeTruthy();
    }
  });

  // Every preset chip routes through OPENAI_COMPATIBLE_BASE_URLS in the
  // Providers picker; a missing entry collapses the picker and mis-saves the
  // provider (regression: AtlasCloud/LM Studio fell through to native routing).
  it("maps every preset id to an OpenAI-compatible base URL", () => {
    for (const preset of LOCAL_PRESETS) {
      expect(OPENAI_COMPATIBLE_BASE_URLS[preset.id]).toBeTruthy();
    }
  });
});

// ─── providerRouteForEnvKey ─────────────────────────────

// @lat: [[provider-setup#Provider setup#Active model is picked from configured providers#Native keys without a setup card still route]]
describe("providerRouteForEnvKey", () => {
  // Regression: NOUS_API_KEY (and other native-provider keys whose setup card
  // is the OAuth variant or absent) fell through to the bare `custom` fallback,
  // so the Providers tab's Change-model picker dropped them even with a key
  // set. Each must route to its hermes-agent slug.
  it("routes native-provider keys to their agent slugs", () => {
    const native: Record<string, string> = {
      NOUS_API_KEY: "nous",
      GLM_API_KEY: "zai",
      KIMI_API_KEY: "kimi-coding",
      MINIMAX_API_KEY: "minimax",
      MINIMAX_CN_API_KEY: "minimax-cn",
      NVIDIA_API_KEY: "nvidia",
      OPENCODE_ZEN_API_KEY: "opencode-zen",
      OPENCODE_GO_API_KEY: "opencode-go",
      HF_TOKEN: "huggingface",
    };
    for (const [envKey, slug] of Object.entries(native)) {
      expect(providerRouteForEnvKey(envKey)).toEqual({
        provider: slug,
        baseUrl: "",
      });
    }
  });

  it("orders Hermes One first and AIML API last among LLM keys", () => {
    const llm = SETTINGS_SECTIONS.find(
      (s) => s.title === "constants.sectionLlmProviders",
    )!;
    const ordered = llm.items
      .filter((f) => f.key !== "CUSTOM_API_KEY")
      .map((f, i) => ({ key: f.key, i }))
      .sort(
        (a, b) => providerKeyRank(a.key) - providerKeyRank(b.key) || a.i - b.i,
      )
      .map((x) => x.key);

    expect(ordered[0]).toBe("HERMESONE_API_KEY");
    expect(ordered[ordered.length - 1]).toBe("AIMLAPI_API_KEY");
    // A well-known provider outranks a niche one it followed in FieldDef order.
    expect(ordered.indexOf("ANTHROPIC_API_KEY")).toBeLessThan(
      ordered.indexOf("AIMLAPI_API_KEY"),
    );
    expect(ordered.indexOf("OPENAI_API_KEY")).toBeLessThan(
      ordered.indexOf("OLLAMA_API_KEY"),
    );
  });

  it("routes Perplexity as an OpenAI-compatible custom endpoint", () => {
    expect(providerRouteForEnvKey("PERPLEXITY_API_KEY")).toEqual({
      provider: "custom",
      baseUrl: OPENAI_COMPATIBLE_BASE_URLS.perplexity,
    });
  });

  // The provider cards/picker show plain provider names ("Hermes One"), not
  // the FieldDef's "… API Key" label. Every LLM-section key must resolve to a
  // name so no card falls back to the noisy label.
  it("resolves a plain provider name for every LLM-provider key", () => {
    const llm = SETTINGS_SECTIONS.find(
      (s) => s.title === "constants.sectionLlmProviders",
    );
    expect(llm).toBeDefined();
    for (const f of llm!.items) {
      if (f.key === "CUSTOM_API_KEY") continue; // generic bucket — no brand
      expect(
        providerNameForEnvKey(f.key),
        `${f.key} has no provider display name`,
      ).toBeTruthy();
    }
  });

  // Every password-type key in the LLM Providers section must resolve to a
  // usable route: either a native agent slug or `custom` with a non-empty base
  // URL. A bare `custom` route (empty base URL) is silently dropped by the
  // active-model picker — exactly the bug that hid Nous Portal.
  it("leaves no LLM-provider FieldDef on the dead custom fallback", () => {
    const llm = SETTINGS_SECTIONS.find(
      (s) => s.title === "constants.sectionLlmProviders",
    );
    expect(llm).toBeDefined();
    for (const f of llm!.items) {
      if (f.key === "CUSTOM_API_KEY") continue; // the generic bucket, by design
      const route = providerRouteForEnvKey(f.key);
      expect(
        route.provider !== "custom" || route.baseUrl !== "",
        `${f.key} falls through to the bare custom route`,
      ).toBe(true);
    }
  });
});

describe("DASHSCOPE_ENDPOINTS", () => {
  it("offers mainland and international DashScope endpoints", () => {
    expect(DASHSCOPE_ENDPOINTS).toEqual([
      {
        id: "cn",
        name: "constants.dashscopeChinaEndpoint",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
      {
        id: "intl",
        name: "constants.dashscopeIntlEndpoint",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      },
    ]);
  });
});

describe("THEME_OPTIONS", () => {
  it("has system, light, dark", () => {
    const values = THEME_OPTIONS.map((t) => t.value);
    expect(values).toEqual(["system", "light", "dark"]);
  });
});
