import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "../installer";
import { getActiveProfileNameSync } from "../utils";
import {
  canDecryptSecret,
  encryptSecret,
  decryptSecret,
  isSecretEncryptionAvailable,
} from "./secrets";
import {
  EXTERNAL_SOURCES,
  defaultExternalSourceConfig,
  type ExternalSource,
  type ExternalSourceConfig,
} from "../../shared/external-context";
import {
  normalizeCouncilConfig,
  type CouncilConfig,
} from "../../shared/council";

// `desktop.json` — app-level, desktop-owned config (connection mode, encrypted
// remote/api-server keys, and the desktop-enforced UX toggles below).
// `desktopConfigFile` stays a function (not a module-level const) so HERMES_HOME
// is read at call time: config ↔ installer is a benign cycle, and reading the
// path lazily avoids depending on installer being fully evaluated at load time.
function desktopConfigFile(): string {
  return join(HERMES_HOME, "desktop.json");
}

const DESKTOP_SECRET_FIELDS = [
  "remoteApiKey",
  "apiServerKey",
  "openalexApiKey",
] as const;

function readDesktopConfigRaw(): Record<string, unknown> | null {
  try {
    const f = desktopConfigFile();
    if (!existsSync(f)) return null;
    const data = JSON.parse(readFileSync(f, "utf-8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export function readDesktopConfig(): Record<string, unknown> {
  try {
    const data = readDesktopConfigRaw();
    if (!data) return {};
    for (const field of DESKTOP_SECRET_FIELDS) {
      if (typeof data[field] === "string") {
        data[field] = decryptSecret(data[field]);
      }
    }
    return data;
  } catch {
    return {};
  }
}

export function writeDesktopConfig(data: Record<string, unknown>): void {
  if (!existsSync(HERMES_HOME)) {
    mkdirSync(HERMES_HOME, { recursive: true });
  }
  const clone = JSON.parse(JSON.stringify(data));
  if (clone && typeof clone === "object") {
    for (const field of DESKTOP_SECRET_FIELDS) {
      if (typeof clone[field] === "string") {
        clone[field] = encryptSecret(clone[field]);
      }
    }
  }
  writeFileSync(desktopConfigFile(), JSON.stringify(clone, null, 2), "utf-8");
}

export function migrateDesktopConfigSecrets(): void {
  if (!isSecretEncryptionAvailable()) return;
  const raw = readDesktopConfigRaw();
  if (!raw) return;
  const hasLegacyPlaintext = DESKTOP_SECRET_FIELDS.some((field) => {
    const value = raw[field];
    return (
      typeof value === "string" && value.length > 0 && !canDecryptSecret(value)
    );
  });
  if (!hasLegacyPlaintext) return;
  writeDesktopConfig(readDesktopConfig());
}

// ── Desktop automation prefs (M2) ────────────────────────────────────────────
// App-level, desktop-owned policy/UX toggles stored in desktop.json. They live
// here (not config.yaml) because they are enforced by the desktop main process,
// not the gateway, and because setConfigValue silently drops new nested YAML keys.

/** Scoped auto-approve: let the desktop auto-resolve provably-safe, read-only
 *  command approvals (see autonomy.ts). PER-PROFILE (different profiles carry
 *  different risk), keyed by the resolved profile name in desktop.json. Default
 *  OFF — opt-in only. Resolving undefined → active profile keeps the key stable
 *  between the Settings UI (passes a name) and the chat path (often passes none). */
function autoApproveKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}
export function getAutoApprove(profile?: string): boolean {
  const map = readDesktopConfig().autoApproveByProfile;
  if (!map || typeof map !== "object") return false;
  return (map as Record<string, unknown>)[autoApproveKey(profile)] === true;
}
export function setAutoApprove(enabled: boolean, profile?: string): void {
  const data = readDesktopConfig();
  const existing = data.autoApproveByProfile;
  const map: Record<string, boolean> =
    existing && typeof existing === "object"
      ? (existing as Record<string, boolean>)
      : {};
  map[autoApproveKey(profile)] = enabled;
  data.autoApproveByProfile = map;
  writeDesktopConfig(data);
}

const COUNCIL_CONFIG_KEY = "councilConfigByProfile";

function councilConfigMap(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const raw = data[COUNCIL_CONFIG_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function getCouncilConfig(profile?: string): CouncilConfig {
  const data = readDesktopConfig();
  const stored = councilConfigMap(data)[autoApproveKey(profile)];
  return normalizeCouncilConfig(stored);
}

export function setCouncilConfig(
  config: Partial<CouncilConfig>,
  profile?: string,
): CouncilConfig {
  const data = readDesktopConfig();
  const map = councilConfigMap(data);
  const normalized = normalizeCouncilConfig(config);
  map[autoApproveKey(profile)] = normalized;
  data[COUNCIL_CONFIG_KEY] = map;
  writeDesktopConfig(data);
  return normalized;
}

/** Play a system chime when an agent run completes (handy with parallel runs). */
export function getCompletionSound(): boolean {
  return readDesktopConfig().completionSound === true;
}
export function setCompletionSound(enabled: boolean): void {
  const data = readDesktopConfig();
  data.completionSound = enabled;
  writeDesktopConfig(data);
}

/** Whether the first-run onboarding screen has been completed. App-level (not
 *  per-profile): SPS Agent is single-profile, and orientation is a one-time
 *  per-install event. Stored in desktop.json so it resets with a fresh
 *  HERMES_HOME (a genuinely new install re-shows onboarding) — the intended
 *  first-run semantics. Default false → a brand-new install shows onboarding. */
export function getOnboardingCompleted(): boolean {
  return readDesktopConfig().onboardingCompleted === true;
}
export function setOnboardingCompleted(completed: boolean): void {
  const data = readDesktopConfig();
  data.onboardingCompleted = completed;
  writeDesktopConfig(data);
}

// ── Hermes Agent updater routine ────────────────────────────────────────────

const HERMES_AGENT_UPDATE_KEY = "hermesAgentUpdateByProfile";
const HERMES_AGENT_UPDATE_SCHEDULE = "0 4 * * *";
const HERMES_AGENT_UPDATE_HOUR = 4;

export type HermesAgentUpdateRoutineStatus =
  | "current"
  | "available"
  | "updated"
  | "skipped"
  | "error";

export type HermesAgentUpdateRoutinePhase = "check" | "update" | "restart";

export type HermesAgentUpdateRoutineRestartStatus =
  | "not-needed"
  | "restarted"
  | "failed";

export interface HermesAgentUpdateRoutineResult {
  checkedAt: string;
  status: HermesAgentUpdateRoutineStatus;
  message: string;
  phase?: HermesAgentUpdateRoutinePhase;
  reason?: string;
  restartStatus?: HermesAgentUpdateRoutineRestartStatus;
  restartMessage?: string;
  localHead?: string;
  upstreamHead?: string;
  behindBy?: number;
  changelog?: string;
}

export interface HermesAgentUpdateRoutineSettings {
  enabled: boolean;
  autoApply: boolean;
}

export interface HermesAgentUpdateRoutineState extends HermesAgentUpdateRoutineSettings {
  schedule: typeof HERMES_AGENT_UPDATE_SCHEDULE;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: HermesAgentUpdateRoutineResult | null;
}

interface StoredHermesAgentUpdateRoutine extends Partial<HermesAgentUpdateRoutineSettings> {
  lastCheckedAt?: string | null;
  lastResult?: HermesAgentUpdateRoutineResult | null;
}

function profileConfigKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}

function hermesAgentUpdateMap(
  data: Record<string, unknown>,
): Record<string, StoredHermesAgentUpdateRoutine> {
  const raw = data[HERMES_AGENT_UPDATE_KEY];
  return raw && typeof raw === "object"
    ? (raw as Record<string, StoredHermesAgentUpdateRoutine>)
    : {};
}

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function scheduledLocalForDate(date: Date, dayOffset = 0): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    HERMES_AGENT_UPDATE_HOUR,
    0,
    0,
    0,
  );
}

export function nextHermesAgentUpdateCheckAt(now = new Date()): string {
  const today = scheduledLocalForDate(now);
  if (now.getTime() < today.getTime()) return today.toISOString();
  return scheduledLocalForDate(now, 1).toISOString();
}

export function isHermesAgentUpdateRoutineDue(
  state: { enabled?: boolean; lastCheckedAt?: string | null },
  now = new Date(),
): boolean {
  if (state.enabled === false) return false;
  const todaySchedule = scheduledLocalForDate(now);
  if (now.getTime() < todaySchedule.getTime()) return false;
  if (!state.lastCheckedAt) return true;
  const last = new Date(state.lastCheckedAt);
  if (Number.isNaN(last.getTime())) return true;
  return localDateKey(last) !== localDateKey(now);
}

export function getHermesAgentUpdateRoutine(
  profile?: string,
  now = new Date(),
): HermesAgentUpdateRoutineState {
  const data = readDesktopConfig();
  const stored = hermesAgentUpdateMap(data)[profileConfigKey(profile)] || {};
  const lastResult = stored.lastResult || null;
  return {
    enabled: stored.enabled !== false,
    autoApply: stored.autoApply === true,
    schedule: HERMES_AGENT_UPDATE_SCHEDULE,
    timezone: localTimezone(),
    lastCheckedAt: stored.lastCheckedAt || lastResult?.checkedAt || null,
    nextCheckAt: nextHermesAgentUpdateCheckAt(now),
    lastResult,
  };
}

export function setHermesAgentUpdateRoutine(
  settings: Partial<HermesAgentUpdateRoutineSettings>,
  profile?: string,
): HermesAgentUpdateRoutineState {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = hermesAgentUpdateMap(data);
  const prev = map[key] || {};
  map[key] = {
    ...prev,
    ...(typeof settings.enabled === "boolean"
      ? { enabled: settings.enabled }
      : {}),
    ...(typeof settings.autoApply === "boolean"
      ? { autoApply: settings.autoApply }
      : {}),
  };
  data[HERMES_AGENT_UPDATE_KEY] = map;
  writeDesktopConfig(data);
  return getHermesAgentUpdateRoutine(profile);
}

export function recordHermesAgentUpdateResult(
  result: HermesAgentUpdateRoutineResult,
  profile?: string,
): HermesAgentUpdateRoutineState {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = hermesAgentUpdateMap(data);
  map[key] = {
    ...(map[key] || {}),
    lastCheckedAt: result.checkedAt,
    lastResult: result,
  };
  data[HERMES_AGENT_UPDATE_KEY] = map;
  writeDesktopConfig(data);
  return getHermesAgentUpdateRoutine(profile, new Date(result.checkedAt));
}

// ── Desktop app updater routine ─────────────────────────────────────────────

const DESKTOP_UPDATE_KEY = "desktopUpdateRoutine";
const DESKTOP_UPDATE_SCHEDULE = "0 4 * * *";
const DESKTOP_UPDATE_HOUR = 4;

export type DesktopUpdateRoutineStatus =
  | "current"
  | "available"
  | "downloaded"
  | "skipped"
  | "error";

export type DesktopUpdateRoutinePhase = "check" | "download";

export interface DesktopUpdateRoutineResult {
  checkedAt: string;
  status: DesktopUpdateRoutineStatus;
  message: string;
  phase?: DesktopUpdateRoutinePhase;
  reason?: string;
  version?: string;
  releaseNotes?: string;
}

export interface DesktopUpdateRoutineSettings {
  enabled: boolean;
  autoDownload: boolean;
}

export interface DesktopUpdateRoutineState extends DesktopUpdateRoutineSettings {
  schedule: typeof DESKTOP_UPDATE_SCHEDULE;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: DesktopUpdateRoutineResult | null;
}

interface StoredDesktopUpdateRoutine extends Partial<DesktopUpdateRoutineSettings> {
  lastCheckedAt?: string | null;
  lastResult?: DesktopUpdateRoutineResult | null;
}

function desktopUpdateRoutineState(
  data: Record<string, unknown>,
): StoredDesktopUpdateRoutine {
  const raw = data[DESKTOP_UPDATE_KEY];
  return raw && typeof raw === "object"
    ? (raw as StoredDesktopUpdateRoutine)
    : {};
}

function scheduledDesktopUpdateLocalForDate(date: Date, dayOffset = 0): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    DESKTOP_UPDATE_HOUR,
    0,
    0,
    0,
  );
}

export function nextDesktopUpdateCheckAt(now = new Date()): string {
  const today = scheduledDesktopUpdateLocalForDate(now);
  if (now.getTime() < today.getTime()) return today.toISOString();
  return scheduledDesktopUpdateLocalForDate(now, 1).toISOString();
}

export function isDesktopUpdateRoutineDue(
  state: { enabled?: boolean; lastCheckedAt?: string | null },
  now = new Date(),
): boolean {
  if (state.enabled === false) return false;
  const todaySchedule = scheduledDesktopUpdateLocalForDate(now);
  if (now.getTime() < todaySchedule.getTime()) return false;
  if (!state.lastCheckedAt) return true;
  const last = new Date(state.lastCheckedAt);
  if (Number.isNaN(last.getTime())) return true;
  return localDateKey(last) !== localDateKey(now);
}

export function getDesktopUpdateRoutine(
  now = new Date(),
): DesktopUpdateRoutineState {
  const stored = desktopUpdateRoutineState(readDesktopConfig());
  const lastResult = stored.lastResult || null;
  return {
    enabled: stored.enabled !== false,
    autoDownload: stored.autoDownload === true,
    schedule: DESKTOP_UPDATE_SCHEDULE,
    timezone: localTimezone(),
    lastCheckedAt: stored.lastCheckedAt || lastResult?.checkedAt || null,
    nextCheckAt: nextDesktopUpdateCheckAt(now),
    lastResult,
  };
}

export function setDesktopUpdateRoutine(
  settings: Partial<DesktopUpdateRoutineSettings>,
): DesktopUpdateRoutineState {
  const data = readDesktopConfig();
  const prev = desktopUpdateRoutineState(data);
  data[DESKTOP_UPDATE_KEY] = {
    ...prev,
    ...(typeof settings.enabled === "boolean"
      ? { enabled: settings.enabled }
      : {}),
    ...(typeof settings.autoDownload === "boolean"
      ? { autoDownload: settings.autoDownload }
      : {}),
  };
  writeDesktopConfig(data);
  return getDesktopUpdateRoutine();
}

export function recordDesktopUpdateRoutineResult(
  result: DesktopUpdateRoutineResult,
): DesktopUpdateRoutineState {
  const data = readDesktopConfig();
  const prev = desktopUpdateRoutineState(data);
  data[DESKTOP_UPDATE_KEY] = {
    ...prev,
    lastCheckedAt: result.checkedAt,
    lastResult: result,
  };
  writeDesktopConfig(data);
  return getDesktopUpdateRoutine(new Date(result.checkedAt));
}

/** Per-source enable flags for the External Context Bridge. App-level (the
 *  external transcript sources live on the machine, not per profile) and
 *  default ALL OFF — indexing other AI tools' transcripts is strictly opt-in. */
export function getExternalContextSources(): ExternalSourceConfig {
  const stored = readDesktopConfig().externalContextSources;
  const cfg = defaultExternalSourceConfig();
  if (stored && typeof stored === "object") {
    for (const source of EXTERNAL_SOURCES) {
      if ((stored as Record<string, unknown>)[source] === true)
        cfg[source] = true;
    }
  }
  return cfg;
}

export function setExternalContextSource(
  source: ExternalSource,
  enabled: boolean,
): ExternalSourceConfig {
  const data = readDesktopConfig();
  const cfg = getExternalContextSources();
  cfg[source] = enabled;
  data.externalContextSources = cfg;
  writeDesktopConfig(data);
  return cfg;
}

/** Recency cap for external-context indexing: only sessions modified within the
 *  last N days are indexed. `null` = no cap (index everything). App-level. */
export function getExternalContextMaxAgeDays(): number | null {
  const raw = readDesktopConfig().externalContextMaxAgeDays;
  return typeof raw === "number" && raw > 0 ? raw : null;
}

export function setExternalContextMaxAgeDays(days: number | null): void {
  const data = readDesktopConfig();
  if (days && days > 0) {
    data.externalContextMaxAgeDays = days;
  } else {
    delete data.externalContextMaxAgeDays;
  }
  writeDesktopConfig(data);
}
