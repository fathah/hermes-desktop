import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * getApiServerKeyStatus (vault polish V1) — the richer, ADDITIVE shape behind
 * the `get-api-server-key-status` IPC channel, plus the rate-limited
 * missing-key diagnostic in getApiServerKey.
 *
 * Runs the REAL chain (config.yaml → getSecretsProvider →
 * CommandSecretsProvider → /bin/sh) against a temp HERMES_HOME with synthetic
 * markers, mirroring tests/api-server-key-secrets-provider.test.ts.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-key-status-${Date.now()}`);
const itPosix = process.platform === "win32" ? it.skip : it;
const ORIGINAL_API_SERVER_KEY = process.env.API_SERVER_KEY;

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  delete process.env.API_SERVER_KEY;
  // Silence the overlay debug line in test output.
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  if (ORIGINAL_API_SERVER_KEY === undefined) delete process.env.API_SERVER_KEY;
  else process.env.API_SERVER_KEY = ORIGINAL_API_SERVER_KEY;
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getApiServerKeyStatus", () => {
  itPosix(
    "reports hasKey=true, providerId='command' for a vault-resolved key",
    async () => {
      writeFileSync(
        join(TEST_DIR, "config.yaml"),
        [
          "secrets:",
          "  provider: command",
          "  command: echo API_SERVER_KEY=synthetic-vault-marker",
          "",
        ].join("\n"),
      );
      // No .env at all — the key comes only from the provider overlay.
      const { getApiServerKeyStatus } = await freshConfig(TEST_DIR);

      const status = getApiServerKeyStatus();
      expect(status.hasKey).toBe(true);
      expect(status.providerId).toBe("command");
      expect(typeof status.checkedAt).toBe("number");
    },
  );

  it("reports hasKey=true, providerId='env' for a .env key (no regression)", async () => {
    writeFileSync(join(TEST_DIR, "config.yaml"), "agent:\n  enabled: true\n");
    writeFileSync(
      join(TEST_DIR, ".env"),
      "API_SERVER_KEY=synthetic-dotenv-marker\n",
    );
    const { getApiServerKeyStatus } = await freshConfig(TEST_DIR);

    const status = getApiServerKeyStatus();
    expect(status.hasKey).toBe(true);
    expect(status.providerId).toBe("env");
  });

  itPosix(
    "reports hasKey=false with the configured providerId when nothing resolves",
    async () => {
      writeFileSync(
        join(TEST_DIR, "config.yaml"),
        ["secrets:", "  provider: command", '  command: "exit 0"', ""].join(
          "\n",
        ),
      );
      const { getApiServerKeyStatus } = await freshConfig(TEST_DIR);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const status = getApiServerKeyStatus();
      expect(status.hasKey).toBe(false);
      expect(status.providerId).toBe("command");
      warnSpy.mockRestore();
    },
  );

  it("keeps hasKey as the required primary field (additive contract)", async () => {
    writeFileSync(join(TEST_DIR, "config.yaml"), "agent:\n  enabled: true\n");
    const { getApiServerKeyStatus } = await freshConfig(TEST_DIR);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const status = getApiServerKeyStatus();
    // Old renderer code reads exactly this field — it must always be present.
    expect(Object.prototype.hasOwnProperty.call(status, "hasKey")).toBe(true);
    expect(status.hasKey).toBe(false);
    warnSpy.mockRestore();
  });
});

describe("getApiServerKey missing-key diagnostic", () => {
  itPosix(
    "warns exactly once per (provider, profile) pair, naming the provider",
    async () => {
      writeFileSync(
        join(TEST_DIR, "config.yaml"),
        ["secrets:", "  provider: command", '  command: "exit 0"', ""].join(
          "\n",
        ),
      );
      const { getApiServerKey, invalidateSecretsCache } =
        await freshConfig(TEST_DIR);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(getApiServerKey()).toBe("");
      // Force a real re-resolution (the 5s cache would otherwise short-circuit
      // before the diagnostic) — the rate-limit Set must still suppress it.
      invalidateSecretsCache();
      expect(getApiServerKey()).toBe("");

      const diagnostics = warnSpy.mock.calls
        .flat()
        .filter(
          (m) =>
            typeof m === "string" && m.includes("API_SERVER_KEY not resolved"),
        );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain("provider=command");
      expect(diagnostics[0]).toContain("env=default");
      warnSpy.mockRestore();
    },
  );

  it("does not warn when the key resolves", async () => {
    writeFileSync(join(TEST_DIR, "config.yaml"), "agent:\n  enabled: true\n");
    writeFileSync(
      join(TEST_DIR, ".env"),
      "API_SERVER_KEY=synthetic-present-marker\n",
    );
    const { getApiServerKey } = await freshConfig(TEST_DIR);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getApiServerKey()).toBe("synthetic-present-marker");
    const diagnostics = warnSpy.mock.calls
      .flat()
      .filter(
        (m) =>
          typeof m === "string" && m.includes("API_SERVER_KEY not resolved"),
      );
    expect(diagnostics).toHaveLength(0);
    warnSpy.mockRestore();
  });
});
