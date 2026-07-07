import {
  acknowledgeHermesAgentUpdateContractBreak as acknowledgeStoredContractBreak,
  getEngineCapabilityState as getStoredEngineCapabilityState,
  getHermesAgentUpdateRoutine as getStoredUpdateRoutine,
  isHermesAgentUpdateRoutineDue,
  nextHermesAgentUpdateCheckAt,
  readDesktopConfig,
  recordEngineCapabilitySnapshot as recordStoredCapabilitySnapshot,
  recordEngineContractVerification as recordStoredContractVerification,
  recordHermesAgentUpdateResult as recordStoredUpdateResult,
  setHermesAgentUpdateRoutine as setStoredUpdateRoutine,
  suppressHermesAgentUpdateAutoApply as suppressStoredAutoApply,
  writeDesktopConfig,
  type HermesAgentUpdateChannel,
  type HermesAgentUpdateRoutineResult,
  type HermesAgentUpdateRoutineSettings,
  type HermesAgentUpdateRoutineState,
  type HermesAgentUpdateRoutineStatus,
} from "./config/desktop-store";
import { getActiveProfileNameSync } from "./utils";
import type {
  EngineCapabilitySnapshot,
  EngineCapabilityState,
} from "../shared/engine-capabilities";
import type { EngineContractVerificationResult } from "../shared/engine-contract";

const HERMES_AGENT_UPDATE_KEY = "hermesAgentUpdateByProfile";

export {
  isHermesAgentUpdateRoutineDue,
  nextHermesAgentUpdateCheckAt,
  type HermesAgentUpdateChannel,
  type HermesAgentUpdateRoutineResult,
  type HermesAgentUpdateRoutineSettings,
  type HermesAgentUpdateRoutineState,
  type HermesAgentUpdateRoutineStatus,
};

export interface EngineUpdateLatestReleaseSeen {
  tag: string;
  sha: string;
  seenAt: string;
}

export interface EngineUpdatePendingSummary {
  checkedAt: string;
  status: "available";
  message: string;
  localHead?: string;
  upstreamHead?: string;
  changelog?: string;
  updateChannel?: HermesAgentUpdateChannel;
  releaseTag?: string;
  releaseSha?: string;
}

export interface EngineUpdateNotificationState {
  notifiedAt: string;
  status: HermesAgentUpdateRoutineStatus;
  message: string;
  sha?: string | null;
}

export interface EngineUpdateState {
  profileKey: string;
  installedSha: string | null;
  engineUpdateChannel: HermesAgentUpdateChannel;
  latestReleaseSeen: EngineUpdateLatestReleaseSeen | null;
  pendingUpdate: EngineUpdatePendingSummary | null;
  lastVerifiedSha: string | null;
  lastContractResult: EngineContractVerificationResult | null;
  autoApplySuppressed: boolean;
  autoApplySuppressionReason: "contract-broken" | null;
  autoApplySuppressedAt: string | null;
  autoApplySuppressedSha: string | null;
  lastNotification: EngineUpdateNotificationState | null;
  routine: HermesAgentUpdateRoutineState;
  capabilities: EngineCapabilityState;
}

interface StoredEngineUpdateRoutineExtension {
  latestReleaseSeen?: EngineUpdateLatestReleaseSeen;
  lastNotification?: EngineUpdateNotificationState;
  lastResult?: HermesAgentUpdateRoutineResult | null;
}

function profileConfigKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}

function updateMap(
  data: Record<string, unknown>,
): Record<string, StoredEngineUpdateRoutineExtension> {
  const raw = data[HERMES_AGENT_UPDATE_KEY];
  return raw && typeof raw === "object"
    ? (raw as Record<string, StoredEngineUpdateRoutineExtension>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function latestReleaseFromResult(
  result: HermesAgentUpdateRoutineResult | null | undefined,
): EngineUpdateLatestReleaseSeen | null {
  const tag = stringOrNull(result?.releaseTag);
  const sha = stringOrNull(result?.releaseSha);
  const seenAt = stringOrNull(result?.checkedAt);
  return tag && sha && seenAt ? { tag, sha, seenAt } : null;
}

function normalizeLatestRelease(
  stored: StoredEngineUpdateRoutineExtension | undefined,
): EngineUpdateLatestReleaseSeen | null {
  const raw = stored?.latestReleaseSeen;
  if (raw && typeof raw === "object") {
    const tag = stringOrNull(raw.tag);
    const sha = stringOrNull(raw.sha);
    const seenAt = stringOrNull(raw.seenAt);
    if (tag && sha && seenAt) return { tag, sha, seenAt };
  }
  return latestReleaseFromResult(stored?.lastResult);
}

function pendingSummary(
  result: HermesAgentUpdateRoutineResult | null,
): EngineUpdatePendingSummary | null {
  if (!result || result.status !== "available") return null;
  return {
    checkedAt: result.checkedAt,
    status: "available",
    message: result.message,
    localHead: result.localHead,
    upstreamHead: result.upstreamHead,
    changelog: result.changelog,
    updateChannel: result.updateChannel,
    releaseTag: result.releaseTag,
    releaseSha: result.releaseSha,
  };
}

function normalizeNotification(
  value: unknown,
): EngineUpdateNotificationState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<EngineUpdateNotificationState>;
  const notifiedAt = stringOrNull(record.notifiedAt);
  const message = stringOrNull(record.message);
  const status = stringOrNull(record.status) as HermesAgentUpdateRoutineStatus;
  if (!notifiedAt || !message || !status) return null;
  return {
    notifiedAt,
    status,
    message,
    sha: typeof record.sha === "string" ? record.sha : null,
  };
}

function writeUpdateExtension(
  profile: string | undefined,
  update: (
    current: StoredEngineUpdateRoutineExtension,
  ) => StoredEngineUpdateRoutineExtension,
): void {
  const data = readDesktopConfig();
  const key = profileConfigKey(profile);
  const map = updateMap(data);
  map[key] = update(map[key] || {});
  data[HERMES_AGENT_UPDATE_KEY] = map;
  writeDesktopConfig(data);
}

export function getHermesAgentUpdateRoutine(
  profile?: string,
  now = new Date(),
): HermesAgentUpdateRoutineState {
  return getStoredUpdateRoutine(profile, now);
}

export function setHermesAgentUpdateRoutine(
  settings: Partial<HermesAgentUpdateRoutineSettings>,
  profile?: string,
): HermesAgentUpdateRoutineState {
  return setStoredUpdateRoutine(settings, profile);
}

export function suppressHermesAgentUpdateAutoApply(
  reason: "contract-broken",
  sha: string | null,
  suppressedAt: string,
  profile?: string,
): HermesAgentUpdateRoutineState {
  return suppressStoredAutoApply(reason, sha, suppressedAt, profile);
}

export function acknowledgeHermesAgentUpdateContractBreak(
  profile?: string,
): HermesAgentUpdateRoutineState {
  return acknowledgeStoredContractBreak(profile);
}

export function recordHermesAgentUpdateResult(
  result: HermesAgentUpdateRoutineResult,
  profile?: string,
): HermesAgentUpdateRoutineState {
  const state = recordStoredUpdateResult(result, profile);
  const latestReleaseSeen = latestReleaseFromResult(result);
  if (latestReleaseSeen) {
    writeUpdateExtension(profile, (current) => ({
      ...current,
      latestReleaseSeen,
    }));
  }
  return state;
}

export function recordEngineUpdateNotification(
  notification: EngineUpdateNotificationState,
  profile?: string,
): EngineUpdateNotificationState {
  writeUpdateExtension(profile, (current) => ({
    ...current,
    lastNotification: notification,
  }));
  return notification;
}

export function getEngineCapabilityState(
  profile?: string,
): EngineCapabilityState {
  return getStoredEngineCapabilityState(profile);
}

export function recordEngineCapabilitySnapshot(
  snapshot: EngineCapabilitySnapshot,
  profile?: string,
): EngineCapabilityState {
  return recordStoredCapabilitySnapshot(snapshot, profile);
}

export function recordEngineContractVerification(
  verification: EngineContractVerificationResult,
  profile?: string,
): EngineCapabilityState {
  return recordStoredContractVerification(verification, profile);
}

export function getEngineUpdateState(
  profile?: string,
  now = new Date(),
): EngineUpdateState {
  const profileKey = profileConfigKey(profile);
  const routine = getHermesAgentUpdateRoutine(profile, now);
  const capabilities = getEngineCapabilityState(profile);
  const stored = updateMap(readDesktopConfig())[profileKey];

  return {
    profileKey,
    installedSha: capabilities.installedSha,
    engineUpdateChannel: routine.engineUpdateChannel,
    latestReleaseSeen: normalizeLatestRelease(stored),
    pendingUpdate: pendingSummary(routine.lastResult),
    lastVerifiedSha: capabilities.lastVerifiedSha,
    lastContractResult: capabilities.lastVerification,
    autoApplySuppressed: routine.autoApplySuppressed,
    autoApplySuppressionReason: routine.autoApplySuppressionReason,
    autoApplySuppressedAt: routine.autoApplySuppressedAt,
    autoApplySuppressedSha: routine.autoApplySuppressedSha,
    lastNotification: normalizeNotification(stored?.lastNotification),
    routine,
    capabilities,
  };
}
