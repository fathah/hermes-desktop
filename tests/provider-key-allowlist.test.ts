import { describe, it, expect } from "vitest";
import { resolveProviderEnvKey } from "../src/main/config/env-store";

// MED-2: the AI co-author's "config" action is routed through a strict
// provider→env allowlist. Unknown providers must resolve to null so the
// set-provider-key IPC refuses them (no arbitrary env writes).
describe("resolveProviderEnvKey (MED-2 allowlist)", () => {
  it("maps known providers to their credential env var", () => {
    expect(resolveProviderEnvKey("openai")).toBe("OPENAI_API_KEY");
    expect(resolveProviderEnvKey("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(resolveProviderEnvKey("google")).toBe("GEMINI_API_KEY");
    expect(resolveProviderEnvKey("vertex")).toBe(
      "GOOGLE_APPLICATION_CREDENTIALS",
    );
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveProviderEnvKey("  OpenAI ")).toBe("OPENAI_API_KEY");
  });

  it("rejects unknown / hostile provider values", () => {
    expect(resolveProviderEnvKey("evilcorp")).toBeNull();
    expect(resolveProviderEnvKey("")).toBeNull();
    expect(resolveProviderEnvKey("../../etc")).toBeNull();
    // An attempt to smuggle an arbitrary env var name through the provider field.
    expect(resolveProviderEnvKey("PATH")).toBeNull();
  });
});
