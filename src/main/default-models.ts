/**
 * Default models seeded on first install.
 *
 * Contributors: add new models here! They'll be available to all users
 * on fresh install. Format:
 *   { name: "Display Name", provider: "provider-key", model: "model-id", baseUrl: "" }
 *
 * Provider keys: openrouter, anthropic, openai, custom
 * For openrouter models, use the full path (e.g. "anthropic/claude-sonnet-4-20250514")
 * For direct provider models, use the provider's model ID (e.g. "claude-sonnet-4-20250514")
 */

export interface DefaultModel {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
}

const DEFAULT_MODELS: DefaultModel[] = [
  // ── OpenRouter (200+ models via single API key) ──────────────────────
  {
    name: "Claude Sonnet 4",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4-20250514",
    baseUrl: "",
  },

  // ── Anthropic (direct) ───────────────────────────────────────────────
  {
    name: "Claude Sonnet 4",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "",
  },

  // ── OpenAI (direct) ──────────────────────────────────────────────────
  {
    name: "GPT-4.1",
    provider: "openai",
    model: "gpt-4.1",
    baseUrl: "",
  },

  // ── Ollama Cloud ─────────────────────────────────────────────────
  {
    name: "glm-5.1",
    provider: "ollama-cloud",
    model: "glm-5.1",
    baseUrl: "https://ollama.com/v1",
  },

  // ── Atlas Cloud (OpenAI-compatible, 59+ LLMs) ─────────────────────
  // https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=hermes-desktop
  // All 59 hosted chat models (from api.md):
  //   Anthropic: anthropic/claude-haiku-4.5-20251001, anthropic/claude-opus-4.8, anthropic/claude-sonnet-4.6
  //   OpenAI: openai/gpt-5.4, openai/gpt-5.5
  //   Google: google/gemini-3.1-flash-lite, google/gemini-3.1-pro-preview, google/gemini-3.5-flash
  //   Qwen: qwen/qwen2.5-7b-instruct, Qwen/Qwen3-235B-A22B-Instruct-2507, qwen/qwen3-235b-a22b-thinking-2507,
  //         qwen/qwen3-30b-a3b, Qwen/Qwen3-30B-A3B-Instruct-2507, qwen/qwen3-30b-a3b-thinking-2507,
  //         qwen/qwen3-32b, qwen/qwen3-8b, Qwen/Qwen3-Coder, qwen/qwen3-coder-next,
  //         qwen/qwen3-max-2026-01-23, Qwen/Qwen3-Next-80B-A3B-Instruct, Qwen/Qwen3-Next-80B-A3B-Thinking,
  //         Qwen/Qwen3-VL-235B-A22B-Instruct, qwen/qwen3-vl-235b-a22b-thinking,
  //         qwen/qwen3-vl-30b-a3b-instruct, qwen/qwen3-vl-30b-a3b-thinking, qwen/qwen3-vl-8b-instruct,
  //         qwen/qwen3.5-122b-a10b, qwen/qwen3.5-27b, qwen/qwen3.5-35b-a3b, qwen/qwen3.5-397b-a17b,
  //         qwen/qwen3.6-35b-a3b, qwen/qwen3.6-plus
  //   DeepSeek: deepseek-ai/deepseek-ocr, deepseek-ai/deepseek-r1-0528, deepseek-ai/DeepSeek-V3-0324,
  //             deepseek-ai/DeepSeek-V3.1, deepseek-ai/DeepSeek-V3.1-Terminus, deepseek-ai/deepseek-v3.2,
  //             deepseek-ai/DeepSeek-V3.2-Exp, deepseek-ai/deepseek-v4-flash, deepseek-ai/deepseek-v4-pro
  //   Moonshot: moonshotai/Kimi-K2-Instruct, moonshotai/Kimi-K2-Instruct-0905, moonshotai/Kimi-K2-Thinking,
  //             moonshotai/kimi-k2.5, moonshotai/kimi-k2.6
  //   Zhipu: zai-org/GLM-4.6, zai-org/glm-4.7, zai-org/glm-5, zai-org/glm-5-turbo, zai-org/glm-5.1,
  //          zai-org/glm-5v-turbo
  //   MiniMax: MiniMaxAI/MiniMax-M2, minimaxai/minimax-m2.1, minimaxai/minimax-m2.5, minimaxai/minimax-m2.7
  //   xAI: xai/grok-4.3
  //   Kwaipilot: kwaipilot/kat-coder-pro-v2
  //   Other: owl
  {
    name: "DeepSeek V4 Pro (Atlas Cloud)",
    provider: "atlascloud",
    model: "deepseek-ai/deepseek-v4-pro",
    baseUrl: "",
  },
  {
    name: "DeepSeek V4 Flash (Atlas Cloud)",
    provider: "atlascloud",
    model: "deepseek-ai/deepseek-v4-flash",
    baseUrl: "",
  },
  {
    name: "Qwen3-235B Instruct (Atlas Cloud)",
    provider: "atlascloud",
    model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    baseUrl: "",
  },
];

export default DEFAULT_MODELS;
