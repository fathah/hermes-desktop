import { describe, it, expect, vi } from "vitest";

// installer.ts transitively imports modules that pull in `electron` at value
// scope (askpass.ts, sudoCreds.ts). Loading the real package in a plain
// Node/vitest environment fails, so stub it before importing the module under
// test. We test PURE logic only (no real DB / secrets provider is opened),
// which also sidesteps the better-sqlite3 NODE_MODULE_VERSION ABI quirk.
vi.mock("electron", () => ({
  app: { setPath: (): void => {}, getPath: (): string => "/tmp" },
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

import {
  vaultResolvedHasKey,
  expectedEnvKeyForModel,
} from "../src/main/installer";
import { aliasesForEnvKey } from "../src/shared/url-key-map";

// The install gate's vault-awareness must be alias-CONSTRAINED when the
// provider is catalogued: only the expected key or one of its accepted aliases
// satisfies it. An unrelated token-shaped vault credential (GITHUB_TOKEN,
// SLACK_BOT_TOKEN) must NOT clear the gate — that was the P1 hole (Greptile,
// PR #673): a vault holding only those falsely passed and showed chat instead
// of routing the user back through Setup.
describe("vaultResolvedHasKey — install-gate vault awareness", () => {
  const ANTHROPIC = "ANTHROPIC_API_KEY";

  it("does NOT pass when only an unrelated token is in the vault (the bug repro)", () => {
    // Pre-fix code fell through to a broad /(_API_KEY|_TOKEN)$/ scan and
    // returned true here — a security hole. Must now be false.
    expect(vaultResolvedHasKey({ GITHUB_TOKEN: "ghp_xxx" }, ANTHROPIC)).toBe(
      false,
    );
    expect(
      vaultResolvedHasKey(
        { GITHUB_TOKEN: "ghp_xxx", SLACK_BOT_TOKEN: "xoxb-yyy" },
        ANTHROPIC,
      ),
    ).toBe(false);
  });

  it("passes when the exact expected key is present and usable", () => {
    expect(
      vaultResolvedHasKey({ ANTHROPIC_API_KEY: "sk-ant-123" }, ANTHROPIC),
    ).toBe(true);
  });

  it("passes when an accepted alias of the expected key is present", () => {
    // Use the REAL alias names from the single-source-of-truth KEY_ALIASES.
    const aliases = aliasesForEnvKey(ANTHROPIC);
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      expect(vaultResolvedHasKey({ [alias]: "value-123" }, ANTHROPIC)).toBe(
        true,
      );
    }
    // Sanity: the real alias names we expect on this provider.
    expect(aliases).toContain("ANTHROPIC_TOKEN");
    expect(aliases).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("does NOT pass for a blank/whitespace-only expected key value", () => {
    expect(vaultResolvedHasKey({ ANTHROPIC_API_KEY: "   " }, ANTHROPIC)).toBe(
      false,
    );
    expect(vaultResolvedHasKey({ ANTHROPIC_API_KEY: "" }, ANTHROPIC)).toBe(
      false,
    );
  });

  it("does NOT pass for a non-string expected key value", () => {
    expect(
      vaultResolvedHasKey(
        { ANTHROPIC_API_KEY: 12345 as unknown as string },
        ANTHROPIC,
      ),
    ).toBe(false);
  });

  it("preserves the broad fallback for an uncatalogued provider (expectedKey null)", () => {
    // No canonical key name to look for → any *_API_KEY / *_TOKEN is accepted.
    expect(vaultResolvedHasKey({ SOME_TOKEN: "abc" }, null)).toBe(true);
    expect(vaultResolvedHasKey({ CUSTOM_API_KEY: "abc" }, null)).toBe(true);
    expect(vaultResolvedHasKey({ NOT_A_CREDENTIAL: "abc" }, null)).toBe(false);
    expect(vaultResolvedHasKey({}, null)).toBe(false);
  });
});

// Cross-check that the model→expected-key resolution the gate relies on really
// maps the Anthropic provider to ANTHROPIC_API_KEY, so the cases above exercise
// the same expectedKey the production code computes.
describe("expectedEnvKeyForModel — feeds the vault gate", () => {
  it("maps the anthropic provider to ANTHROPIC_API_KEY", () => {
    expect(
      expectedEnvKeyForModel("anthropic", "https://api.anthropic.com"),
    ).toBe("ANTHROPIC_API_KEY");
  });

  it("returns null for an uncatalogued provider/URL (broad-fallback path)", () => {
    expect(
      expectedEnvKeyForModel("totally-unknown", "https://my-proxy.example"),
    ).toBeNull();
  });
});
