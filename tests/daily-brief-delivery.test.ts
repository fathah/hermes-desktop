import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliverOwnerNotification: vi.fn(),
}));

vi.mock("../src/main/owner-delivery", () => ({
  deliverOwnerNotification: mocks.deliverOwnerNotification,
}));

import {
  deliverDailyBrief,
  dailyBriefDeliveryTitle,
} from "../src/main/daily-brief-delivery";

describe("daily brief delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliverOwnerNotification.mockResolvedValue({
      ok: true,
      results: [],
    });
  });

  it("uses the daily brief filename as the notification title", () => {
    expect(dailyBriefDeliveryTitle(new Date("2026-07-07T12:00:00.000Z"))).toBe(
      "Daily Brief - 2026-07-07",
    );
  });

  it("delivers briefs through owner notification idempotently per day", async () => {
    const markdown = [
      "---",
      'title: "Daily Brief - 2026-07-07"',
      "kind: daily-brief",
      "context: review",
      "---",
      "# Daily Brief",
      "",
      "Ready for review.",
    ].join("\n");

    await deliverDailyBrief(
      markdown,
      new Date("2026-07-07T12:00:00.000Z"),
      "work",
    );

    expect(mocks.deliverOwnerNotification).toHaveBeenCalledWith(
      {
        event: "brief",
        title: "Daily Brief - 2026-07-07",
        body: "Daily Brief Ready for review.",
        dedupeKey: "daily-brief:2026-07-07",
        idempotencyKey: "daily-brief:2026-07-07",
      },
      "work",
    );
  });
});
