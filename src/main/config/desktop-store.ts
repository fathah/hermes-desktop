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
import {
  unknownEngineCapabilitySnapshot,
  type EngineCapabilitySnapshot,
  type EngineCapabilityState,
} from "../../shared/engine-capabilities";
import type { EngineContractVerificationResult } from "../../shared/engine-contract";
import type {
  SpsAutomationPrefs,
  SpsAutomationPrefsPatch,
} from "../../shared/sps-automation";
import {
  DEFAULT_OWNER_NOTIFICATION_PREFS,
  OWNER_NOTIFICATION_CHANNELS,
  OWNER_NOTIFICATION_EVENTS,
  type OwnerNotificationPrefs,
  type OwnerNotificationPrefsPatch,
} from "../../shared/owner-notifications";

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

const SPS_AUTOMATION_CONFIG_KEY = "spsAutomationByProfile";

const DEFAULT_SPS_AUTOMATION_PREFS: SpsAutomationPrefs = {
  autoApply: false,
  ingestIntervalMin: 0,
  lintIntervalMin: 0,
};

function intervalMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeSpsAutomationPrefs(value: unknown): SpsAutomationPrefs {
  const raw = value && typeof value === "object" ? value : {};
  const data = raw as Record<string, unknown>;
  return {
    autoApply: data.autoApply === true,
    ingestIntervalMin: intervalMinutes(data.ingestIntervalMin),
    lintIntervalMin: intervalMinutes(data.lintIntervalMin),
  };
}

function spsAutomationMap(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const raw = data[SPS_AUTOMATION_CONFIG_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function getSpsAutomationPrefs(profile?: string): SpsAutomationPrefs {
  const data = readDesktopConfig();
  const stored = spsAutomationMap(data)[autoApproveKey(profile)];
  return normalizeSpsAutomationPrefs(stored);
}

export function setSpsAutomationPrefs(
  patch: SpsAutomationPrefsPatch,
  profile?: string,
): SpsAutomationPrefs {
  const data = readDesktopConfig();
  const map = spsAutomationMap(data);
  const key = autoApproveKey(profile);
  const next = normalizeSpsAutomationPrefs({
    ...DEFAULT_SPS_AUTOMATION_PREFS,
    ...normalizeSpsAutomationPrefs(map[key]),
    ...patch,
  });
  map[key] = next;
  data[SPS_AUTOMATION_CONFIG_KEY] = map;
  writeDesktopConfig(data);
  return next;
}

const OWNER_NOTIFICATION_PREFS_KEY = "ownerNotificationPrefsByProfile";

function ownerNotificationPrefsMap(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const raw = data[OWNER_NOTIFICATION_PREFS_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timeValue(value: unknown, fallback: string): string {
  const raw = stringValue(value);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeOwnerNotificationPrefs(
  value: unknown,
): OwnerNotificationPrefs {
  const raw = value && typeof value === "object" ? value : {};
  const data = raw as Record<string, unknown>;
  const rawChannels =
    data.channels && typeof data.channels === "object"
      ? (data.channels as Record<string, unknown>)
      : {};
  const rawEvents =
    data.events && typeof data.events === "object"
      ? (data.events as Record<string, unknown>)
      : {};
  const rawTargets =
    data.targets && typeof data.targets === "object"
      ? (data.targets as Record<string, unknown>)
      : {};
  const rawQuietHours =
    data.quietHours && typeof data.quietHours === "object"
      ? (data.quietHours as Record<string, unknown>)
      : {};
  const channels = { ...DEFAULT_OWNER_NOTIFICATION_PREFS.channels };
  for (const channel of OWNER_NOTIFICATION_CHANNELS) {
    if (typeof rawChannels[channel] === "boolean") {
      channels[channel] = rawChannels[channel];
    }
  }
  const events = { ...DEFAULT_OWNER_NOTIFICATION_PREFS.events };
  for (const event of OWNER_NOTIFICATION_EVENTS) {
    if (typeof rawEvents[event] === "boolean") {
      events[event] = rawEvents[event];
    }
  }
  return {
    channels,
    events,
    targets: {
      telegramChatId: stringValue(rawTargets.telegramChatId),
      emailAddress: stringValue(rawTargets.emailAddress),
      whatsappTarget: stringValue(rawTargets.whatsappTarget),
    },
    quietHours: {
      enabled: rawQuietHours.enabled === true,
      start: timeValue(
        rawQuietHours.start,
        DEFAULT_OWNER_NOTIFICATION_PREFS.quietHours.start,
      ),
      end: timeValue(
        rawQuietHours.end,
        DEFAULT_OWNER_NOTIFICATION_PREFS.quietHours.end,
      ),
    },
    rateLimitMinutes:
      data.rateLimitMinutes === undefined
        ? DEFAULT_OWNER_NOTIFICATION_PREFS.rateLimitMinutes
        : intervalMinutes(data.rateLimitMinutes),
  };
}

export function getOwnerNotificationPrefs(
  profile?: string,
): OwnerNotificationPrefs {
  const data = readDesktopConfig();
  const stored = ownerNotificationPrefsMap(data)[autoApproveKey(profile)];
  return normalizeOwnerNotificationPrefs(stored);
}

export function setOwnerNotificationPrefs(
  patch: OwnerNotificationPrefsPatch,
  profile?: string,
): OwnerNotificationPrefs {
  const data = readDesktopConfig();
  const map = ownerNotificationPrefsMap(data);
  const key = autoApproveKey(profile);
  const current = normalizeOwnerNotificationPrefs(map[key]);
  const next = normalizeOwnerNotificationPrefs({
    ...current,
    channels: { ...current.channels, ...patch.channels },
    events: { ...current.events, ...patch.events },
    targets: { ...current.targets, ...patch.targets },
    quietHours: { ...current.quietHours, ...patch.quietHours },
    rateLimitMinutes:
      patch.rateLimitMinutes !== undefined
        ? patch.rateLimitMinutes
        : current.rateLimitMinutes,
  });
  map[key] = next;
  data[OWNER_NOTIFICATION_PREFS_KEY] = map;
  writeDesktopConfig(data);
  return next;
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
  | "contract-broken"
  | "error";

export type HermesAgentUpdateRoutinePhase =
  | "check"
  | "update"
  | "restart"
  | "verify";

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
  updateChannel?: HermesAgentUpdateChannel;
  releaseTag?: string;
  releaseSha?: string;
  contract?: EngineContractVerificationResult;
}

export type HermesAgentUpdateChannel = "release" | "main";

export interface HermesAgentUpdateRoutineSettings {
  enabled: boolean;
  autoApply: boolean;
  engineUpdateChannel: HermesAgentUpdateChannel;
}

export interface HermesAgentUpdateRoutineState extends HermesAgentUpdateRoutineSettings {
  schedule: typeof HERMES_AGENT_UPDATE_SCHEDULE;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: HermesAgentUpdateRoutineResult | null;
  autoApplySuppressed: boolean;
  autoApplySuppressionReason: "contract-broken" | null;
  autoApplySuppressedAt: string | null;
  autoApplySuppressedSha: string | null;
}

interface StoredHermesAgentUpdateRoutine extends Partial<HermesAgentUpdateRoutineSettings> {
  lastCheckedAt?: string | null;
  lastResult?: HermesAgentUpdateRoutineResult | null;
  autoApplySuppressed?: boolean;
  autoApplySuppressionReason?: "contract-broken" | null;
  autoApplySuppressedAt?: string | null;
  autoApplySuppressedSha?: string | null;
}

function profileConfigKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}

// ── Engine capability snapshot ──────────────────────────────────────────────

const ENGINE_CAPABILITIES_KEY = "engineCapabilitiesByProfile";

interface StoredEngineCapabilityState extends Partial<
  Omit<EngineCapabilityState, "snapshot">
> {
  snapshot?: EngineCapabilitySnapshot;
}

function engineCapabilitiesMap(
  data: Record<string, unknown>,
): Record<string, StoredEngineCapabilityState> {
  const raw = data[ENGINE_CAPABILITIES_KEY];
  return raw && typeof raw === "object"
    ? (raw as Record<string, StoredEngineCapabilityState>)
    : {};
}

function defaultEngineCapabilityState(): EngineCapabilityState {
  return {
    installedSha: null,
    lastVerifiedSha: null,
    lastVerification: null,
    snapshot: unknownEngineCapabilitySnapshot(),
  };
}

function normalizeStoredEngineCapabilityState(
  stored: StoredEngineCapabilityState | undefined,
): EngineCapabilityState {
  const fallback = defaultEngineCapabilityState();
  if (!stored || typeof stored !== "object") return fallback;

  const snapshot =
    stored.snapshot && typeof stored.snapshot === "object"
      ? {
          ...fallback.snapshot,
          ...stored.snapshot,
          features:
            stored.snapshot.features &&
            typeof stored.snapshot.features === "object"
              ? stored.snapshot.features
              : {},
          endpoints:
            stored.snapshot.endpoints &&
            typeof stored.snapshot.endpoints === "object"
              ? stored.snapshot.endpoints
              : {},
        }
      : fallback.snapshot;

  return {
    installedSha:
      typeof stored.installedSha === "string" ? stored.installedSha : null,
    lastVerifiedSha:
      typeof stored.lastVerifiedSha === "string"
        ? stored.lastVerifiedSha
        : null,
    lastVerification:
      stored.lastVerification && typeof stored.lastVerification === "object"
        ? (stored.lastVerification as EngineContractVerificationResult)
        : null,
    snapshot,
  };
}

export function getEngineCapabilityState(
  profile?: string,
): EngineCapabilityState {
  const data = readDesktopConfig();
  return normalizeStoredEngineCapabilityState(
    engineCapabilitiesMap(data)[profileConfigKey(profile)],
  );
}

export function recordEngineCapabilitySnapshot(
  snapshot: EngineCapabilitySnapshot,
  profile?: string,
): EngineCapabilityState {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = engineCapabilitiesMap(data);
  const previous = normalizeStoredEngineCapabilityState(map[key]);
  map[key] = {
    installedSha: snapshot.engineSha,
    lastVerifiedSha: previous.lastVerifiedSha,
    lastVerification: previous.lastVerification,
    snapshot,
  };
  data[ENGINE_CAPABILITIES_KEY] = map;
  writeDesktopConfig(data);
  return getEngineCapabilityState(profile);
}

export function recordEngineContractVerification(
  verification: EngineContractVerificationResult,
  profile?: string,
): EngineCapabilityState {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = engineCapabilitiesMap(data);
  const previous = normalizeStoredEngineCapabilityState(map[key]);
  map[key] = {
    installedSha: previous.installedSha,
    lastVerifiedSha:
      verification.status === "passed"
        ? previous.installedSha
        : previous.lastVerifiedSha,
    lastVerification: verification,
    snapshot: previous.snapshot,
  };
  data[ENGINE_CAPABILITIES_KEY] = map;
  writeDesktopConfig(data);
  return getEngineCapabilityState(profile);
}

function hermesAgentUpdateMap(
  data: Record<string, unknown>,
): Record<string, StoredHermesAgentUpdateRoutine> {
  const raw = data[HERMES_AGENT_UPDATE_KEY];
  return raw && typeof raw === "object"
    ? (raw as Record<string, StoredHermesAgentUpdateRoutine>)
    : {};
}

function normalizeHermesAgentUpdateChannel(
  value: unknown,
): HermesAgentUpdateChannel {
  return value === "main" ? "main" : "release";
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
  const autoApplySuppressionReason =
    stored.autoApplySuppressed === true &&
    stored.autoApplySuppressionReason === "contract-broken"
      ? "contract-broken"
      : null;
  return {
    enabled: stored.enabled !== false,
    autoApply: stored.autoApply === true,
    engineUpdateChannel: normalizeHermesAgentUpdateChannel(
      stored.engineUpdateChannel,
    ),
    schedule: HERMES_AGENT_UPDATE_SCHEDULE,
    timezone: localTimezone(),
    lastCheckedAt: stored.lastCheckedAt || lastResult?.checkedAt || null,
    nextCheckAt: nextHermesAgentUpdateCheckAt(now),
    lastResult,
    autoApplySuppressed: autoApplySuppressionReason !== null,
    autoApplySuppressionReason,
    autoApplySuppressedAt:
      autoApplySuppressionReason &&
      typeof stored.autoApplySuppressedAt === "string"
        ? stored.autoApplySuppressedAt
        : null,
    autoApplySuppressedSha:
      autoApplySuppressionReason &&
      typeof stored.autoApplySuppressedSha === "string"
        ? stored.autoApplySuppressedSha
        : null,
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
  const nextChannel =
    settings.engineUpdateChannel === "release" ||
    settings.engineUpdateChannel === "main"
      ? settings.engineUpdateChannel
      : undefined;
  map[key] = {
    ...prev,
    ...(typeof settings.enabled === "boolean"
      ? { enabled: settings.enabled }
      : {}),
    ...(typeof settings.autoApply === "boolean"
      ? { autoApply: settings.autoApply }
      : {}),
    ...(nextChannel ? { engineUpdateChannel: nextChannel } : {}),
  };
  data[HERMES_AGENT_UPDATE_KEY] = map;
  writeDesktopConfig(data);
  return getHermesAgentUpdateRoutine(profile);
}

export function suppressHermesAgentUpdateAutoApply(
  reason: "contract-broken",
  sha: string | null,
  suppressedAt: string,
  profile?: string,
): HermesAgentUpdateRoutineState {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = hermesAgentUpdateMap(data);
  map[key] = {
    ...(map[key] || {}),
    autoApplySuppressed: true,
    autoApplySuppressionReason: reason,
    autoApplySuppressedAt: suppressedAt,
    autoApplySuppressedSha: sha,
  };
  data[HERMES_AGENT_UPDATE_KEY] = map;
  writeDesktopConfig(data);
  return getHermesAgentUpdateRoutine(profile, new Date(suppressedAt));
}

export function acknowledgeHermesAgentUpdateContractBreak(
  profile?: string,
): HermesAgentUpdateRoutineState {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = hermesAgentUpdateMap(data);
  map[key] = {
    ...(map[key] || {}),
    autoApplySuppressed: false,
    autoApplySuppressionReason: null,
    autoApplySuppressedAt: null,
    autoApplySuppressedSha: null,
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
