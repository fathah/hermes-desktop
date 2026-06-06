// equity-alerts.ts — desktop half of the equity alert engine. The Python skill
// (india-equity-alerts/evaluate_alerts.py) appends fired alerts to
//   <profileHome>/sps-agent/equity-alerts.jsonl
// This module (a) exposes list/markRead for the in-app Alert Center, mirroring
// the Python alert_store, and (b) watches the jsonl so each newly-appended alert
// fires an OS notification + an `equity-alert` event to the renderer.
//
// Read/markRead must agree byte-for-byte with the Python writer: one JSON object
// per line; markRead rewrites the file with `read: true` flipped.

import { promises as fs, watch, type FSWatcher } from "fs";
import { join } from "path";
import { Notification, type BrowserWindow } from "electron";
import { profileHome, getActiveProfileNameSync } from "./utils";

export interface EquityAlert {
  id: string;
  ts: string;
  ticker: string | null;
  trigger: string;
  direction?: string;
  message: string;
  read?: boolean;
}

const ALERTS_FILE = "equity-alerts.jsonl";

function alertsDir(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "sps-agent");
}

function alertsPath(profile?: string): string {
  return join(alertsDir(profile), ALERTS_FILE);
}

function parseLines(text: string): EquityAlert[] {
  const out: EquityAlert[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as EquityAlert);
    } catch {
      // tolerate a torn final line mid-append; the next read picks it up
    }
  }
  return out;
}

export async function listAlerts(
  limit?: number,
  profile?: string,
): Promise<EquityAlert[]> {
  let text: string;
  try {
    text = await fs.readFile(alertsPath(profile), "utf-8");
  } catch {
    return [];
  }
  const all = parseLines(text);
  return limit != null ? all.slice(-limit) : all;
}

export async function markAlertRead(
  alertId: string,
  profile?: string,
): Promise<boolean> {
  const path = alertsPath(profile);
  let text: string;
  try {
    text = await fs.readFile(path, "utf-8");
  } catch {
    return false;
  }
  const alerts = parseLines(text);
  let found = false;
  for (const alert of alerts) {
    if (alert.id === alertId && !alert.read) {
      alert.read = true;
      found = true;
    }
  }
  if (!found) return false;
  const rewritten =
    alerts.map((a) => JSON.stringify(a)).join("\n") +
    (alerts.length ? "\n" : "");
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, rewritten, "utf-8");
  await fs.rename(tmp, path);
  return true;
}

// ── watcher ────────────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastCount = 0;
let pending = false;

async function checkForNew(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    const alerts = await listAlerts(undefined);
    if (alerts.length <= lastCount) {
      lastCount = Math.min(lastCount, alerts.length); // file truncated/rewritten
      return;
    }
    const fresh = alerts.slice(lastCount);
    lastCount = alerts.length;
    const win = getWindow();
    for (const alert of fresh) {
      win?.webContents.send("equity-alert", alert);
      if (Notification.isSupported()) {
        new Notification({
          title: alert.ticker
            ? `Equity alert · ${alert.ticker}`
            : "Equity alert",
          body: alert.message,
        }).show();
      }
    }
  } finally {
    pending = false;
  }
}

/**
 * Begin watching the active profile's alert log. Pre-existing alerts are NOT
 * re-notified — only lines appended after start fire. Idempotent.
 */
export async function startEquityAlertWatcher(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  stopEquityAlertWatcher();
  // Baseline so we never notify the backlog on launch.
  lastCount = (await listAlerts(undefined)).length;

  const dir = alertsDir();
  try {
    watcher = watch(dir, (_evt, filename) => {
      if (!filename || String(filename) === ALERTS_FILE) {
        void checkForNew(getWindow);
      }
    });
  } catch {
    watcher = null; // dir may not exist yet; the poll below covers it
  }
  // Safety poll (cron writes are infrequent; this also covers a missing dir).
  pollTimer = setInterval(() => void checkForNew(getWindow), 15000);
}

export function stopEquityAlertWatcher(): void {
  watcher?.close();
  watcher = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
