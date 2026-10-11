export const MIN_AGENT_DESKTOP_CONTRACT = 1;
export const RECOMMENDED_AGENT_DESKTOP_CONTRACT = 6;

export type AgentCapabilityState = "supported" | "unsupported" | "unknown";
export type AgentCapabilitySource =
  | "api"
  | "command-inventory"
  | "desktop-contract"
  | "runtime-probe"
  | "unknown";

export interface AgentFeatureCapability {
  source: AgentCapabilitySource;
  state: AgentCapabilityState;
}

export interface AgentFeatureCapabilities {
  approvalsMode: AgentFeatureCapability;
  automationBlueprints: AgentFeatureCapability;
  backgroundPrompts: AgentFeatureCapability;
  dashboardChat: AgentFeatureCapability;
  explicitNormalTier: AgentFeatureCapability;
  fileAttach: AgentFeatureCapability;
  keyedPluginManagement: AgentFeatureCapability;
  largeFileAttach: AgentFeatureCapability;
  promptQueue: AgentFeatureCapability;
  runsTransport: AgentFeatureCapability;
  sessionLoops: AgentFeatureCapability;
  toolCallSteering: AgentFeatureCapability;
  voiceCommands: AgentFeatureCapability;
}

export interface AgentCapabilitySnapshot {
  canUpdate: boolean;
  checkedAt: number;
  compatibility: "compatible" | "legacy" | "unknown" | "update-recommended";
  desktopContract: number | null;
  features: AgentFeatureCapabilities;
  minimumDesktopContract: number;
  recommendedDesktopContract: number;
  recommendedVersion: string | null;
  releaseDate: string | null;
  updateAvailable: boolean;
  updateCommand: string | null;
  updateInfo: string | null;
  version: string | null;
}

export interface AgentCapabilityEvidence {
  apiRunsTransport?: boolean | null;
  checkedAt?: number;
  commandNames?: readonly string[] | null;
  connectionMode: "local" | "remote" | "ssh";
  runtimeInfo?: unknown;
  versionText?: string | null;
}

const RUNTIME_INFO_KEYS = [
  "desktop_contract",
  "release_date",
  "update_behind",
  "update_command",
  "version",
] as const;

const MAX_COMMAND_NAMES = 512;

export function sanitizeAgentRuntimeInfo(
  value: unknown,
): Record<string, unknown> | null {
  const source = record(value);
  const info: Record<string, unknown> = {};
  for (const key of RUNTIME_INFO_KEYS) {
    const field = source[key];
    if (
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean" ||
      field === null
    ) {
      info[key] = field;
    }
  }
  return Object.keys(info).length > 0 ? info : null;
}

export function sanitizeAgentCommandInventory(value: unknown): string[] | null {
  const source = record(value);
  const pairs: unknown[] = [];
  let observed = false;

  if (Array.isArray(source.pairs)) {
    observed = true;
    pairs.push(...source.pairs);
  }
  if (Array.isArray(source.categories)) {
    observed = true;
    for (const category of source.categories) {
      const categoryPairs = record(category).pairs;
      if (Array.isArray(categoryPairs)) pairs.push(...categoryPairs);
    }
  }
  if (!observed) return null;

  const commands = new Set<string>();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
    const name = pair[0].trim().replace(/^\/+/, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) continue;
    commands.add(name);
    if (commands.size >= MAX_COMMAND_NAMES) break;
  }
  return [...commands].sort();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function contractNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function contractFeature(
  desktopContract: number | null,
  minimum: number,
): AgentFeatureCapability {
  if (desktopContract === null) return { state: "unknown", source: "unknown" };
  return {
    state: desktopContract >= minimum ? "supported" : "unsupported",
    source: "desktop-contract",
  };
}

function apiFeature(value: boolean | null | undefined): AgentFeatureCapability {
  if (typeof value !== "boolean") {
    return { state: "unknown", source: "unknown" };
  }
  return { state: value ? "supported" : "unsupported", source: "api" };
}

function commandFeature(
  commands: ReadonlySet<string> | null,
  name: string,
): AgentFeatureCapability {
  if (!commands) return { state: "unknown", source: "unknown" };
  return {
    state: commands.has(name) ? "supported" : "unsupported",
    source: "command-inventory",
  };
}

function versionFromText(value: string): string {
  return value.match(/(?:Hermes Agent\s+)?v(\d+(?:\.\d+){1,3})/i)?.[1] ?? "";
}

function releaseDateFromText(value: string): string {
  return value.match(/Hermes Agent[^\n]*\(([^)]+)\)/i)?.[1]?.trim() ?? "";
}

function updateInfoFromText(value: string): string {
  return value.match(/^Update available:\s*(.+)$/im)?.[1]?.trim() ?? "";
}

function recommendedVersionFromUpdate(value: string): string {
  return value.match(/v?(\d+(?:\.\d+){1,3})/)?.[1] ?? "";
}

// @lat: [[agent-capabilities#Capability snapshot]]
export function buildAgentCapabilitySnapshot(
  evidence: AgentCapabilityEvidence,
): AgentCapabilitySnapshot {
  const runtime = record(evidence.runtimeInfo);
  const versionText = evidence.versionText?.trim() ?? "";
  const desktopContract = contractNumber(runtime.desktop_contract);
  const version = text(runtime.version) || versionFromText(versionText) || null;
  const releaseDate =
    text(runtime.release_date) || releaseDateFromText(versionText) || null;
  const updateInfo = updateInfoFromText(versionText) || null;
  const updateBehind = Number(runtime.update_behind);
  const updateAvailable =
    !!updateInfo || (Number.isFinite(updateBehind) && updateBehind > 0);
  const runtimeObserved = Object.keys(runtime).length > 0;
  const commands = evidence.commandNames
    ? new Set(evidence.commandNames)
    : null;

  let compatibility: AgentCapabilitySnapshot["compatibility"] = "unknown";
  if (desktopContract !== null) {
    compatibility =
      desktopContract >= RECOMMENDED_AGENT_DESKTOP_CONTRACT
        ? "compatible"
        : "update-recommended";
  } else if (runtimeObserved || version) {
    compatibility = "legacy";
  }

  return {
    canUpdate: evidence.connectionMode !== "remote",
    checkedAt: evidence.checkedAt ?? Date.now(),
    compatibility,
    desktopContract,
    features: {
      approvalsMode: contractFeature(desktopContract, 3),
      automationBlueprints: commandFeature(commands, "blueprint"),
      backgroundPrompts: commandFeature(commands, "background"),
      dashboardChat:
        desktopContract !== null
          ? contractFeature(desktopContract, 1)
          : runtimeObserved
            ? { state: "supported", source: "runtime-probe" }
            : { state: "unknown", source: "unknown" },
      explicitNormalTier: contractFeature(desktopContract, 4),
      fileAttach: contractFeature(desktopContract, 2),
      keyedPluginManagement: contractFeature(desktopContract, 6),
      largeFileAttach: contractFeature(desktopContract, 5),
      promptQueue: commandFeature(commands, "queue"),
      runsTransport: apiFeature(evidence.apiRunsTransport),
      sessionLoops: commandFeature(commands, "loop"),
      toolCallSteering: commandFeature(commands, "steer"),
      voiceCommands: commandFeature(commands, "voice"),
    },
    minimumDesktopContract: MIN_AGENT_DESKTOP_CONTRACT,
    recommendedDesktopContract: RECOMMENDED_AGENT_DESKTOP_CONTRACT,
    recommendedVersion: updateInfo
      ? recommendedVersionFromUpdate(updateInfo) || null
      : null,
    releaseDate,
    updateAvailable,
    updateCommand: text(runtime.update_command) || null,
    updateInfo,
    version,
  };
}
