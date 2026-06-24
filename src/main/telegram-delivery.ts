import { readFileSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer/paths";
import type { TelegramDeliveryStatus } from "../shared/scheduledResearch";

const TELEGRAM_CONFIGURED: TelegramDeliveryStatus = {
  available: true,
  reason: "configured",
  message: "Telegram channel is configured.",
};

const TELEGRAM_MISSING_CHANNEL: TelegramDeliveryStatus = {
  available: false,
  reason: "missing-channel",
  message: "No configured Telegram channel was found.",
};

export function getTelegramDeliveryStatus(
  _profile?: string,
): TelegramDeliveryStatus {
  try {
    const raw = readFileSync(
      join(HERMES_HOME, "channel_directory.json"),
      "utf-8",
    );
    if (raw.toLowerCase().includes("telegram")) {
      return { ...TELEGRAM_CONFIGURED };
    }
  } catch {
    /* fail closed */
  }
  return { ...TELEGRAM_MISSING_CHANNEL };
}

export function telegramChannelConfigured(profile?: string): boolean {
  return getTelegramDeliveryStatus(profile).available;
}
