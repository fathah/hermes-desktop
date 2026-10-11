import type { ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import { providerTargetRevision } from "./provider-request-target";

// Token and cost totals a Hermes server has accumulated for one session
// (GET /api/sessions/{id}). A chat opened from history has no live usage
// events, so these seed its running totals; new turns are added on top.

export interface SessionUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Null when the session is unknown, has no recorded usage, or the call fails. */
export async function remoteGetSessionUsage(
  conn: ConnectionConfig,
  sessionId: string,
  profile?: string,
): Promise<SessionUsageTotals | null> {
  if (!sessionId) return null;
  try {
    const captured = structuredClone(conn);
    const revision = providerTargetRevision(captured);
    const row = await remoteDashboardRequestJson<Record<string, unknown>>(
      captured,
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      {},
      profile,
    );
    if (providerTargetRevision(captured) !== revision) return null;
    const promptTokens = count(row?.input_tokens);
    const completionTokens = count(row?.output_tokens);
    if (promptTokens === 0 && completionTokens === 0) return null;
    const cost = count(row?.actual_cost_usd) || count(row?.estimated_cost_usd);
    const cacheRead = count(row?.cache_read_tokens);
    const cacheWrite = count(row?.cache_write_tokens);
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      ...(cost > 0 ? { cost } : {}),
      ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    };
  } catch {
    return null;
  }
}
