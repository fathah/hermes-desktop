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
