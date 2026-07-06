import http from "http";
import https from "https";
import type { CachedSession } from "./session-cache";
import {
  extractLeadingVisionImageFallback,
  stripTrailingImagePlaceholders,
} from "./session-attachment-store";
import {
  expandRowsToHistory,
  type HistoryItem,
  type RawMessageRow,
  type SearchResult,
  type SessionSummary,
} from "./sessions";
import type { Attachment } from "../shared/attachments";
import { isImageMime, MAX_IMAGE_BYTES } from "../shared/attachments";

export interface RemoteSessionConfig {
  remoteUrl: string;
  apiKey: string;
  /** When set (and not "default"), every dashboard request is scoped to this
   *  profile via `?profile=`. The SSH transport uses ONE unified machine
   *  dashboard for all profiles (see ensureDashboardInner), so per-profile data
   *  correctness comes from this query param rather than a per-profile server. */
  profile?: string;
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RemoteRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  timeoutMs?: number;
}

type RemoteRecord = Record<string, unknown>;

function normalizeRemoteDashboardBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Remote Hermes dashboard URL is not configured.");
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname === "/v1" || url.pathname === "/api") {
    url.pathname = "";
  }
  return url.toString().replace(/\/+$/, "");
}

// Exported so every dashboard request — including remote-metadata's /api/status
// probe — shares ONE URL builder and gets the same `?profile=` scoping.
export function dashboardApiUrl(
  config: RemoteSessionConfig,
  path: string,
): string {
  const base = normalizeRemoteDashboardBaseUrl(config.remoteUrl);
  const url = new URL(path, `${base}/`);
  // Scope to the requested profile on the unified machine dashboard, unless the
  // path already carries an explicit profile (e.g. the sessions list uses
  // `profile=all`). "default"/empty needs no param.
  const profile = config.profile?.trim();
  if (profile && profile !== "default" && !url.searchParams.has("profile")) {
    url.searchParams.set("profile", profile);
  }
  return url.toString();
}

export function remoteRequestJson<T>(
  config: RemoteSessionConfig,
  path: string,
  options: RemoteRequestOptions = {},
): Promise<T> {
  const token = config.apiKey.trim();
  if (!token)
    throw new Error("Remote Hermes dashboard token is not configured.");

  return new Promise((resolve, reject) => {
    const parsed = new URL(dashboardApiUrl(config, path));
    const client = parsed.protocol === "https:" ? https : http;
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = client.request(
      parsed,
      {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Hermes-Session-Token": token,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new Error(`${res.statusCode}: ${text || res.statusMessage}`),
            );
            return;
          }
          if (!text) {
            resolve(null as T);
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(
              new Error(
                `Invalid JSON from ${parsed.toString()} (status ${
                  res.statusCode
                }): ${text.slice(0, 200)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(options.timeoutMs ?? 15_000, () => {
      req.destroy(
        new Error(
          `Timed out connecting to remote Hermes dashboard after ${
            options.timeoutMs ?? 15_000
          }ms`,
        ),
      );
    });
    if (body) req.write(body);
    req.end();
  });
}

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function asArray(value: unknown): RemoteRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dataUrlValue(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("data:image/")
    ? value
    : null;
}

function remoteImageName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || "image";
}

function highlightTextMatch(text: string, query: string): string {
  if (!text) return "";
  const terms = [query.trim(), ...query.trim().split(/\s+/)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index >= 0) {
      return `${text.slice(0, index)}<<${text.slice(
        index,
        index + term.length,
      )}>>${text.slice(index + term.length)}`;
    }
  }
  return text;
}

function historyItemSearchText(item: HistoryItem): string {
  switch (item.kind) {
    case "user":
    case "assistant":
    case "tool_result":
      return item.content || "";
    case "reasoning":
      return item.text || "";
    case "tool_call":
      return [item.name, item.args].filter(Boolean).join(" ");
  }
}

function attachmentFromRemoteDataUrl(
  dataUrl: string | null,
  filePath: string,
  id: string,
): Attachment | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!isImageMime(mime)) return null;
  const size = Buffer.byteLength(match[2], "base64");
  if (size <= 0 || size > MAX_IMAGE_BYTES) return null;
  return {
    id,
    kind: "image",
    name: remoteImageName(filePath),
    mime,
    size,
    dataUrl: dataUrl || "",
    path: filePath,
  };
}

function sessionTitle(row: RemoteRecord, id: string): string {
  return (
    nullableString(row.title) ??
    nullableString(row.preview) ??
    `Session ${id.slice(-6)}`
  );
}

function normalizeSessionSummary(row: RemoteRecord): SessionSummary {
  const id = stringValue(row.id, stringValue(row.session_id));
  return {
    id,
    source: stringValue(row.source, "chat"),
    startedAt: numberValue(
      row.started_at,
      numberValue(row.session_started, numberValue(row.last_active)),
    ),
    endedAt: nullableNumber(row.ended_at),
    messageCount: numberValue(row.message_count),
    model: stringValue(row.model),
    title: nullableString(row.title),
    preview: stringValue(row.preview),
  };
}

function normalizeCachedSession(row: RemoteRecord): CachedSession {
  const summary = normalizeSessionSummary(row);
  return {
    id: summary.id,
    title: summary.title ?? sessionTitle(row, summary.id),
    startedAt: summary.startedAt,
    source: summary.source,
    messageCount: summary.messageCount,
    model: summary.model,
    contextFolder: null,
  };
}

function sessionsFromResponse(response: unknown): RemoteRecord[] {
  const record = asRecord(response);
  return asArray(record.sessions);
}

async function remoteSessionListPage(
  config: RemoteSessionConfig,
  limit: number,
  offset: number,
): Promise<unknown> {
  const profileEndpoint =
    `/api/profiles/sessions?limit=${limit}&offset=${offset}` +
    "&min_messages=0&archived=exclude&order=recent&profile=all";

  try {
    return await remoteRequestJson(config, profileEndpoint);
  } catch {
    return remoteRequestJson(
      config,
      `/api/sessions?limit=${limit}&offset=${offset}&archived=exclude&order=recent`,
    );
  }
}

export async function remoteListSessions(
  config: RemoteSessionConfig,
  limit = 30,
  offset = 0,
): Promise<SessionSummary[]> {
  const response = await remoteSessionListPage(config, limit, offset);
  return sessionsFromResponse(response).map(normalizeSessionSummary);
}

export async function remoteListCachedSessions(
  config: RemoteSessionConfig,
  limit = 50,
  offset = 0,
): Promise<CachedSession[]> {
  const response = await remoteSessionListPage(config, limit, offset);
  return sessionsFromResponse(response).map(normalizeCachedSession);
}

export async function remoteSearchSessions(
  config: RemoteSessionConfig,
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const response = await remoteRequestJson(
    config,
    `/api/sessions/search?q=${encodeURIComponent(trimmed)}`,
  );
  const records = asArray(asRecord(response).results);
  const results = records.slice(0, limit).map((row) => {
    const sessionId = stringValue(row.session_id, stringValue(row.id));
    return {
      sessionId,
      title: nullableString(row.title),
      startedAt: numberValue(
        row.session_started,
        numberValue(row.started_at, numberValue(row.timestamp)),
      ),
      source: stringValue(row.source, "chat"),
      messageCount: numberValue(row.message_count),
      model: stringValue(row.model),
      snippet: stringValue(row.snippet),
    };
  });

  const enriched = await enrichRemoteSearchResults(config, results);
  if (enriched.length >= limit) return enriched.slice(0, limit);

  const fallback = await remoteSearchRecentSessionMessages(
    config,
    trimmed,
    limit,
    new Set(enriched.map((result) => result.sessionId)),
  );
  return [...enriched, ...fallback].slice(0, limit);
}

async function remoteSearchRecentSessionMessages(
  config: RemoteSessionConfig,
  query: string,
  limit: number,
  excludedSessionIds: Set<string>,
): Promise<SearchResult[]> {
  let sessions: SessionSummary[];
  try {
    sessions = await remoteListSessions(config, 75, 0);
  } catch {
    return [];
  }

  const lower = query.toLocaleLowerCase();
  const results: SearchResult[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map(async (session) => {
        if (!session.id || excludedSessionIds.has(session.id)) return null;
        try {
          const items = await remoteGetSessionMessages(config, session.id);
          const match = items
            .map(historyItemSearchText)
            .find((text) => text.toLocaleLowerCase().includes(lower));
          if (!match) return null;
          return {
            sessionId: session.id,
            title: session.title,
            startedAt: session.startedAt,
            source: session.source,
            messageCount: session.messageCount,
            model: session.model,
            snippet: highlightTextMatch(match, query).slice(0, 500),
          } satisfies SearchResult;
        } catch {
          return null;
        }
      }),
    );
    for (const result of fetched) {
      if (!result) continue;
      excludedSessionIds.add(result.sessionId);
      results.push(result);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function remoteGetSessionSummary(
  config: RemoteSessionConfig,
  sessionId: string,
): Promise<SessionSummary | null> {
  try {
    const response = await remoteRequestJson(
      config,
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      { timeoutMs: 8_000 },
    );
    const record = asRecord(response);
    return record.id || record.session_id
      ? normalizeSessionSummary(record)
      : null;
  } catch {
    return null;
  }
}

async function enrichRemoteSearchResults(
  config: RemoteSessionConfig,
  results: SearchResult[],
): Promise<SearchResult[]> {
  const uniqueIds = Array.from(
    new Set(results.map((result) => result.sessionId).filter(Boolean)),
  );
  if (uniqueIds.length === 0) return results;

  const summaries = new Map<string, SessionSummary>();
  const CONCURRENCY = 5;
  for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
    const chunk = uniqueIds.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map((id) => remoteGetSessionSummary(config, id)),
    );
    for (const summary of fetched) {
      if (summary?.id) summaries.set(summary.id, summary);
    }
  }

  return results.map((result) => {
    const summary = summaries.get(result.sessionId);
    if (!summary) return result;
    return {
      ...result,
      title: result.title ?? summary.title,
      startedAt: result.startedAt || summary.startedAt,
      source: result.source || summary.source,
      messageCount: summary.messageCount || result.messageCount,
      model: result.model || summary.model,
    };
  });
}

function toNumericMessageId(value: unknown, index: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return index + 1;
}

function normalizeMessageRow(row: RemoteRecord, index: number): RawMessageRow {
  return {
    id: toNumericMessageId(row.id, index),
    role: stringValue(row.role),
    content: typeof row.content === "string" ? row.content : null,
    timestamp: numberValue(row.timestamp, index),
    tool_call_id: nullableString(row.tool_call_id),
    tool_calls: typeof row.tool_calls === "string" ? row.tool_calls : null,
    tool_name: nullableString(row.tool_name),
    reasoning: nullableString(row.reasoning),
    reasoning_content: nullableString(row.reasoning_content),
    reasoning_details:
      typeof row.reasoning_details === "string"
        ? row.reasoning_details
        : row.reasoning_details === undefined || row.reasoning_details === null
          ? null
          : JSON.stringify(row.reasoning_details),
  };
}

export async function remoteGetSessionMessages(
  config: RemoteSessionConfig,
  sessionId: string,
): Promise<HistoryItem[]> {
  const response = await remoteRequestJson(
    config,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const rows = asArray(asRecord(response).messages).map(normalizeMessageRow);
  return hydrateRemotePromptImageAttachments(config, expandRowsToHistory(rows));
}

async function hydrateRemotePromptImageAttachments(
  config: RemoteSessionConfig,
  items: HistoryItem[],
): Promise<HistoryItem[]> {
  const hydrated: HistoryItem[] = [];
  const cache = new Map<string, Promise<string | null>>();

  for (const item of items) {
    if (item.kind !== "user") {
      hydrated.push(item);
      continue;
    }

    const fallback = extractLeadingVisionImageFallback(item.content);
    if (!fallback.imagePath) {
      hydrated.push(item);
      continue;
    }

    const nextContent = stripTrailingImagePlaceholders(fallback.content);
    if (item.attachments?.length) {
      hydrated.push({ ...item, content: nextContent });
      continue;
    }

    const dataUrlPromise =
      cache.get(fallback.imagePath) ??
      remoteReadMediaAsDataUrl(config, fallback.imagePath);
    cache.set(fallback.imagePath, dataUrlPromise);
    const attachment = attachmentFromRemoteDataUrl(
      await dataUrlPromise,
      fallback.imagePath,
      `remote-fallback-att-${item.id}-0`,
    );

    hydrated.push({
      ...item,
      content: nextContent,
      ...(attachment ? { attachments: [attachment] } : {}),
    });
  }

  return hydrated;
}

export async function remoteReadMediaAsDataUrl(
  config: RemoteSessionConfig,
  filePath: string,
): Promise<string | null> {
  if (!filePath.trim()) return null;
  try {
    const response = await remoteRequestJson<unknown>(
      config,
      `/api/media?path=${encodeURIComponent(filePath)}`,
      { timeoutMs: 30_000 },
    );
    return dataUrlValue(asRecord(response).data_url);
  } catch {
    return null;
  }
}

export async function remoteUpdateSessionTitle(
  config: RemoteSessionConfig,
  sessionId: string,
  title: string,
): Promise<void> {
  await remoteRequestJson(
    config,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      body: { title },
    },
  );
}

export async function remoteDeleteSession(
  config: RemoteSessionConfig,
  sessionId: string,
): Promise<void> {
  await remoteRequestJson(
    config,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
    },
  );
}

export interface RemoteDeleteSessionsResult {
  requested: number;
  deleted: number;
}

export async function remoteDeleteSessions(
  config: RemoteSessionConfig,
  sessionIds: string[],
): Promise<RemoteDeleteSessionsResult> {
  let deleted = 0;
  for (const id of sessionIds) {
    await remoteDeleteSession(config, id);
    deleted += 1;
  }
  return { requested: sessionIds.length, deleted };
}
