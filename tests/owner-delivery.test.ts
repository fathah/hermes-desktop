import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("electron", () => ({
  Notification: Object.assign(
    vi.fn().mockImplementation(() => ({ show: vi.fn() })),
    { isSupported: () => true },
  ),
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf-8"),
  },
  shell: { openExternal: vi.fn() },
}));

async function fresh(home: string): Promise<{
  config: typeof import("../src/main/config");
  delivery: typeof import("../src/main/owner-delivery");
}> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  const config = await import("../src/main/config");
  const delivery = await import("../src/main/owner-delivery");
  return { config, delivery };
}

describe("owner delivery", () => {
  let testHome: string;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-owner-delivery-"));
  });

  afterEach(() => {
    delete process.env.HERMES_HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("sends default owner notifications only to macOS", async () => {
    const { delivery } = await fresh(testHome);
    const macos = vi.fn(() => true);
    const telegram = vi.fn(() => true);
    const email = vi.fn(() => true);

    const result = await delivery.deliverOwnerNotification(
      { event: "brief", title: "Morning brief", body: "Ready." },
      "work",
      {
        now: new Date("2026-07-07T09:00:00"),
        senders: { macos, telegram, email },
      },
    );

    expect(result.ok).toBe(true);
    expect(macos).toHaveBeenCalledWith("Morning brief", "Ready.");
    expect(telegram).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
    expect(result.results).toEqual(
      expect.arrayContaining([
        { channel: "macos", status: "sent" },
        { channel: "telegram", status: "skipped", reason: "disabled" },
        { channel: "email", status: "skipped", reason: "disabled" },
      ]),
    );
    expect(delivery.getOwnerDeliverySummary("work")).toMatchObject({
      status: "ok",
      summary: "Sent via macOS.",
      lastDeliveredAt: new Date("2026-07-07T09:00:00").toISOString(),
      lastError: null,
    });
  });

  it("fans out to enabled configured channels and rate-limits repeats", async () => {
    const { config, delivery } = await fresh(testHome);
    config.setOwnerNotificationPrefs(
      {
        channels: { macos: true, telegram: true, email: true },
        targets: {
          telegramChatId: "12345",
          emailAddress: "owner@example.com",
        },
        rateLimitMinutes: 10,
      },
      "work",
    );
    const macos = vi.fn(() => true);
    const telegram = vi.fn(() => true);
    const email = vi.fn(() => true);

    const first = await delivery.deliverOwnerNotification(
      {
        event: "alert",
        title: "Site alert",
        body: "Gate 2 needs review.",
        dedupeKey: "gate-2",
      },
      "work",
      {
        now: new Date("2026-07-07T09:00:00"),
        senders: { macos, telegram, email },
      },
    );
    const second = await delivery.deliverOwnerNotification(
      {
        event: "alert",
        title: "Site alert",
        body: "Gate 2 needs review.",
        dedupeKey: "gate-2",
      },
      "work",
      {
        now: new Date("2026-07-07T09:05:00"),
        senders: { macos, telegram, email },
      },
    );

    expect(first.ok).toBe(true);
    expect(telegram).toHaveBeenCalledWith(
      "12345",
      "Site alert\n\nGate 2 needs review.",
      "work",
    );
    expect(email).toHaveBeenCalledWith(
      "owner@example.com",
      "Site alert",
      "Gate 2 needs review.",
      "work",
    );
    expect(second.ok).toBe(false);
    expect(second.results).toEqual(
      expect.arrayContaining([
        { channel: "macos", status: "skipped", reason: "rate-limited" },
        { channel: "telegram", status: "skipped", reason: "rate-limited" },
        { channel: "email", status: "skipped", reason: "rate-limited" },
      ]),
    );
  });

  it("does not resend idempotent notifications after the rate-limit window", async () => {
    const { config, delivery } = await fresh(testHome);
    config.setOwnerNotificationPrefs({ rateLimitMinutes: 1 }, "work");
    const macos = vi.fn(() => true);
    const input = {
      event: "brief" as const,
      title: "Morning brief",
      body: "Ready.",
      dedupeKey: "daily-brief:2026-07-07",
      idempotencyKey: "daily-brief:2026-07-07",
    };

    const first = await delivery.deliverOwnerNotification(input, "work", {
      now: new Date("2026-07-07T09:00:00"),
      senders: { macos },
    });
    const second = await delivery.deliverOwnerNotification(input, "work", {
      now: new Date("2026-07-07T10:00:00"),
      senders: { macos },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(macos).toHaveBeenCalledTimes(1);
    expect(second.results).toEqual(
      expect.arrayContaining([
        { channel: "macos", status: "skipped", reason: "already-sent" },
      ]),
    );
  });

  it("respects quiet hours and event-level opt-out", async () => {
    const { config, delivery } = await fresh(testHome);
    config.setOwnerNotificationPrefs(
      {
        quietHours: { enabled: true, start: "22:00", end: "07:00" },
        events: { update: false },
      },
      "work",
    );
    const macos = vi.fn(() => true);

    const quiet = await delivery.deliverOwnerNotification(
      { event: "brief", title: "Brief", body: "Done." },
      "work",
      { now: new Date("2026-07-07T23:00:00"), senders: { macos } },
    );
    const disabled = await delivery.deliverOwnerNotification(
      { event: "update", title: "Update", body: "Available." },
      "work",
      {
        now: new Date("2026-07-07T09:00:00"),
        senders: { macos },
      },
    );

    expect(quiet.ok).toBe(false);
    expect(disabled.ok).toBe(false);
    expect(macos).not.toHaveBeenCalled();
    expect(quiet.results[0]).toMatchObject({ reason: "quiet-hours" });
    expect(disabled.results[0]).toMatchObject({ reason: "event-disabled" });
    expect(delivery.getOwnerDeliverySummary("work")).toMatchObject({
      status: "warning",
      summary: "Skipped owner delivery: event-disabled.",
    });
  });
});
