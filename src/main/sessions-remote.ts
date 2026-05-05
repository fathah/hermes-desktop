import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import type { SessionSummary, SessionMessage, SearchResult } from "./sessions";

/**
 * Fetch all sessions from the remote API server.
 * Returns an empty array on network errors or non-OK responses.
 */
export async function listSessionsRemote(
  limit = 30,
  offset = 0,
): Promise<SessionSummary[]> {
  try {
    const base = getApiUrl();
    const headers = getRemoteAuthHeader();
    headers["Accept"] = "application/json";
    const url = `${base}/api/sessions?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map((r) => ({
      id: String(r.id ?? ""),
      source: String(r.source ?? ""),
      startedAt: Number(r.started_at ?? r.startedAt ?? 0),
      endedAt: r.ended_at != null ? Number(r.ended_at) : null,
      messageCount: Number(r.message_count ?? r.messageCount ?? 0),
      model: String(r.model ?? ""),
      title: r.title != null ? String(r.title) : null,
      preview: String(r.preview ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Search sessions via the remote API server.
 * Returns an empty array on network errors or non-OK responses.
 */
export async function searchSessionsRemote(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  try {
    const base = getApiUrl();
    const headers = getRemoteAuthHeader();
    headers["Accept"] = "application/json";
    const url = `${base}/api/sessions/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map((r) => ({
      sessionId: String(r.session_id ?? r.id ?? ""),
      title: r.title != null ? String(r.title) : null,
      startedAt: Number(r.started_at ?? r.startedAt ?? 0),
      source: String(r.source ?? ""),
      messageCount: Number(r.message_count ?? r.messageCount ?? 0),
      model: String(r.model ?? ""),
      snippet: String(r.snippet ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch messages for a specific session from the remote API server.
 * Returns an empty array on network errors or non-OK responses.
 */
export async function getSessionMessagesRemote(
  sessionId: string,
): Promise<SessionMessage[]> {
  try {
    const base = getApiUrl();
    const headers = getRemoteAuthHeader();
    headers["Accept"] = "application/json";
    const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map((r) => ({
      id: Number(r.id ?? 0),
      role: (String(r.role ?? "user")) as "user" | "assistant" | "tool",
      content: String(r.content ?? ""),
      timestamp: Number(r.timestamp ?? 0),
    }));
  } catch {
    return [];
  }
}
