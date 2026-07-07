import { getConnectionConfig } from "./config";
import {
  getEngineCapabilityState as getStoredEngineCapabilityState,
  recordEngineCapabilitySnapshot,
} from "./engine-update-state";
import { getInstalledEngineSha } from "./installer";
import { fetchJsonProbe } from "./hermes/chat-client/api";
import { getApiUrl, getRemoteAuthHeader } from "./hermes/gateway-process";
import {
  normalizeEngineCapabilitiesPayload,
  type EngineCapabilitySnapshot,
  type EngineCapabilityState,
} from "../shared/engine-capabilities";

const ENGINE_CAPABILITY_PROBE_TIMEOUT_MS = 2500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unknownSnapshot(
  mode: EngineCapabilitySnapshot["mode"],
  engineSha: string | null,
  error: string,
): EngineCapabilitySnapshot {
  return {
    status: "unknown",
    fetchedAt: new Date().toISOString(),
    mode,
    engineSha,
    features: {},
    endpoints: {},
    error,
  };
}

export function getEngineCapabilities(profile?: string): EngineCapabilityState {
  return getStoredEngineCapabilityState(profile);
}

export async function refreshEngineCapabilities(
  profile?: string,
): Promise<EngineCapabilityState> {
  const mode = getConnectionConfig().mode;
  const engineSha = mode === "local" ? await getInstalledEngineSha() : null;

  let snapshot: EngineCapabilitySnapshot;
  try {
    const probe = await fetchJsonProbe(
      `${getApiUrl(profile)}/v1/capabilities`,
      getRemoteAuthHeader(),
      ENGINE_CAPABILITY_PROBE_TIMEOUT_MS,
    );

    if (!probe?.ok) {
      snapshot = unknownSnapshot(
        mode,
        engineSha,
        probe ? `HTTP ${probe.status}` : "Capabilities probe failed",
      );
    } else {
      const normalized = normalizeEngineCapabilitiesPayload(probe.data);
      snapshot = {
        status: "ready",
        fetchedAt: new Date().toISOString(),
        mode,
        engineSha,
        features: normalized.features,
        endpoints: normalized.endpoints,
      };
    }
  } catch (error) {
    snapshot = unknownSnapshot(mode, engineSha, errorMessage(error));
  }

  return recordEngineCapabilitySnapshot(snapshot, profile);
}
