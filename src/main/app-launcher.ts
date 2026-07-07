// app-launcher.ts — profile-scoped, user-approved local app launch targets.
//
// This module intentionally accepts structured launch locators only. It never
// accepts renderer-provided command strings.
import { execFile } from "child_process";
import { readFileSync } from "fs";
import { basename, join } from "path";
import { dialog, shell } from "electron";
import { appendAuditLog } from "./audit-log";
import { getConnectionConfig } from "./config";
import { isAllowedExternalUrl } from "./security";
import { profileHome, safeWriteFile } from "./utils";
import {
  isAppLaunchScheduleDue,
  normalizeLaunchUrl,
  validateLaunchScheduleInput,
  validateLaunchTargetInput,
  type AppLaunchSchedule,
  type AppLaunchScheduleInput,
  type AppLaunchSchedulePatch,
  type AppLaunchTarget,
  type AppLaunchTargetInput,
} from "../shared/app-launcher";

type LaunchSource = "manual" | "scheduled";

interface AppLauncherRegistry {
  targets: AppLaunchTarget[];
  schedules: AppLaunchSchedule[];
}

interface AppLauncherResult<T> {
  ok: boolean;
  item?: T;
  error?: string;
}

interface MacApplicationTargetInput {
  label?: string;
  appPath: string;
  bundleId?: string;
}

const activeScheduleRuns = new Set<string>();
let idSeq = 0;

function launcherDir(profile?: string): string {
  return join(profileHome(profile), "sps-agent");
}

function registryFile(profile?: string): string {
  return join(launcherDir(profile), "app-launcher.json");
}

function nowId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`;
}

function loadRegistry(profile?: string): AppLauncherRegistry {
  try {
    const raw = readFileSync(registryFile(profile), "utf-8");
    const data = JSON.parse(raw);
    return {
      targets: Array.isArray(data?.targets) ? data.targets : [],
      schedules: Array.isArray(data?.schedules) ? data.schedules : [],
    };
  } catch {
    return { targets: [], schedules: [] };
  }
}

function saveRegistry(registry: AppLauncherRegistry, profile?: string): void {
  safeWriteFile(registryFile(profile), JSON.stringify(registry, null, 2));
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function localConnectionError(): string | null {
  const mode = getConnectionConfig().mode;
  if (mode === "local") return null;
  return "Local app launching is available only in local mode.";
}

function locatorCommandLabel(target: AppLaunchTarget): string {
  return `${target.locator.kind}:${target.label}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dow);
  return dayKey(monday);
}

function periodKey(schedule: AppLaunchSchedule, d: Date): string {
  if (schedule.cadence === "weekly") return weekKey(d);
  if (schedule.cadence === "monthly") {
    return `${d.getFullYear()}-${d.getMonth() + 1}`;
  }
  return dayKey(d);
}

function hasRunOrSkippedThisPeriod(
  schedule: AppLaunchSchedule,
  now: Date,
): boolean {
  return (
    !!schedule.lastRunAt &&
    periodKey(schedule, new Date(schedule.lastRunAt)) ===
      periodKey(schedule, now)
  );
}

function isAppLaunchScheduleMissed(
  schedule: AppLaunchSchedule,
  now: Date,
): boolean {
  if (!schedule.enabled) return false;
  if (hasRunOrSkippedThisPeriod(schedule, now)) return false;
  if (schedule.cadence === "weekly") {
    return (
      now.getDay() > 1 || (now.getDay() === 1 && now.getHours() > schedule.hour)
    );
  }
  if (schedule.cadence === "monthly") {
    return (
      now.getDate() > 1 ||
      (now.getDate() === 1 && now.getHours() > schedule.hour)
    );
  }
  return now.getHours() > schedule.hour;
}

function audit(
  action: string,
  targetOrCommand?: AppLaunchTarget | string,
  profile?: string,
): void {
  appendAuditLog({
    ts: Date.now(),
    action,
    command:
      typeof targetOrCommand === "string"
        ? targetOrCommand
        : targetOrCommand
          ? locatorCommandLabel(targetOrCommand)
          : undefined,
    profile,
  });
}

function withTargetUpdate(
  id: string,
  update: (target: AppLaunchTarget) => void,
  profile?: string,
): AppLaunchTarget | null {
  const registry = loadRegistry(profile);
  const target = registry.targets.find((item) => item.id === id);
  if (!target) return null;
  update(target);
  target.updatedAt = Date.now();
  saveRegistry(registry, profile);
  return target;
}

function withScheduleUpdate(
  id: string,
  update: (schedule: AppLaunchSchedule) => void,
  profile?: string,
): AppLaunchSchedule | null {
  const registry = loadRegistry(profile);
  const schedule = registry.schedules.find((item) => item.id === id);
  if (!schedule) return null;
  update(schedule);
  schedule.updatedAt = Date.now();
  saveRegistry(registry, profile);
  return schedule;
}

function launchMacApplication(target: AppLaunchTarget): Promise<void> {
  if (target.locator.kind !== "macos-app") {
    return Promise.reject(new Error("Target is not a macOS app."));
  }
  if (process.platform !== "darwin") {
    return Promise.reject(
      new Error("macOS app launching is unavailable here."),
    );
  }
  const args = target.locator.bundleId
    ? ["-b", target.locator.bundleId]
    : [target.locator.appPath];
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/open", args, { shell: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function launchUrl(target: AppLaunchTarget): Promise<void> {
  if (target.locator.kind !== "url") {
    throw new Error("Target is not a URL.");
  }
  const normalized = normalizeLaunchUrl(target.locator.url);
  if (!normalized || !isAllowedExternalUrl(normalized)) {
    throw new Error("Only allowed http(s) URLs can be launched.");
  }
  await shell.openExternal(normalized);
}

async function launchTarget(
  target: AppLaunchTarget,
  source: LaunchSource,
  profile?: string,
): Promise<AppLauncherResult<AppLaunchTarget>> {
  const modeError = localConnectionError();
  if (modeError) return { ok: false, error: modeError };
  if (!target.enabled)
    return { ok: false, error: "Launch target is disabled." };
  try {
    if (target.locator.kind === "macos-app") {
      await launchMacApplication(target);
    } else {
      await launchUrl(target);
    }
    const updated = withTargetUpdate(
      target.id,
      (item) => {
        item.lastRunAt = Date.now();
        item.lastStatus = "ok";
        delete item.lastError;
      },
      profile,
    );
    audit(`app-launch.run.${source}`, target, profile);
    return { ok: true, item: updated ?? target };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = withTargetUpdate(
      target.id,
      (item) => {
        item.lastRunAt = Date.now();
        item.lastStatus = "failed";
        item.lastError = message;
      },
      profile,
    );
    audit(`app-launch.failure.${source}`, target, profile);
    return { ok: false, item: updated ?? target, error: message };
  }
}

export function listAppLaunchTargets(profile?: string): AppLaunchTarget[] {
  return loadRegistry(profile).targets;
}

export function listAppLaunchSchedules(profile?: string): AppLaunchSchedule[] {
  return loadRegistry(profile).schedules;
}

export function addLaunchTarget(
  input: AppLaunchTargetInput,
  profile?: string,
): AppLauncherResult<AppLaunchTarget> {
  const modeError = localConnectionError();
  if (modeError) return { ok: false, error: modeError };
  const error = validateLaunchTargetInput(input);
  if (error) return { ok: false, error };
  const registry = loadRegistry(profile);
  const createdAt = Date.now();
  const locator =
    input.locator.kind === "url"
      ? { kind: "url" as const, url: normalizeLaunchUrl(input.locator.url)! }
      : {
          kind: "macos-app" as const,
          appPath: input.locator.appPath.trim(),
          bundleId: input.locator.bundleId?.trim() || undefined,
        };
  const item: AppLaunchTarget = {
    id: nowId("launch_target"),
    label: input.label.trim(),
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    locator,
  };
  registry.targets.push(item);
  saveRegistry(registry, profile);
  audit("app-launch.target.create", item, profile);
  return { ok: true, item };
}

export function addMacApplicationTarget(
  input: MacApplicationTargetInput,
  profile?: string,
): AppLauncherResult<AppLaunchTarget> {
  return addLaunchTarget(
    {
      label: cleanLabel(input.label) || basename(input.appPath, ".app"),
      locator: {
        kind: "macos-app",
        appPath: input.appPath,
        bundleId: input.bundleId,
      },
    },
    profile,
  );
}

export function addUrlLaunchTarget(
  input: { label: string; url: string },
  profile?: string,
): AppLauncherResult<AppLaunchTarget> {
  return addLaunchTarget(
    { label: input.label, locator: { kind: "url", url: input.url } },
    profile,
  );
}

export async function pickMacApplicationTarget(
  profile?: string,
): Promise<AppLauncherResult<AppLaunchTarget>> {
  const modeError = localConnectionError();
  if (modeError) return { ok: false, error: modeError };
  if (process.platform !== "darwin") {
    return { ok: false, error: "macOS app picking is unavailable here." };
  }
  const result = await dialog.showOpenDialog({
    title: "Choose Application",
    properties: ["openFile"],
    defaultPath: "/Applications",
    filters: [{ name: "Applications", extensions: ["app"] }],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: "No application selected." };
  }
  return addMacApplicationTarget({ appPath: result.filePaths[0] }, profile);
}

export function removeAppLaunchTarget(
  id: string,
  profile?: string,
): AppLauncherResult<AppLaunchTarget> {
  const registry = loadRegistry(profile);
  const index = registry.targets.findIndex((target) => target.id === id);
  if (index < 0) return { ok: false, error: "Launch target not found." };
  const [item] = registry.targets.splice(index, 1);
  registry.schedules = registry.schedules.filter(
    (schedule) => !schedule.targetIds.includes(id),
  );
  saveRegistry(registry, profile);
  audit("app-launch.target.delete", item, profile);
  return { ok: true, item };
}

export async function runAppLaunchTarget(
  id: string,
  profile?: string,
): Promise<AppLauncherResult<AppLaunchTarget>> {
  const target = loadRegistry(profile).targets.find((item) => item.id === id);
  if (!target) return { ok: false, error: "Launch target not found." };
  return launchTarget(target, "manual", profile);
}

export function createAppLaunchSchedule(
  input: AppLaunchScheduleInput,
  profile?: string,
): AppLauncherResult<AppLaunchSchedule> {
  const modeError = localConnectionError();
  if (modeError) return { ok: false, error: modeError };
  const registry = loadRegistry(profile);
  const error = validateLaunchScheduleInput(input, registry.targets);
  if (error) return { ok: false, error };
  const createdAt = Date.now();
  const item: AppLaunchSchedule = {
    id: nowId("launch_schedule"),
    label: input.label.trim(),
    targetIds: [...input.targetIds],
    cadence: input.cadence,
    hour: input.hour ?? 8,
    enabled: input.enabled ?? true,
    runWhenClosed: input.runWhenClosed ?? false,
    createdAt,
    updatedAt: createdAt,
    lastRunAt: 0,
  };
  registry.schedules.push(item);
  saveRegistry(registry, profile);
  audit("app-launch.schedule.create", item.label, profile);
  return { ok: true, item };
}

export function updateAppLaunchSchedule(
  id: string,
  patch: AppLaunchSchedulePatch,
  profile?: string,
): AppLauncherResult<AppLaunchSchedule> {
  const registry = loadRegistry(profile);
  const schedule = registry.schedules.find((item) => item.id === id);
  if (!schedule) return { ok: false, error: "Launch schedule not found." };
  const wasEnabled = schedule.enabled;
  const next: AppLaunchSchedule = { ...schedule, ...patch };
  const error = validateLaunchScheduleInput(next, registry.targets);
  if (error) return { ok: false, error };
  Object.assign(schedule, {
    label: next.label.trim(),
    targetIds: [...next.targetIds],
    cadence: next.cadence,
    hour: next.hour,
    enabled: next.enabled,
    runWhenClosed: next.runWhenClosed,
    updatedAt: Date.now(),
  });
  saveRegistry(registry, profile);
  const action =
    patch.enabled !== undefined && patch.enabled !== wasEnabled
      ? schedule.enabled
        ? "app-launch.schedule.resume"
        : "app-launch.schedule.pause"
      : "app-launch.schedule.update";
  audit(action, schedule.label, profile);
  return { ok: true, item: schedule };
}

export function deleteAppLaunchSchedule(
  id: string,
  profile?: string,
): AppLauncherResult<AppLaunchSchedule> {
  const registry = loadRegistry(profile);
  const index = registry.schedules.findIndex((schedule) => schedule.id === id);
  if (index < 0) return { ok: false, error: "Launch schedule not found." };
  const [item] = registry.schedules.splice(index, 1);
  saveRegistry(registry, profile);
  audit("app-launch.schedule.delete", item.label, profile);
  return { ok: true, item };
}

async function runSchedule(
  schedule: AppLaunchSchedule,
  source: LaunchSource,
  profile?: string,
  runAt: Date = new Date(),
): Promise<AppLauncherResult<AppLaunchSchedule>> {
  const modeError = localConnectionError();
  if (modeError) return { ok: false, error: modeError };
  if (activeScheduleRuns.has(schedule.id)) {
    return { ok: false, error: "Launch schedule is already running." };
  }
  activeScheduleRuns.add(schedule.id);
  try {
    const registry = loadRegistry(profile);
    const targets = schedule.targetIds
      .map((id) => registry.targets.find((target) => target.id === id))
      .filter((target): target is AppLaunchTarget => !!target);
    if (targets.length === 0) {
      throw new Error("Launch schedule has no available targets.");
    }

    let failed: string | undefined;
    for (const target of targets) {
      const result = await launchTarget(target, source, profile);
      if (!result.ok) failed = result.error ?? "Launch failed.";
    }

    const updated = withScheduleUpdate(
      schedule.id,
      (item) => {
        item.lastRunAt = runAt.getTime();
        item.lastStatus = failed ? "failed" : "ok";
        if (failed) item.lastError = failed;
        else delete item.lastError;
      },
      profile,
    );
    audit(
      failed
        ? `app-launch.schedule.failure.${source}`
        : `app-launch.schedule.run.${source}`,
      schedule.label,
      profile,
    );
    return failed
      ? { ok: false, item: updated ?? schedule, error: failed }
      : { ok: true, item: updated ?? schedule };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = withScheduleUpdate(
      schedule.id,
      (item) => {
        item.lastRunAt = runAt.getTime();
        item.lastStatus = "failed";
        item.lastError = message;
      },
      profile,
    );
    audit(`app-launch.schedule.failure.${source}`, schedule.label, profile);
    return { ok: false, item: updated ?? schedule, error: message };
  } finally {
    activeScheduleRuns.delete(schedule.id);
  }
}

export async function runAppLaunchScheduleNow(
  id: string,
  profile?: string,
): Promise<AppLauncherResult<AppLaunchSchedule>> {
  const schedule = loadRegistry(profile).schedules.find(
    (item) => item.id === id,
  );
  if (!schedule) return { ok: false, error: "Launch schedule not found." };
  return runSchedule(schedule, "manual", profile);
}

export async function maybeRunAppLaunchSchedules(
  now: Date = new Date(),
  profile?: string,
): Promise<AppLaunchSchedule[]> {
  const updated: AppLaunchSchedule[] = [];
  const schedules = loadRegistry(profile).schedules;
  for (const schedule of schedules) {
    if (isAppLaunchScheduleDue(schedule, now)) {
      const result = await runSchedule(schedule, "scheduled", profile, now);
      if (result.item) updated.push(result.item);
      continue;
    }
    if (isAppLaunchScheduleMissed(schedule, now)) {
      const skipped = withScheduleUpdate(
        schedule.id,
        (item) => {
          item.lastRunAt = now.getTime();
          item.lastStatus = "skipped";
          item.lastError = "Scheduled hour passed before Hermes could run it.";
        },
        profile,
      );
      audit("app-launch.schedule.skipped", schedule.label, profile);
      if (skipped) updated.push(skipped);
    }
  }
  return updated;
}
