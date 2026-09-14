/**
 * A session-scoped model selection made from the in-chat (bottom) model
 * picker. Unlike the persisted `config.yaml` default, this override belongs to
 * one conversation only; desktop persists it by session id and threads it
 * through the send pipeline on every message (renderer → preload IPC → main
 * `sendMessage`).
 *
 * It carries the *full* model identity — not just the model name — because a
 * cross-provider switch (e.g. an OpenAI-Codex default → Gemini) must change the
 * provider and base URL that the request routes through, not only the `model`
 * string. It intentionally stores only routing identity — never API keys.
 */
export interface SessionModelOverride {
  provider: string;
  model: string;
  baseUrl: string;
}
