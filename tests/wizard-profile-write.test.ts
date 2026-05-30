import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("../src/main/profiles", () => ({
  createProfile: vi.fn(() => ({ success: true })),
  deleteProfile: vi.fn(() => ({ success: true })),
  setActiveProfile: vi.fn(),
}));

vi.mock("../src/main/hermes", () => ({
  startGateway: vi.fn(async () => true),
  isGatewayRunning: vi.fn(() => true),
}));

let testHome: string;

describe("wizard profile writer", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-wizard-"));
    vi.stubEnv("HERMES_HOME", testHome);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("creates profile files from wizard state", async () => {
    vi.resetModules();
    const keychain = await import("../src/main/vault/keychain");
    keychain.initVaultWithPassword("test-pass");

    const { createProfileFromWizard } = await import("../src/main/profiles/wizard");
    const { initialWizardState } = await import("../src/main/profiles/wizard");

    const state = initialWizardState("research");
    state.profileName = "test-research";
    state.primaryApiKey = "sk-test-key-long-enough";
    state.selectedModels = ["deepseek-chat"];
    state.firecrawlApiKey = "fc-test-key";
    state.activateAfterCreate = false;

    const result = await createProfileFromWizard(state);
    expect(result.success).toBe(true);

    const profileDir = join(testHome, "profiles", "test-research");
    expect(existsSync(join(profileDir, "config.yaml"))).toBe(true);
    expect(existsSync(join(profileDir, "SOUL.md"))).toBe(true);

    const soul = readFileSync(join(profileDir, "SOUL.md"), "utf-8");
    expect(soul).toContain("Research Agent");

    const config = readFileSync(join(profileDir, "config.yaml"), "utf-8");
    expect(config).toContain("deepseek");
  });
});
