import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import {
  normalizeActionReceipt,
  serializeActionReceipt,
  type ActionReceipt,
} from "../shared/action-receipts";
import { getActiveProfileNameSync, profileHome } from "./utils";

const RECEIPT_LOG = "action-receipts.jsonl";

export function actionReceiptLogPath(profile?: string): string {
  const home = profileHome(profile || getActiveProfileNameSync());
  return join(home, "logs", RECEIPT_LOG);
}

export function appendActionReceipt(
  input: Record<string, unknown>,
  profile?: string,
): void {
  try {
    const receipt = normalizeActionReceipt({
      ...input,
      profile: input.profile ?? profile ?? "default",
    });
    const logPath = actionReceiptLogPath(profile);
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, serializeActionReceipt(receipt), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    // Best effort: receipts must never block the user action.
  }
}

export function readRecentActionReceipts(
  limit = 20,
  profile?: string,
): ActionReceipt[] {
  try {
    const take = Math.max(0, Math.floor(limit));
    if (take === 0) return [];
    const logPath = actionReceiptLogPath(profile);
    if (!existsSync(logPath)) return [];
    const rows = readFileSync(logPath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed: ActionReceipt[] = [];
    for (const line of rows) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        parsed.push(normalizeActionReceipt(value));
      } catch {
        // skip malformed historical rows
      }
    }
    return parsed.slice(-take).reverse();
  } catch {
    return [];
  }
}
