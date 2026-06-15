import { describe, it, expect } from "vitest";
import { KNOWN_API_KEYS } from "./hermes";

// Drift-guard for the credential names the desktop forwards from the security
// (secrets) provider into the agent/gateway env (the CLI/non-gateway fallback
// path). KNOWN_API_KEYS MUST stay a superset of every credential env-var name
// the gateway provider plugins accept (plugins/model-providers/*/__init__.py
// `env_vars`). When it drifts, a vault user whose credential is stored under a
// non-canonical name (an OAuth/Bearer token, or a per-vendor alias) gets no key
// forwarded on that path — exactly the "Missing <KEY> / silent no-auth" class.
//
// This is a behavior CONTRACT, not a snapshot: it asserts the SET CONTAINS the
// credential names that matter (especially the non-<VENDOR>_API_KEY ones a
// reviewer is most likely to forget), NOT an exact length/order.

const set = new Set(KNOWN_API_KEYS);

describe("KNOWN_API_KEYS — security-provider → gateway credential parity", () => {
  it("includes the Anthropic OAuth/Bearer alias names (not just ANTHROPIC_API_KEY)", () => {
    // The anthropic plugin accepts all three; a vault OAuth user stores the
    // credential as CLAUDE_CODE_OAUTH_TOKEN. Missing it = the live "Missing
    // ANTHROPIC_API_KEY / no-auth on the CLI path" bug.
    expect(set.has("ANTHROPIC_API_KEY")).toBe(true);
    expect(set.has("ANTHROPIC_TOKEN")).toBe(true);
    expect(set.has("CLAUDE_CODE_OAUTH_TOKEN")).toBe(true);
  });

  it("includes the OAuth/Bearer-TOKEN credential names across providers", () => {
    // These authenticate via a token name that is NOT <VENDOR>_API_KEY — the
    // easiest class to forget when hand-maintaining the list.
    for (const k of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_TOKEN",
      "COPILOT_GITHUB_TOKEN",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "HF_TOKEN",
    ]) {
      expect(set.has(k), `${k} must be forwardable`).toBe(true);
    }
  });

  it("includes per-vendor credential ALIASES (multiple accepted names)", () => {
    // Providers whose plugin lists more than one accepted key name. Forwarding
    // only the first leaves users who stored the other name unauthenticated.
    for (const k of [
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY", // gemini
      "ZAI_API_KEY",
      "Z_AI_API_KEY",
      "GLM_API_KEY", // zai / GLM
      "KIMI_API_KEY",
      "KIMI_CODING_API_KEY",
      "KIMI_CN_API_KEY", // kimi
      "DASHSCOPE_API_KEY", // alibaba / alibaba-coding-plan
    ]) {
      expect(set.has(k), `${k} alias must be forwardable`).toBe(true);
    }
  });

  it("includes the built-in OpenAI-compatible vendor keys (no silent drop)", () => {
    for (const k of [
      "NVIDIA_API_KEY",
      "NOVITA_API_KEY",
      "STEPFUN_API_KEY",
      "GMI_API_KEY",
      "ARCEEAI_API_KEY",
      "KILOCODE_API_KEY",
      "OPENCODE_ZEN_API_KEY",
      "OPENCODE_GO_API_KEY",
      "QWEN_API_KEY",
      "NOUS_API_KEY",
      "AZURE_FOUNDRY_API_KEY",
      "XAI_API_KEY",
    ]) {
      expect(set.has(k), `${k} must be forwardable`).toBe(true);
    }
  });

  it("has no duplicate entries (a duplicate signals a careless merge)", () => {
    expect(KNOWN_API_KEYS.length).toBe(set.size);
  });

  it("contains only plausible credential names (UPPER_SNAKE, ends in _KEY/_TOKEN/_ID)", () => {
    for (const k of KNOWN_API_KEYS) {
      expect(k, `${k} should be a credential-shaped env var name`).toMatch(
        /^[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_ID)$/,
      );
    }
  });
});
