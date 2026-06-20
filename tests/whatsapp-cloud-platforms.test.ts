import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createMockKeychain } from "./helpers/mock-keychain";

let testHome: string;
const keychain = createMockKeychain();

async function loadConfigModule(): Promise<
  typeof import("../src/main/config")
> {
  vi.resetModules();
  keychain.install();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

describe("WhatsApp Cloud platform enablement", () => {
  beforeEach(() => {
    keychain.reset();
    testHome = mkdtempSync(join(tmpdir(), "hermes-wa-cloud-platform-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("is disabled when required env vars are missing", async () => {
    const { getPlatformEnabled } = await loadConfigModule();

    expect(getPlatformEnabled().whatsapp_cloud).toBe(false);
  });

  it("is enabled when Phone Number ID and Access Token are configured", async () => {
    const { getPlatformEnabled, setEnvValue } = await loadConfigModule();

    setEnvValue("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "123456789012345");
    setEnvValue("WHATSAPP_CLOUD_ACCESS_TOKEN", "EAA_VALID_TOKEN");

    expect(getPlatformEnabled().whatsapp_cloud).toBe(true);
  });

  it("honors explicit disable and re-enable overrides", async () => {
    const { getPlatformEnabled, setEnvValue, setPlatformEnabled } =
      await loadConfigModule();

    setEnvValue("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "123456789012345");
    setEnvValue("WHATSAPP_CLOUD_ACCESS_TOKEN", "EAA_VALID_TOKEN");
    setPlatformEnabled("whatsapp_cloud", false);

    expect(getPlatformEnabled().whatsapp_cloud).toBe(false);

    setPlatformEnabled("whatsapp_cloud", true);

    expect(getPlatformEnabled().whatsapp_cloud).toBe(true);
    expect(readFileSync(join(testHome, "config.yaml"), "utf-8")).not.toContain(
      "enabled: false",
    );
  });
});
