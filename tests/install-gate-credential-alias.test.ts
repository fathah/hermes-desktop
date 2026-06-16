import { describe, it, expect, vi } from "vitest";

// installer.ts transitively imports modules that pull in `electron` at value
// scope. Provide the same minimal stub the other installer tests use so the
// import resolves under plain Node/vitest.
vi.mock("electron", () => ({
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [];
    }
  },
  ipcMain: {
    on: (): void => {},
    handle: (): void => {},
    removeHandler: (): void => {},
    removeAllListeners: (): void => {},
  },
}));

import { envHasUsableValue, expectedEnvKeyForModel } from "../src/main/installer";

/**
 * Install-gate credential-name-alias equivalence.
 *
 * checkInstallStatus() decides whether the desktop shows the first-run Setup
 * screen: if the active provider has no usable key, Setup is forced on every
 * launch (App.tsx: `!status.hasApiKey -> "setup"`). A vault-only user keeps the
 * credential in .env/tmpfs under an ALIAS of the canonical key — anthropic
 * accepts ANTHROPIC_API_KEY, ANTHROPIC_TOKEN, or CLAUDE_CODE_OAUTH_TOKEN. Before
 * this fix, the .env check did an exact `key === expectedKey` match, so a vault
 * user whose key is CLAUDE_CODE_OAUTH_TOKEN was wrongly treated as unconfigured
 * and bounced to Setup on every startup.
 *
 * This is the install gate joining the credential-name-alias family the other
 * gates already handle (config-health, validation, chat-readiness) — fix the
 * CLASS across every gate, per AIR-018.
 */
describe("envHasUsableValue — install gate honors credential-name aliases", () => {
  const expectedAnthropic = expectedEnvKeyForModel(
    "anthropic",
    "https://api.anthropic.com/v1",
  );

  it("expectedEnvKeyForModel resolves anthropic to ANTHROPIC_API_KEY", () => {
    expect(expectedAnthropic).toBe("ANTHROPIC_API_KEY");
  });

  it("accepts the canonical ANTHROPIC_API_KEY", () => {
    expect(
      envHasUsableValue("ANTHROPIC_API_KEY=sk-ant-xxx\n", expectedAnthropic),
    ).toBe(true);
  });

  it.each([
    ["ANTHROPIC_TOKEN", "ANTHROPIC_TOKEN=sk-ant-xxx\n"],
    ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-xxx\n"],
  ])(
    "accepts the %s alias as satisfying the ANTHROPIC_API_KEY gate (the vault-user bug)",
    (_name, content) => {
      expect(envHasUsableValue(content, expectedAnthropic)).toBe(true);
    },
  );

  it("accepts an alias even when surrounded by unrelated env vars + comments", () => {
    const env = [
      "# hermes secrets",
      'TELEGRAM_BOT_TOKEN="123:abc"',
      "MATRIX_ACCESS_TOKEN=syt_whatever",
      'CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat-xxx"',
      "",
    ].join("\n");
    expect(envHasUsableValue(env, expectedAnthropic)).toBe(true);
  });

  // CREDENTIAL-BLEED GUARD (AIR-020): the alias acceptance is an allowlist
  // scoped to the provider's OWN key names. An unrelated token must NOT satisfy
  // the anthropic gate, or any populated env would falsely look configured.
  it("does NOT accept an unrelated token (no credential bleed)", () => {
    expect(
      envHasUsableValue("MATRIX_ACCESS_TOKEN=syt_xxx\n", expectedAnthropic),
    ).toBe(false);
    expect(
      envHasUsableValue("TELEGRAM_BOT_TOKEN=123:abc\n", expectedAnthropic),
    ).toBe(false);
  });

  // Boundary: an alias present but EMPTY / quoted-blank must NOT satisfy the
  // gate (an empty value is not a usable credential).
  it("rejects an empty or quoted-blank alias value", () => {
    expect(envHasUsableValue("CLAUDE_CODE_OAUTH_TOKEN=\n", expectedAnthropic)).toBe(
      false,
    );
    expect(
      envHasUsableValue('CLAUDE_CODE_OAUTH_TOKEN="  "\n', expectedAnthropic),
    ).toBe(false);
  });

  // The null-expectedKey path (uncatalogued provider) is unchanged: any
  // *_API_KEY is accepted, but a bare *_TOKEN is not — and an alias only counts
  // when there IS an expectedKey to alias from.
  it("null expectedKey still accepts any *_API_KEY but not a bare *_TOKEN", () => {
    expect(envHasUsableValue("CUSTOM_API_KEY=xyz\n", null)).toBe(true);
    expect(envHasUsableValue("SOME_TOKEN=xyz\n", null)).toBe(false);
  });
});
