// app-launcher.ts — pure contracts and scheduling helpers for local app launch
// targets. No Electron or Node imports: renderer, preload, and main can share it.

export type AppLaunchCadence = "daily" | "weekly" | "monthly";
export type AppLaunchRunStatus = "ok" | "failed" | "skipped";

export type AppLaunchLocator =
  | { kind: "macos-app"; appPath: string; bundleId?: string }
  | { kind: "url"; url: string };

export interface AppLaunchTarget {
  id: string;
  label: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: AppLaunchRunStatus;
  lastError?: string;
  locator: AppLaunchLocator;
}

export interface AppLaunchSchedule {
  id: string;
  label: string;
  targetIds: string[];
  cadence: AppLaunchCadence;
  hour: number;
  enabled: boolean;
  runWhenClosed: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number;
  lastStatus?: AppLaunchRunStatus;
  lastError?: string;
}

export interface AppLaunchTargetInput {
  label: string;
  locator: AppLaunchLocator;
}

export interface AppLaunchScheduleInput {
  label: string;
  targetIds: string[];
  cadence: AppLaunchCadence;
  hour?: number;
  enabled?: boolean;
  runWhenClosed?: boolean;
}

export type AppLaunchSchedulePatch = Partial<
  Pick<
    AppLaunchSchedule,
    "label" | "targetIds" | "cadence" | "hour" | "enabled" | "runWhenClosed"
  >
>;

export const APP_LAUNCH_CADENCES: AppLaunchCadence[] = [
  "daily",
  "weekly",
  "monthly",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLaunchUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function validateLaunchTargetInput(
  input: AppLaunchTargetInput,
): string | null {
  if (!isRecord(input)) return "Invalid launch target.";
  const label = cleanLabel(input.label);
  if (!label) return "Enter a launch target label.";
  if (!isRecord(input.locator)) return "Pick a launch target.";

  if (input.locator.kind === "macos-app") {
    const appPath =
      typeof input.locator.appPath === "string"
        ? input.locator.appPath.trim()
        : "";
    if (!appPath) return "Pick a macOS app.";
    if (!appPath.endsWith(".app")) return "macOS app paths must end in .app.";
    return null;
  }

  if (input.locator.kind === "url") {
    const rawUrl =
      typeof input.locator.url === "string" ? input.locator.url.trim() : "";
    if (!rawUrl) return "Enter a URL.";
    if (!normalizeLaunchUrl(rawUrl)) return "Only http(s) URLs are allowed.";
    return null;
  }

  return "Unsupported launch target type.";
}

export function validateLaunchScheduleInput(
  input: AppLaunchScheduleInput,
  targets: AppLaunchTarget[],
): string | null {
  if (!isRecord(input)) return "Invalid launch schedule.";
  const label = cleanLabel(input.label);
  if (!label) return "Enter a launch schedule label.";
  if (!APP_LAUNCH_CADENCES.includes(input.cadence)) {
    return "Pick a valid cadence.";
  }
  const hour = input.hour ?? 8;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return "Hour must be 0-23.";
  }
  if (!Array.isArray(input.targetIds) || input.targetIds.length === 0) {
    return "Pick at least one launch target.";
  }

  const byId = new Map(targets.map((target) => [target.id, target]));
  for (const targetId of input.targetIds) {
    const target = byId.get(targetId);
    if (!target) return "Launch schedule references an unknown target.";
    if (!target.enabled)
      return "Launch schedules can only use enabled targets.";
  }
  return null;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dow);
  return ymd(monday);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function periodKey(cadence: AppLaunchCadence, d: Date): string {
  if (cadence === "weekly") return weekKey(d);
  if (cadence === "monthly") return monthKey(d);
  return ymd(d);
}

function isRunWindow(
  cadence: AppLaunchCadence,
  hour: number,
  now: Date,
): boolean {
  if (now.getHours() !== hour) return false;
  if (cadence === "weekly") return now.getDay() === 1;
  if (cadence === "monthly") return now.getDate() === 1;
  return true;
}

export function isAppLaunchScheduleDue(
  schedule: AppLaunchSchedule,
  now: Date,
): boolean {
  if (!schedule.enabled) return false;
  if (!isRunWindow(schedule.cadence, schedule.hour, now)) return false;
  if (!schedule.lastRunAt) return true;
  return (
    periodKey(schedule.cadence, now) !==
    periodKey(schedule.cadence, new Date(schedule.lastRunAt))
  );
}

export function appLaunchCadenceLabel(
  cadence: AppLaunchCadence,
  hour: number,
): string {
  const h = `${String(Math.max(0, Math.min(23, Math.floor(hour)))).padStart(2, "0")}:00`;
  if (cadence === "weekly") return `Weekly · Mon ${h}`;
  if (cadence === "monthly") return `Monthly · 1st ${h}`;
  return `Daily · ${h}`;
}
