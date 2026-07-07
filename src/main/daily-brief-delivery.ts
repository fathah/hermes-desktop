import { dailyBriefDeliveryBody, dailyBriefFileName } from "./daily-brief";
import {
  deliverOwnerNotification,
  type OwnerDeliveryResult,
} from "./owner-delivery";

export function dailyBriefDeliveryTitle(date: Date): string {
  return dailyBriefFileName(date).replace(/\.md$/, "");
}

export async function deliverDailyBrief(
  markdown: string,
  date: Date,
  profile?: string,
): Promise<OwnerDeliveryResult> {
  const title = dailyBriefDeliveryTitle(date);
  const key = `daily-brief:${date.toISOString().slice(0, 10)}`;
  return deliverOwnerNotification(
    {
      event: "brief",
      title,
      body: dailyBriefDeliveryBody(markdown),
      dedupeKey: key,
      idempotencyKey: key,
    },
    profile,
  );
}
