import { describe, it, expect } from "vitest";
import { KEY_ALIASES, aliasesForEnvKey } from "./url-key-map";

// Guard for the SINGLE-SOURCE-OF-TRUTH alias table (Greptile P1 on PR #673).
// The Anthropic credential-name equivalence (canonical API key ↔ gateway Bearer
// name ↔ Claude Code OAuth token) is consumed by FIVE security gates across main
// and renderer. It used to be copy-pasted in three files; it now lives here. If
// these expectations change, update the gateway provider plugins' env_vars too.
describe("KEY_ALIASES — shared credential-name alias source of truth", () => {
  it("maps ANTHROPIC_API_KEY to its Bearer + OAuth-token aliases", () => {
    expect(KEY_ALIASES.ANTHROPIC_API_KEY).toContain("ANTHROPIC_TOKEN");
    expect(KEY_ALIASES.ANTHROPIC_API_KEY).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("aliasesForEnvKey returns the aliases for a known key", () => {
    expect(aliasesForEnvKey("ANTHROPIC_API_KEY")).toEqual([
      "ANTHROPIC_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ]);
  });

  it("aliasesForEnvKey returns an empty array for an unknown key (no throw)", () => {
    expect(aliasesForEnvKey("OPENROUTER_API_KEY")).toEqual([]);
    expect(aliasesForEnvKey("")).toEqual([]);
  });

  it("never maps a key to its own canonical name (aliases are DISTINCT names)", () => {
    for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
      expect(aliases).not.toContain(canonical);
    }
  });
});
