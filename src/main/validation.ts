/**
 * Pre-send chat readiness validation.
 *
 * Runs on the renderer's request (and on model/profile change) to
 * answer one question: if the user hits Send right now, will it work?
 *
 * Surfaces a structured reason + a "where to fix it" hint when it
 * won't, so the renderer can disable the Send button and show an
 * inline banner instead of letting the user fire off a request that
 * the gateway is about to 401 / 403 / "Configure API_SERVER_KEY" on.
 *
 * Uncertain provider states still fail open, but validator failures
 * themselves fail closed: a broken validator must not masquerade as a
 * green readiness check.
 */

import {
  getModelConfig,
  hasOAuthCredentials,
  readEnv,
  customEndpointKeyResolvable,
} from "./config";
import { expectedEnvKeyForModel } from "./installer";
import { isLocalBaseUrl } from "../shared/url-key-map";

import type {
  ChatReadinessCode,
  FixLocation,
  ChatReadiness,
} from "../shared/validation";
export type { ChatReadinessCode, FixLocation, ChatReadiness };

const OK: ChatReadiness = { ok: true };

// Provider ids that authenticate ONLY via interactive OAuth login —
// no API-key variant exists for these in hermes-agent's registry.
// For these, fail open after a negative auth.json probe (the upstream
// "not signed in" error path is still the source of truth).
//
// Nous Portal used to live here but was moved out because it supports
// BOTH OAuth (`nous`) AND API key (`nous-api`) — issue #367. It's now
// handled by the generic "env key OR auth.json evidence" path below.
const OAUTH_PROVIDERS = new Set([
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "google-gemini-cli",
  "minimax-oauth",
]);

// Provider ids that don't need an API key at all. `auto` lets
// hermes-agent pick at runtime; the others are local self-hosted
// gateways that don't enforce auth.
//
// `nous` used to be in this set (back when the registry only knew the
// OAuth variant) but it actually DOES need credentials — either
// NOUS_API_KEY in .env or an OAuth/credential-pool entry in auth.json.
// Issue #367 — silent misconfiguration when a user picked Nous Portal
// from the dropdown but had nothing set up.
const NO_KEY_PROVIDERS = new Set(["auto", "vertex"]);

/**
 * Synchronous readiness check against the desktop's own config —
 * no network calls. Fast (single readEnv + getModelConfig).
 *
 * `profile` defaults to the active profile.
 */
export function validateChatReadiness(profile?: string): ChatReadiness {
  try {
    const mc = getModelConfig(profile);
    const provider = (mc.provider || "").trim().toLowerCase();
    const model = (mc.model || "").trim();
    const baseUrl = (mc.baseUrl || "").trim();

    // Provider="auto" lets hermes-agent pick a model at runtime based
    // on whatever keys are present in .env. No key-presence check
    // makes sense for it — fail open.
    if (!provider || provider === "auto") return OK;

    if (!model && provider !== "auto") {
      return {
        ok: false,
        code: "NO_ACTIVE_MODEL",
        message: "No model selected. Pick one in Models or the Chat picker.",
        fixLocation: "models",
      };
    }

    if (OAUTH_PROVIDERS.has(provider) || NO_KEY_PROVIDERS.has(provider)) {
      // OAuth/no-key providers — skip the env-var check; the gateway's
      // own auth path surfaces "not signed in" at send time. Fail open.
      return OK;
    }

    // Local/private URLs typically don't require a key; the user may
    // intentionally hit an unauthenticated LM Studio / Ollama. Don't
    // block on missing key in that case.
    if (isLocalBaseUrl(baseUrl)) return OK;

    const expectedKey = expectedEnvKeyForModel(provider, baseUrl);
    if (!expectedKey) {
      // Unknown provider+URL combination. We don't know which env var
      // to check, so fail open rather than risk a false-positive
      // block.
      return OK;
    }

    const env = readEnv(profile);
    const value = (env[expectedKey] ?? "").trim();
    if (value) return OK;

    // OpenAI-compatible / custom endpoints (e.g. provider "custom" pointed at
    // Groq) authenticate via a fallback key chain at runtime — the URL key may
    // be absent while OPENAI_API_KEY / CUSTOM_API_KEY carries the credential.
    // Accept the same chain the gateway uses so we don't false-block a Send
    // that will actually succeed.
    if (customEndpointKeyResolvable(provider, baseUrl, profile)) {
      return OK;
    }

    // Secondary positive signal: the engine also accepts credentials
    // stored in auth.json (top-level `providers[<name>]` or any entry
    // in `credential_pool[<name>]` with a non-empty access/refresh
    // token or api_key). This is how Nous Portal (issue #367) works in
    // OAuth mode — there's no NOUS_API_KEY in .env but the engine
    // resolves the credential from a properly-shaped auth.json entry.
    // If we have that evidence, allow Send.
    if (hasOAuthCredentials(provider, profile)) return OK;

    return {
      ok: false,
      code: "MISSING_API_KEY",
      message: `Missing ${expectedKey} for ${provider}. Set it in Providers.`,
      fixLocation: "providers",
      expectedEnvKey: expectedKey,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `Chat readiness validation failed: ${message}`,
      fixLocation: "setup",
    };
  }
}
