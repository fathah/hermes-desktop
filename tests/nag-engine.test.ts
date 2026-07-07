import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliverOwnerNotification: vi.fn(),
  getSpsNoteIndex: vi.fn(),
  listNagRecords: vi.fn(),
  notificationShow: vi.fn(),
  removeNagRecord: vi.fn(),
  sendTelegramViaGateway: vi.fn(),
  setNagRecord: vi.fn(),
}));

vi.mock("electron", () => ({
  Notification: vi.fn(function MockNotification(options) {
    return { show: () => mocks.notificationShow(options) };
  }),
}));

vi.mock("../src/main/note-index", () => ({
  getSpsNoteIndex: mocks.getSpsNoteIndex,
}));

vi.mock("../src/main/tasks-dump", () => ({
  listNagRecords: mocks.listNagRecords,
  removeNagRecord: mocks.removeNagRecord,
  setNagRecord: mocks.setNagRecord,
}));

vi.mock("../src/main/contact-messaging", () => ({
  sendTelegramViaGateway: mocks.sendTelegramViaGateway,
}));

vi.mock("../src/main/owner-delivery", () => ({
  deliverOwnerNotification: mocks.deliverOwnerNotification,
}));

vi.mock("../src/main/log", () => ({
  formatLogError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  log: {
    error: vi.fn(),
  },
}));

import { nagTick } from "../src/main/nag-engine";

const NOW = new Date("2026-07-07T12:00:00.000Z").getTime();

function seedNag(
  overrides: {
    assigneeId?: string;
    autoSendOnEscalate?: boolean;
    nagCount?: number;
    personRows?: Array<{ path: string; props: Record<string, unknown> }>;
  } = {},
): void {
  const nagCount = overrides.nagCount ?? 4;
  mocks.listNagRecords.mockResolvedValue([
    {
      rowId: "t1",
      nagCount,
      nextNagAt: NOW - 1,
      cadence: "daily",
    },
  ]);
  mocks.getSpsNoteIndex.mockResolvedValue({
    query: ({ scope }: { scope?: string }) => {
      if (scope === "tasks") {
        return [
          {
            path: "tasks/t1.md",
            title: "Renew insurance",
            props: {
              title: "Renew insurance",
              status: "todo",
              autoSendOnEscalate: overrides.autoSendOnEscalate === true,
              ...(overrides.assigneeId
                ? { assigneeId: overrides.assigneeId }
                : {}),
            },
          },
        ];
      }
      return overrides.personRows ?? [];
    },
  });
}

describe("nag engine owner escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mocks.deliverOwnerNotification.mockResolvedValue({ ok: true, results: [] });
    mocks.sendTelegramViaGateway.mockResolvedValue(true);
    mocks.setNagRecord.mockResolvedValue(undefined);
    mocks.removeNagRecord.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not use owner delivery before the channel escalation tier", async () => {
    seedNag({ nagCount: 2 });

    await nagTick("work");

    expect(mocks.notificationShow).toHaveBeenCalledWith(
      expect.objectContaining({ title: "⏰ Still waiting" }),
    );
    expect(mocks.deliverOwnerNotification).not.toHaveBeenCalled();
    expect(mocks.sendTelegramViaGateway).not.toHaveBeenCalled();
  });

  it("delivers channel-tier nags through owner delivery", async () => {
    seedNag({ assigneeId: "p-wife" });

    await nagTick("work");

    expect(mocks.notificationShow).toHaveBeenCalledWith(
      expect.objectContaining({ title: "⏰ Overdue — needs action" }),
    );
    expect(mocks.deliverOwnerNotification).toHaveBeenCalledWith(
      {
        event: "nag",
        title: "Overdue task needs action",
        body: "Renew insurance",
        dedupeKey: "nag:t1:channel",
      },
      "work",
    );
    expect(mocks.sendTelegramViaGateway).not.toHaveBeenCalled();
  });

  it("advances nags when owner delivery skips for quiet hours", async () => {
    mocks.deliverOwnerNotification.mockResolvedValueOnce({
      ok: false,
      results: [{ channel: "macos", status: "skipped", reason: "quiet-hours" }],
    });
    seedNag();

    await nagTick("work");

    expect(mocks.setNagRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "t1",
        nagCount: 5,
      }),
      "work",
    );
    expect(mocks.sendTelegramViaGateway).not.toHaveBeenCalled();
  });

  it("keeps assignee auto-send separate from owner delivery", async () => {
    seedNag({
      assigneeId: "p-wife",
      autoSendOnEscalate: true,
      personRows: [
        {
          path: "people/p-wife.md",
          props: { telegramChatId: "12345" },
        },
      ],
    });

    await nagTick("work");

    expect(mocks.deliverOwnerNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "nag",
        body: "Renew insurance",
      }),
      "work",
    );
    expect(mocks.sendTelegramViaGateway).toHaveBeenCalledWith(
      "12345",
      "Reminder: Renew insurance",
      "work",
    );
  });
});
