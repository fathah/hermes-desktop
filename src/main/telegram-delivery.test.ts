import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadTelegramDelivery(): Promise<
  typeof import("./telegram-delivery")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("./telegram-delivery");
}

describe("Telegram delivery status", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-telegram-delivery-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("reports unavailable when the channel directory is missing", async () => {
    const { getTelegramDeliveryStatus, telegramChannelConfigured } =
      await loadTelegramDelivery();

    expect(getTelegramDeliveryStatus()).toEqual({
      available: false,
      reason: "missing-channel",
      message: "No configured Telegram channel was found.",
    });
    expect(telegramChannelConfigured()).toBe(false);
  });

  it("reports available when the channel directory contains a Telegram target", async () => {
    mkdirSync(testHome, { recursive: true });
    writeFileSync(
      join(testHome, "channel_directory.json"),
      JSON.stringify({ channels: [{ target: "telegram:123456" }] }),
    );
    const { getTelegramDeliveryStatus, telegramChannelConfigured } =
      await loadTelegramDelivery();

    expect(getTelegramDeliveryStatus()).toEqual({
      available: true,
      reason: "configured",
      message: "Telegram channel is configured.",
    });
    expect(telegramChannelConfigured()).toBe(true);
  });

  it("reports unavailable when the channel directory has no Telegram target", async () => {
    mkdirSync(testHome, { recursive: true });
    writeFileSync(
      join(testHome, "channel_directory.json"),
      JSON.stringify({ channels: [{ target: "discord:#ops" }] }),
    );
    const { getTelegramDeliveryStatus, telegramChannelConfigured } =
      await loadTelegramDelivery();

    expect(getTelegramDeliveryStatus()).toEqual({
      available: false,
      reason: "missing-channel",
      message: "No configured Telegram channel was found.",
    });
    expect(telegramChannelConfigured()).toBe(false);
  });
});
