import { Notification } from "electron";
import {
  getOwnerNotificationPrefs,
  readDesktopConfig,
  writeDesktopConfig,
} from "./config";
import {
  sendEmailViaGateway,
  sendTelegramViaGateway,
} from "./contact-messaging";
import { formatLogError, log } from "./log";
import { getActiveProfileNameSync } from "./utils";
import type {
  OwnerDeliverySummary,
  OwnerNotificationChannel,
  OwnerNotificationEvent,
  OwnerNotificationPrefs,
} from "../shared/owner-notifications";
import { OWNER_NOTIFICATION_CHANNELS } from "../shared/owner-notifications";

export interface OwnerDeliveryInput {
  event: OwnerNotificationEvent;
  title: string;
  body: string;
  dedupeKey?: string;
  idempotencyKey?: string;
  respectQuietHours?: boolean;
}

export interface OwnerDeliveryChannelResult {
  channel: OwnerNotificationChannel;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

export interface OwnerDeliveryResult {
  ok: boolean;
  results: OwnerDeliveryChannelResult[];
}

export interface OwnerDeliverySenders {
  macos?: (title: string, body: string) => Promise<boolean> | boolean;
  telegram?: (
    chatId: string,
    message: string,
    profile?: string,
  ) => Promise<boolean> | boolean;
  email?: (
    to: string,
    subject: string,
    body: string,
    profile?: string,
  ) => Promise<boolean> | boolean;
  whatsapp?: (
    target: string,
    message: string,
    profile?: string,
  ) => Promise<boolean> | boolean;
}

export interface OwnerDeliveryOptions {
  now?: Date;
  senders?: OwnerDeliverySenders;
}

const OWNER_DELIVERY_STATE_KEY = "ownerDeliveryStateByProfile";
const OWNER_DELIVERY_STATUS = new Set<OwnerDeliverySummary["status"]>([
  "not-configured",
  "ok",
  "warning",
  "failed",
]);

function profileKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}

function stateMap(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data[OWNER_DELIVERY_STATE_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function profileDeliveryState(profile?: string): Record<string, unknown> {
  const data = readDesktopConfig();
  const raw = stateMap(data)[profileKey(profile)];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function deliveryState(profile?: string): Record<string, string> {
  const record = profileDeliveryState(profile);
  const lastSentAtByKey = record.lastSentAtByKey;
  return lastSentAtByKey && typeof lastSentAtByKey === "object"
    ? (lastSentAtByKey as Record<string, string>)
    : {};
}

function writeProfileDeliveryState(
  patch: Record<string, unknown>,
  profile?: string,
): void {
  const data = readDesktopConfig();
  const map = stateMap(data);
  const key = profileKey(profile);
  const current = profileDeliveryState(profile);
  map[key] = { ...current, ...patch };
  data[OWNER_DELIVERY_STATE_KEY] = map;
  writeDesktopConfig(data);
}

function recordDelivery(key: string, at: Date, profile?: string): void {
  const current = deliveryState(profile);
  current[key] = at.toISOString();
  writeProfileDeliveryState({ lastSentAtByKey: current }, profile);
}

function minutesFromMidnight(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isOwnerQuietHoursActive(
  prefs: OwnerNotificationPrefs,
  now: Date,
): boolean {
  if (!prefs.quietHours.enabled) return false;
  const start = minutesFromMidnight(prefs.quietHours.start);
  const end = minutesFromMidnight(prefs.quietHours.end);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function defaultMacosSender(title: string, body: string): boolean {
  try {
    if (Notification.isSupported && !Notification.isSupported()) return false;
    new Notification({ title, body }).show();
    return true;
  } catch (err) {
    log.error("owner-delivery", {
      msg: "macOS notification failed",
      title,
      error: formatLogError(err),
    });
    return false;
  }
}

function deliveryKey(input: OwnerDeliveryInput, channel: string): string {
  return `${input.event}:${input.dedupeKey || input.title}:${channel}`;
}

function idempotencyKey(
  input: OwnerDeliveryInput,
  channel: string,
): string | null {
  return input.idempotencyKey
    ? `idempotent:${input.idempotencyKey}:${channel}`
    : null;
}

function isRateLimited(
  key: string,
  prefs: OwnerNotificationPrefs,
  now: Date,
  profile?: string,
): boolean {
  if (prefs.rateLimitMinutes <= 0) return false;
  const lastSent = deliveryState(profile)[key];
  if (!lastSent) return false;
  const lastMs = new Date(lastSent).getTime();
  if (Number.isNaN(lastMs)) return false;
  return now.getTime() - lastMs < prefs.rateLimitMinutes * 60_000;
}

async function runSender(
  channel: OwnerNotificationChannel,
  send: () => Promise<boolean> | boolean,
): Promise<OwnerDeliveryChannelResult> {
  try {
    const ok = await send();
    return ok
      ? { channel, status: "sent" }
      : { channel, status: "failed", reason: "send-failed" };
  } catch (err) {
    log.error("owner-delivery", {
      msg: "owner delivery sender failed",
      channel,
      error: formatLogError(err),
    });
    return { channel, status: "failed", reason: "send-failed" };
  }
}

function channelLabel(channel: OwnerNotificationChannel): string {
  if (channel === "macos") return "macOS";
  if (channel === "telegram") return "Telegram";
  if (channel === "email") return "email";
  return "WhatsApp";
}

function normalizeOwnerDeliverySummary(value: unknown): OwnerDeliverySummary {
  const data = value && typeof value === "object" ? value : {};
  const raw = data as Record<string, unknown>;
  const status = OWNER_DELIVERY_STATUS.has(
    raw.status as OwnerDeliverySummary["status"],
  )
    ? (raw.status as OwnerDeliverySummary["status"])
    : "not-configured";
  return {
    status,
    summary:
      typeof raw.summary === "string"
        ? raw.summary
        : "No owner delivery attempts recorded yet.",
    lastDeliveredAt:
      typeof raw.lastDeliveredAt === "string" ? raw.lastDeliveredAt : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
  };
}

export function getOwnerDeliverySummary(
  profile?: string,
): OwnerDeliverySummary {
  const raw = profileDeliveryState(profile).lastResult;
  return normalizeOwnerDeliverySummary(raw);
}

function summarizeDeliveryResult(
  result: OwnerDeliveryResult,
  now: Date,
  profile?: string,
): OwnerDeliverySummary {
  const previous = getOwnerDeliverySummary(profile);
  const sent = result.results.filter((item) => item.status === "sent");
  if (sent.length > 0) {
    return {
      status: "ok",
      summary: `Sent via ${sent.map((item) => channelLabel(item.channel)).join(", ")}.`,
      lastDeliveredAt: now.toISOString(),
      lastError: null,
    };
  }

  const failed = result.results.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    const error = failed
      .map(
        (item) => `${channelLabel(item.channel)}: ${item.reason ?? "failed"}`,
      )
      .join("; ");
    return {
      status: "failed",
      summary: `Failed via ${failed.map((item) => channelLabel(item.channel)).join(", ")}.`,
      lastDeliveredAt: previous.lastDeliveredAt,
      lastError: error,
    };
  }

  const reasons = Array.from(
    new Set(result.results.map((item) => item.reason ?? "skipped")),
  );
  const noConfiguredChannels = result.results.every(
    (item) =>
      item.status === "skipped" &&
      (item.reason === "disabled" || item.reason === "unconfigured"),
  );
  return {
    status: noConfiguredChannels ? "not-configured" : "warning",
    summary: noConfiguredChannels
      ? "No owner delivery channels are enabled and configured."
      : `Skipped owner delivery: ${reasons.join(", ")}.`,
    lastDeliveredAt: previous.lastDeliveredAt,
    lastError: null,
  };
}

function recordOwnerDeliverySummary(
  result: OwnerDeliveryResult,
  now: Date,
  profile?: string,
): void {
  writeProfileDeliveryState(
    { lastResult: summarizeDeliveryResult(result, now, profile) },
    profile,
  );
}

export async function deliverOwnerNotification(
  input: OwnerDeliveryInput,
  profile?: string,
  options: OwnerDeliveryOptions = {},
): Promise<OwnerDeliveryResult> {
  const prefs = getOwnerNotificationPrefs(profile);
  const now = options.now ?? new Date();
  const senders = options.senders ?? {};
  const results: OwnerDeliveryChannelResult[] = [];
  if (!prefs.events[input.event]) {
    const result: OwnerDeliveryResult = {
      ok: false,
      results: OWNER_NOTIFICATION_CHANNELS.map((channel) => ({
        channel,
        status: "skipped",
        reason: "event-disabled",
      })),
    };
    recordOwnerDeliverySummary(result, now, profile);
    return result;
  }
  if (
    input.respectQuietHours !== false &&
    isOwnerQuietHoursActive(prefs, now)
  ) {
    const result: OwnerDeliveryResult = {
      ok: false,
      results: OWNER_NOTIFICATION_CHANNELS.map((channel) => ({
        channel,
        status: "skipped",
        reason: "quiet-hours",
      })),
    };
    recordOwnerDeliverySummary(result, now, profile);
    return result;
  }
  for (const channel of OWNER_NOTIFICATION_CHANNELS) {
    if (!prefs.channels[channel]) {
      results.push({ channel, status: "skipped", reason: "disabled" });
      continue;
    }
    const key = deliveryKey(input, channel);
    const onceKey = idempotencyKey(input, channel);
    if (onceKey && deliveryState(profile)[onceKey]) {
      results.push({ channel, status: "skipped", reason: "already-sent" });
      continue;
    }
    if (isRateLimited(key, prefs, now, profile)) {
      results.push({ channel, status: "skipped", reason: "rate-limited" });
      continue;
    }
    const message = `${input.title}\n\n${input.body}`.trim();
    let result: OwnerDeliveryChannelResult;
    if (channel === "macos") {
      result = await runSender(channel, () =>
        (senders.macos ?? defaultMacosSender)(input.title, input.body),
      );
    } else if (channel === "telegram") {
      const chatId = prefs.targets.telegramChatId.trim();
      result = chatId
        ? await runSender(channel, () =>
            (senders.telegram ?? sendTelegramViaGateway)(
              chatId,
              message,
              profile,
            ),
          )
        : { channel, status: "skipped", reason: "unconfigured" };
    } else if (channel === "email") {
      const to = prefs.targets.emailAddress.trim();
      result = to
        ? await runSender(channel, () =>
            (senders.email ?? sendEmailViaGateway)(
              to,
              input.title,
              input.body,
              profile,
            ),
          )
        : { channel, status: "skipped", reason: "unconfigured" };
    } else {
      const target = prefs.targets.whatsappTarget.trim();
      result =
        target && senders.whatsapp
          ? await runSender(
              channel,
              () => senders.whatsapp?.(target, message, profile) ?? false,
            )
          : { channel, status: "skipped", reason: "unconfigured" };
    }
    if (result.status === "sent") {
      recordDelivery(key, now, profile);
      if (onceKey) recordDelivery(onceKey, now, profile);
    }
    results.push(result);
  }
  const result = {
    ok: results.some((result) => result.status === "sent"),
    results,
  };
  recordOwnerDeliverySummary(result, now, profile);
  return result;
}
