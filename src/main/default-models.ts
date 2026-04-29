/**
 * Default models seeded on first install.
 *
 * Contributors: add new models here! They'll be available to all users
 * on fresh install. Format:
 * { name: "Display Name", provider: "provider-key", model: "model-id", baseUrl: "" }
 *
 * Provider keys: openrouter, anthropic, openai, custom, nvidia-nim
 * For openrouter models, use the full path (e.g. "anthropic/claude-sonnet-4-20250514")
 * For direct provider models, use the provider's model ID (e.g. "claude-sonnet-4-20250514")
 * 
 * LOCAL-ONLY MODELS (not committed to repo):
 * - Qwen3.5-480B-Instruct (NVIDIA NIM) - Your primary local model
 * - Qwen3.5-397B-A17B (NVIDIA NIM) - Secondary optimized model
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

  // ── NVIDIA NIM (Local Qwen3.5 models) ────────────────────────────────
  // Your primary local model - Most powerful
  {
    name: "Qwen3.5-480B-Instruct",
    provider: "nvidia-nim",
    model: "qwen3.5-480b-instruct",
    baseUrl: "http://localhost:8000/v1",
  },
  // Secondary optimized model
  {
    name: "Qwen3.5-397B-A17B",
    provider: "nvidia-nim",
    model: "qwen3.5-397b-a17b",
    baseUrl: "http://localhost:8000/v1",
  },
];

export default DEFAULT_MODELS;
