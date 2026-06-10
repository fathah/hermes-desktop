import { getConnectionConfig } from "./config";
import {
  isSshTunnelActive,
  isSshTunnelHealthy,
  startSshTunnel,
} from "./ssh-tunnel";
import { startHealthPolling as startGatewayHealthPolling } from "./hermes/gateway-process";

export {
  setSshRemoteApiKey,
  getRemoteAuthHeader,
  resolveRemoteApiKey,
} from "./hermes/gateway-process";

export async function ensureSshTunnelIfNeeded(): Promise<void> {
  const conn = getConnectionConfig();
  if (
    conn.mode === "ssh" &&
    (!isSshTunnelActive() || !(await isSshTunnelHealthy()))
  ) {
    await startSshTunnel(conn.ssh);
  }
}

export function isRemoteOnlyMode(): boolean {
  return getConnectionConfig().mode === "remote";
}

// Re-exports from gateway-process.ts
export {
  resolveProfile,
  profileKey,
  isRemoteMode,
  normaliseRemoteUrl,
  getApiUrl,
  isApiServerReady,
  waitForApiServerReady,
  ensureApiServerConfig,
  startGateway,
  stopGateway,
  isGatewayRunning,
  isApiReady,
  testRemoteConnection,
  restartGateway,
  notifyProfileSwitched,
  startHealthPolling,
  stopHealthPolling,
  apiServerAvailable,
  getApiServerAvailable,
  setApiServerAvailable,
  setGatewayHealthBroadcaster,
  setStreamOpenProvider,
  getGatewayHealthStatus,
} from "./hermes/gateway-process";

// Re-exports from grounding.ts
export {
  groundingTerms,
  formatRetrievalSystemMessage,
  parseQueryVariants,
  fuseRankings,
  buildRetrievalSystemMessage,
} from "./hermes/grounding";

// Re-exports from chat-client.ts
export {
  chatCompletionOnce,
  respondRunApproval,
  buildUserContent,
  contextFolderSystemMessage,
  buildSelfAwarenessSystemMessage,
  sendMessageViaApi,
  sendMessageViaCli,
  sendMessage,
} from "./hermes/chat-client";

// Re-exports from sse-parser.ts (as expected by tests and downstreams)
export { extractReasoningDelta } from "./sse-parser";

// Lazy init called on first sendMessage or gateway start (delegates to gateway-process.ts)
export function ensureInitialized(): void {
  startGatewayHealthPolling();
}
