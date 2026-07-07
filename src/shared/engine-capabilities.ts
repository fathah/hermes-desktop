import type { EngineContractVerificationResult } from "./engine-contract";

export type EngineConnectionMode = "local" | "remote" | "ssh";

export type EngineCapabilityFeatureValue = boolean | string | number;

export interface EngineCapabilityEndpoint {
  method: string;
  path: string;
}

export interface EngineCapabilitySnapshot {
  status: "ready" | "unknown";
  fetchedAt: string | null;
  mode: EngineConnectionMode;
  engineSha: string | null;
  features: Record<string, EngineCapabilityFeatureValue>;
  endpoints: Record<string, EngineCapabilityEndpoint>;
  error?: string;
}

export interface EngineCapabilityState {
  installedSha: string | null;
  lastVerifiedSha: string | null;
  lastVerification: EngineContractVerificationResult | null;
  snapshot: EngineCapabilitySnapshot;
}

export interface NormalizedEngineCapabilitiesPayload {
  features: Record<string, EngineCapabilityFeatureValue>;
  endpoints: Record<string, EngineCapabilityEndpoint>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFeatureValue(value: unknown): value is EngineCapabilityFeatureValue {
  return (
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  );
}

export function normalizeEngineCapabilitiesPayload(
  payload: unknown,
): NormalizedEngineCapabilitiesPayload {
  const root = isRecord(payload) ? payload : {};
  const rawFeatures = isRecord(root.features) ? root.features : {};
  const rawEndpoints = isRecord(root.endpoints) ? root.endpoints : {};

  const features: Record<string, EngineCapabilityFeatureValue> = {};
  for (const [key, value] of Object.entries(rawFeatures)) {
    if (isFeatureValue(value)) {
      features[key] = value;
    }
  }

  const endpoints: Record<string, EngineCapabilityEndpoint> = {};
  for (const [key, value] of Object.entries(rawEndpoints)) {
    if (!isRecord(value)) continue;
    const method = value.method;
    const path = value.path;
    if (typeof method === "string" && typeof path === "string") {
      endpoints[key] = { method, path };
    }
  }

  return { features, endpoints };
}

export function unknownEngineCapabilitySnapshot(
  mode: EngineConnectionMode = "local",
  engineSha: string | null = null,
  error?: string,
  fetchedAt: string | null = null,
): EngineCapabilitySnapshot {
  return {
    status: "unknown",
    fetchedAt,
    mode,
    engineSha,
    features: {},
    endpoints: {},
    ...(error ? { error } : {}),
  };
}

function normalizedFeatureValue(
  snapshot: EngineCapabilitySnapshot | null | undefined,
  keys: string[],
): EngineCapabilityFeatureValue | null {
  if (!snapshot || snapshot.status !== "ready") return null;
  for (const key of keys) {
    const value = snapshot.features[key];
    if (value !== undefined) return value;
  }
  return null;
}

function featureValueEnabled(
  value: EngineCapabilityFeatureValue | null,
): boolean {
  if (value === null) return false;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "number") return value > 0;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "0";
}

export function engineFeatureEnabled(
  snapshot: EngineCapabilitySnapshot | null | undefined,
  keys: string | string[],
): boolean {
  return featureValueEnabled(
    normalizedFeatureValue(snapshot, Array.isArray(keys) ? keys : [keys]),
  );
}

export function engineSupportsMixtureOfAgents(
  snapshot: EngineCapabilitySnapshot | null | undefined,
): boolean {
  return engineFeatureEnabled(snapshot, [
    "mixture_of_agents",
    "mixtureOfAgents",
    "moa",
    "model_provider_moa",
    "provider.moa",
  ]);
}

export function engineSupportsSlashCommand(
  snapshot: EngineCapabilitySnapshot | null | undefined,
  command: string,
): boolean {
  if (!snapshot || snapshot.status !== "ready") return false;
  const clean = command.replace(/^\//, "").trim().toLowerCase();
  if (!clean) return false;
  if (
    engineFeatureEnabled(snapshot, [
      `slash_command_${clean}`,
      `slash.${clean}`,
      `command.${clean}`,
    ])
  ) {
    return true;
  }
  const list = normalizedFeatureValue(snapshot, [
    "slash_commands",
    "slashCommands",
    "commands",
  ]);
  if (typeof list !== "string") return false;
  return list
    .split(/[,\s]+/)
    .map((item) => item.replace(/^\//, "").trim().toLowerCase())
    .includes(clean);
}
