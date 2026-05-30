import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}));

vi.mock("../src/main/hermes", () => ({
  isGatewayRunning: vi.fn(() => false),
  restartGateway: vi.fn(),
  isRemoteOnlyMode: vi.fn(() => false),
}));

vi.mock("../src/main/profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/profiles")>();
  const { writeFileSync } = await import("fs");
  const { join } = await import("path");
  return {
    ...actual,
    setActiveProfile: (name: string) => {
      const home = process.env.HERMES_HOME;
      if (!home) throw new Error("HERMES_HOME is not set");
      writeFileSync(join(home, "active_profile"), name, "utf-8");
    },
    createProfile: vi.fn(() => ({ success: true })),
    deleteProfile: vi.fn(() => ({ success: true })),
  };
});

async function loadModules(options?: { includeWizard?: boolean }): Promise<{
  keychain: typeof import("../src/main/vault/keychain");
  service: typeof import("../src/main/vault/service");
  wizard?: typeof import("../src/main/profiles/wizard");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  const keychain = await import("../src/main/vault/keychain");
  const service = await import("../src/main/vault/service");
  const result: {
    keychain: typeof keychain;
    service: typeof service;
    wizard?: typeof import("../src/main/profiles/wizard");
  } = { keychain, service };
  if (options?.includeWizard) {
    result.wizard = await import("../src/main/profiles/wizard");
  }
  return result;
}

describe("profile vault integration", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-profile-vault-"));
    mkdirSync(join(testHome, "desktop"), { recursive: true });
    writeFileSync(join(testHome, "active_profile"), "default", "utf-8");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("preserves API_SERVER_KEY through migrate and activate", async () => {
    const { keychain, service } = await loadModules();
    keychain.initVaultWithPassword("test-password-123");
    writeFileSync(join(testHome, ".env"), "API_SERVER_KEY=server-key\n", "utf-8");

    service.migratePlaintextEnv("default");
    service.activateProfile("default");

    const env = readFileSync(join(testHome, ".env"), "utf-8");
    expect(env).toContain("API_SERVER_KEY=server-key");
    expect(env).not.toContain("API_SERVER_API_KEY");
  });

  it("preserves custom env keys and unrelated .env entries on activation", async () => {
    const { keychain, service } = await loadModules();
    keychain.initVaultWithPassword("test-password-123");
    writeFileSync(
      join(testHome, ".env"),
      "HERMES_INFERENCE_PROVIDER=openai\nCUSTOM_TOKEN=keep-me\n",
      "utf-8",
    );
    service.addCredential("default", "openai", "Primary", "sk-secret", "OPENAI_API_KEY");

    service.activateProfile("default");

    const env = readFileSync(join(testHome, ".env"), "utf-8");
    expect(env).toContain("HERMES_INFERENCE_PROVIDER=openai");
    expect(env).toContain("CUSTOM_TOKEN=keep-me");
    expect(env).toContain("OPENAI_API_KEY=sk-secret");
  });

  it("does not create persistent .env.backup during migration", async () => {
    const { keychain, service } = await loadModules();
    keychain.initVaultWithPassword("test-password-123");
    writeFileSync(join(testHome, ".env"), "OPENAI_API_KEY=sk-test\n", "utf-8");

    service.migratePlaintextEnv("default");

    expect(existsSync(join(testHome, ".env.backup"))).toBe(false);
  });

  it("detects per-profile migration candidates independently", async () => {
    const { keychain, service } = await loadModules();
    keychain.initVaultWithPassword("test-password-123");

    writeFileSync(join(testHome, ".env"), "OPENAI_API_KEY=sk-default\n", "utf-8");
    mkdirSync(join(testHome, "profiles", "work"), { recursive: true });
    writeFileSync(
      join(testHome, "profiles", "work", ".env"),
      "DEEPSEEK_API_KEY=ds-work\n",
      "utf-8",
    );

    service.migratePlaintextEnv("default");

    const pending = service.detectAllProfileMigrations();
    expect(pending).toEqual([{ profile: "work", envKeys: ["DEEPSEEK_API_KEY"] }]);
  });

  it("migrates idempotently without duplicate vault rows", async () => {
    const { keychain, service } = await loadModules();
    keychain.initVaultWithPassword("test-password-123");
    writeFileSync(join(testHome, ".env"), "OPENAI_API_KEY=sk-first\n", "utf-8");

    expect(service.migratePlaintextEnv("default")).toBe(1);
    expect(service.getCredentials("default")).toHaveLength(1);

    writeFileSync(join(testHome, ".env"), "OPENAI_API_KEY=sk-second\n", "utf-8");
    expect(service.migratePlaintextEnv("default")).toBe(1);
    expect(service.getCredentials("default")).toHaveLength(1);

    service.activateProfile("default");
    expect(readFileSync(join(testHome, ".env"), "utf-8")).toContain(
      "OPENAI_API_KEY=sk-second",
    );
  });

  it("rolls back active profile and env files when activation fails", async () => {
    vi.resetModules();
    vi.stubEnv("HERMES_HOME", testHome);
    writeFileSync(join(testHome, ".env"), "HERMES_INFERENCE_PROVIDER=default-profile\n", "utf-8");
    mkdirSync(join(testHome, "profiles", "broken"), { recursive: true });
    writeFileSync(
      join(testHome, "profiles", "broken", ".env"),
      "HERMES_INFERENCE_PROVIDER=broken-profile\n",
      "utf-8",
    );

    const keychain = await import("../src/main/vault/keychain");
    keychain.initVaultWithPassword("test-password-123");
    const service = await import("../src/main/vault/service");
    service.addCredential("default", "openai", "Primary", "sk-default", "OPENAI_API_KEY");

    vi.spyOn(service, "activateProfile").mockImplementation((profile) => {
      if (profile === "broken") {
        throw new Error("activation failed");
      }
    });
    const wizard = await import("../src/main/profiles/wizard");

    await expect(wizard.activateProfileWithRollback("broken")).rejects.toThrow(
      /activation failed/,
    );

    expect(readFileSync(join(testHome, "active_profile"), "utf-8").trim()).toBe("default");
    expect(readFileSync(join(testHome, ".env"), "utf-8")).toContain(
      "HERMES_INFERENCE_PROVIDER=default-profile",
    );
    expect(
      readFileSync(join(testHome, "profiles", "broken", ".env"), "utf-8"),
    ).toContain("HERMES_INFERENCE_PROVIDER=broken-profile");

    const leftover = existsSync(join(testHome, "desktop"))
      ? readdirSync(join(testHome, "desktop"))
      : [];
    expect(leftover.filter((name) => name.startsWith("activation-"))).toHaveLength(0);
  });
});

describe("profile migration IPC guards", () => {
  it("profile handlers source uses remote guard and unsupported helper", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(
      join(process.cwd(), "src/main/ipc/profile-handlers.ts"),
      "utf-8",
    );
    expect(src).toContain("unsupportedInRemoteMode");
    expect(src).toContain("profile-detect-migration");
    expect(src).toContain("profile-migrate-env");
    expect(src).toContain("isRemoteOnlyMode");
  });
});
