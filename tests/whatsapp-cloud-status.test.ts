import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadConfigModule(): Promise<
  typeof import("../src/main/config")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

async function loadStatusModule(): Promise<
  typeof import("../src/main/whatsapp-cloud-status")
> {
  return await import("../src/main/whatsapp-cloud-status");
}

function mockFetch(
  impl: () => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<Record<string, unknown>>;
  }>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WhatsApp Cloud status", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-wa-cloud-status-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("reports missing required env vars and a closed health state", async () => {
    const fetchMock = mockFetch(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    await loadConfigModule();
    const { getWhatsAppCloudStatus } = await loadStatusModule();

    const status = await getWhatsAppCloudStatus();

    expect(status.configuredForGateway).toBe(false);
    expect(status.readyForInbound).toBe(false);
    expect(status.requiredMissing).toEqual([
      "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
      "WHATSAPP_CLOUD_ACCESS_TOKEN",
    ]);
    expect(status.healthReachable).toBe(false);
    expect(status.error).toContain("connect ECONNREFUSED");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8090/health",
      expect.any(Object),
    );
  });

  it("reports inbound readiness from configured env and health payload", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        phone_number_id: true,
        verify_token_configured: true,
        app_secret_configured: true,
        ffmpeg_present: true,
      }),
    }));
    const { setEnvValue } = await loadConfigModule();
    setEnvValue("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "123456789012345");
    setEnvValue(
      "WHATSAPP_CLOUD_ACCESS_TOKEN",
      "EAA_TEST_TOKEN_SHOULD_NOT_LEAK_TO_RENDERER",
    );
    setEnvValue(
      "WHATSAPP_CLOUD_APP_SECRET",
      "abcdefabcdefabcdefabcdefabcdefab",
    );
    setEnvValue("WHATSAPP_CLOUD_VERIFY_TOKEN", "verify-token-1234567890");
    setEnvValue("WHATSAPP_CLOUD_WEBHOOK_PORT", "8091");
    setEnvValue("WHATSAPP_CLOUD_WEBHOOK_PATH", "whatsapp/webhook");
    const { getWhatsAppCloudStatus } = await loadStatusModule();

    const status = await getWhatsAppCloudStatus();

    expect(status.configuredForGateway).toBe(true);
    expect(status.readyForInbound).toBe(true);
    expect(status.healthReachable).toBe(true);
    expect(status.webhookPort).toBe(8091);
    expect(status.webhookPath).toBe("/whatsapp/webhook");
    expect(status.health?.ffmpeg_present).toBe(true);
    expect(JSON.stringify(status)).not.toContain(
      "EAA_TEST_TOKEN_SHOULD_NOT_LEAK_TO_RENDERER",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8091/health",
      expect.any(Object),
    );
  });

  it("reports health HTTP failures without marking inbound ready", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    const { setEnvValue } = await loadConfigModule();
    setEnvValue("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "123456789012345");
    setEnvValue("WHATSAPP_CLOUD_ACCESS_TOKEN", "EAA_VALID_TOKEN");
    const { getWhatsAppCloudStatus } = await loadStatusModule();

    const status = await getWhatsAppCloudStatus();

    expect(status.configuredForGateway).toBe(true);
    expect(status.readyForInbound).toBe(false);
    expect(status.healthReachable).toBe(false);
    expect(status.error).toContain("HTTP 503");
  });

  it("falls back to the default port for invalid webhook ports", async () => {
    const fetchMock = mockFetch(async () => {
      throw new Error("not listening");
    });
    const { setEnvValue } = await loadConfigModule();
    setEnvValue("WHATSAPP_CLOUD_WEBHOOK_PORT", "99999");
    const { getWhatsAppCloudStatus } = await loadStatusModule();

    const status = await getWhatsAppCloudStatus();

    expect(status.webhookPort).toBe(8090);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8090/health",
      expect.any(Object),
    );
  });
});
