import { useCallback, useEffect, useRef } from "react";
import { LOCAL_PRESETS } from "../../../constants";
import {
  isBubbleMessage,
  markActiveTurnFailed,
  normalizeMessageText,
} from "../chatMessages";
import {
  applyDashboardStreamEvent,
  type DashboardStreamEvent,
} from "../dashboardEventAdapter";
import { DashboardGatewayClient } from "../dashboardGatewayClient";
import { executeSlash, type SlashExecOutcome } from "../slashExec";
import type { AgentCommandsCatalogResponse } from "../slash/types";
import type { ActiveTurn, Attachment, ChatMessage, UsageState } from "../types";
import type { DesktopSessionContinuationItem } from "../../../../../shared/session-continuation";

interface SessionResponse {
  info?: unknown;
  messages?: unknown[];
  message_count?: number;
  resumed?: string;
  session_id: string;
  stored_session_id?: string | null;
}

interface ModelOptionsResponse {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

interface ModelOptionProvider {
  api_url?: string;
  base_url?: string;
  baseUrl?: string;
  is_current?: boolean;
  models?: string[];
  name?: string;
  slug: string;
}

interface SlashExecResponse {
  output?: string;
  warning?: string;
}

interface ImageAttachBytesResponse {
  attached?: boolean;
  message?: string;
  path?: string;
}

interface FileAttachResponse {
  attached?: boolean;
  message?: string;
  path?: string;
  ref_text?: string;
}

interface DashboardPromptClient {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

interface EnsureDashboardRuntimeSessionParams {
  client: DashboardPromptClient;
  contextFolder?: string | null;
  excludeSeedUserId?: string | null;
  forceCreate?: boolean;
  messages: ReadonlyArray<ChatMessage>;
  profile?: string;
  storedSessionId?: string | null;
}

interface EnsureDashboardRuntimeSessionResult {
  created: boolean;
  runtimeSessionId: string;
  storedSessionId: string;
}

interface UseDashboardChatTransportArgs {
  activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
  contextFolder: string | null;
  connectionMode: DashboardConnectionMode;
  enabled: boolean;
  fallbackOnUnavailable: boolean;
  hermesSessionId: string | null;
  messages: ChatMessage[];
  model?: string;
  modelBaseUrl?: string;
  profile?: string;
  provider?: string;
  setHermesSessionId: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setToolProgress: (tool: string | null) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
  /** Called once per connection when the dashboard transport is found to be
   *  unavailable on a remote/SSH connection and the renderer is falling back to
   *  the legacy HTTP transport. Lets the UI surface a one-time notice. */
  onDashboardUnavailable?: (reason: string) => void;
}

interface UseDashboardChatTransportResult {
  abort: () => void;
  enabled: boolean;
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<boolean>;
  /**
   * Run a slash command through the gateway's `slash.exec` pipeline instead of
   * submitting it to the model as a literal prompt. `sys` renders command
   * output into the transcript; a `send` outcome hands an agent prompt back to
   * the caller so it can run a normal streaming turn.
   */
  execSlash: (
    command: string,
    sys: (text: string) => void,
  ) => Promise<SlashExecOutcome>;
  getCommandCatalog: () => Promise<AgentCommandsCatalogResponse>;
  /**
   * Launch a background (`/btw`, `/bg`, `/background`) prompt via the gateway's
   * `prompt.background` RPC. It runs a separate agent concurrently with the
   * main turn — so it never blocks or queues — and the answer arrives later as
   * a `background.complete` event rendered into the transcript.
   */
  runBackground: (text: string) => Promise<{ taskId?: string; error?: string }>;
}

interface DashboardSeedMessage {
  content: string;
  role: "assistant" | "user";
}

interface DashboardSeedOptions {
  excludeUserId?: string | null;
}

type DashboardConnectionMode = "local" | "remote" | "ssh";

export function dashboardChatEnabledFromEnv(
  value: string | undefined,
): boolean {
  return value !== "0" && value?.toLowerCase() !== "false";
}

export function dashboardChatEnabledForConnection(
  envValue: string | undefined,
  connectionModeLoaded: boolean,
  mode: "local" | "remote" | "ssh",
  preference: "auto" | "dashboard" | "legacy",
): boolean {
  if (!dashboardChatEnabledFromEnv(envValue) || !connectionModeLoaded) {
    return false;
  }
  if (preference === "legacy") return false;
  if (mode === "local") return true;
  if (mode === "remote") return true;
  return mode === "ssh";
}

export function dashboardShouldPersistLocalOverlays(
  _mode: DashboardConnectionMode,
): boolean {
  return true;
}

export function isDashboardSessionNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /session not found/i.test(message);
}

export function isDashboardSlashWorkerExitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /slash worker exited/i.test(message);
}

export async function submitDashboardPromptWithRecovery(
  client: DashboardPromptClient,
  params: {
    onRecoveredSessionId?: (sessionId: string) => void;
    sessionId: string;
    storedSessionId?: string | null;
    text: string;
    /** Scopes the turn to this profile on the UNIFIED machine dashboard. Without
     *  it, prompt.submit runs in the dashboard's launch profile (default), so a
     *  named profile's chat would answer as `default`. session create/resume
     *  already pass it; prompt.submit must too. */
    profile?: string;
  },
): Promise<string> {
  const profileParam =
    params.profile && params.profile !== "default"
      ? { profile: params.profile }
      : {};
  try {
    await client.request("prompt.submit", {
      session_id: params.sessionId,
      text: params.text,
      ...profileParam,
    });
    return params.sessionId;
  } catch (err) {
    if (!params.storedSessionId || !isDashboardSessionNotFoundError(err)) {
      throw err;
    }

    const resumed = await client.request<SessionResponse>("session.resume", {
      session_id: params.storedSessionId,
      ...profileParam,
    });
    const recoveredSessionId = resumed?.session_id;
    if (!recoveredSessionId) {
      throw err;
    }

    params.onRecoveredSessionId?.(recoveredSessionId);
    await client.request("prompt.submit", {
      session_id: recoveredSessionId,
      text: params.text,
      ...profileParam,
    });
    return recoveredSessionId;
  }
}

export async function ensureDashboardRuntimeSession(
  params: EnsureDashboardRuntimeSessionParams,
): Promise<EnsureDashboardRuntimeSessionResult> {
  const cols = 96;
  const stored = params.forceCreate ? null : params.storedSessionId || null;

  if (stored) {
    try {
      const resumed = await params.client.request<SessionResponse>(
        "session.resume",
        {
          session_id: stored,
          cols,
          ...(params.profile ? { profile: params.profile } : {}),
        },
      );
      if (!resumed.session_id) {
        throw new Error("session.resume returned no session_id");
      }
      return {
        created: false,
        runtimeSessionId: resumed.session_id,
        storedSessionId: resumed.stored_session_id || resumed.resumed || stored,
      };
    } catch (err) {
      if (!isDashboardSessionNotFoundError(err)) {
        throw err;
      }
    }
  }

  const seedMessages = dashboardSeedMessagesFromTranscript(params.messages, {
    excludeUserId: params.excludeSeedUserId ?? null,
  });
  const created = await params.client.request<SessionResponse>(
    "session.create",
    {
      cols,
      ...(seedMessages.length > 0 ? { messages: seedMessages } : {}),
      ...(params.contextFolder ? { cwd: params.contextFolder } : {}),
      ...(params.profile ? { profile: params.profile } : {}),
    },
  );

  return {
    created: true,
    runtimeSessionId: created.session_id,
    storedSessionId: created.stored_session_id || created.session_id,
  };
}

export function dashboardModelCommand(
  provider: string | undefined,
  model: string | undefined,
): string | null {
  if (!provider || provider === "auto" || !model) return null;
  return `/model ${model} --provider ${provider}`;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function providerBaseUrl(provider: ModelOptionProvider): string {
  return provider.api_url || provider.base_url || provider.baseUrl || "";
}

function modelIsListedByProvider(
  provider: ModelOptionProvider,
  model: string,
): boolean {
  return (provider.models ?? []).some((candidate) => candidate === model);
}

function builtInProviderForCustomBaseUrl(
  requestedBaseUrl: string,
  requestedModel: string,
  live: ModelOptionsResponse | null | undefined,
): string | null {
  const normalizedBaseUrl = normalizeBaseUrl(requestedBaseUrl);
  if (!normalizedBaseUrl) return null;

  const preset = LOCAL_PRESETS.find(
    (candidate) => normalizeBaseUrl(candidate.baseUrl) === normalizedBaseUrl,
  );
  if (!preset) return null;

  const provider = (live?.providers ?? []).find(
    (candidate) => candidate.slug === preset.id,
  );
  if (!provider || !modelIsListedByProvider(provider, requestedModel)) {
    return null;
  }

  return preset.id;
}

function modelOptionsSummary(
  live: ModelOptionsResponse | null | undefined,
): string {
  const providers = live?.providers ?? [];
  const custom = providers
    .filter((provider) => provider.slug?.toLowerCase().startsWith("custom:"))
    .slice(0, 8)
    .map((provider) => {
      const models = (provider.models ?? []).slice(0, 3).join(", ");
      const modelSuffix = models ? ` models=[${models}]` : "";
      const url = normalizeBaseUrl(providerBaseUrl(provider));
      const urlSuffix = url ? ` url=${url}` : "";
      return `${provider.slug}${urlSuffix}${modelSuffix}`;
    });

  return custom.length ? custom.join("; ") : "no custom providers listed";
}

function base64FromDataUrl(dataUrl: string | undefined): string {
  if (!dataUrl) return "";
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

function safeAttachmentFilename(
  name: string | undefined,
  index: number,
): string {
  const trimmed = (name || "").trim();
  return trimmed || `image-${index + 1}.png`;
}

function safeFileAttachmentName(attachment: Attachment, index: number): string {
  const trimmed = (attachment.name || "").trim();
  if (trimmed) return trimmed;
  return `attachment-${index + 1}`;
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function dashboardDataUrlForTextAttachment(
  attachment: Attachment,
): string | null {
  if (attachment.kind !== "text-file" || typeof attachment.text !== "string") {
    return null;
  }
  const mime = attachment.mime || "text/plain";
  return `data:${mime};base64,${base64EncodeUtf8(attachment.text)}`;
}

function dashboardAttachmentUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unknown method|method not found|not found|unsupported/i.test(message);
}

export function dashboardPromptTextForAttachments(
  text: string,
  attachments?: Attachment[],
): string | null {
  if (!attachments?.length) return text;
  const supported = attachments.every(
    (attachment) =>
      attachment.kind === "image" ||
      attachment.kind === "text-file" ||
      attachment.kind === "path-ref",
  );
  if (!supported) return null;
  const images = attachments.filter(
    (attachment) => attachment.kind === "image",
  );
  if (images.some((image) => !base64FromDataUrl(image.dataUrl))) return null;
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  const hasAttachableFiles = files.every((attachment) => {
    if (attachment.kind === "text-file") {
      return typeof attachment.text === "string";
    }
    return attachment.kind === "path-ref" && !!attachment.path;
  });
  if (!hasAttachableFiles) return null;
  if (text.trim()) return text;
  return images.length > 0 ? "What do you see in this image?" : "";
}

export function dashboardPromptTextWithAttachmentRefs(
  text: string,
  refs: string[],
): string {
  return [refs.join("\n").trim(), text.trim()].filter(Boolean).join("\n\n");
}

export async function syncDashboardAttachmentsForSubmit(
  client: DashboardPromptClient,
  sessionId: string,
  attachments?: Attachment[],
): Promise<{ handled: boolean; refs: string[] }> {
  const images = (attachments ?? []).filter(
    (attachment) => attachment.kind === "image",
  );
  const files = (attachments ?? []).filter(
    (attachment) => attachment.kind !== "image",
  );
  if (images.length === 0 && files.length === 0) {
    return { handled: true, refs: [] };
  }

  let attachedCount = 0;
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const contentBase64 = base64FromDataUrl(image.dataUrl);
    if (!contentBase64) return { handled: false, refs: [] };

    try {
      const result = await client.request<ImageAttachBytesResponse>(
        "image.attach_bytes",
        {
          session_id: sessionId,
          content_base64: contentBase64,
          filename: safeAttachmentFilename(image.name, index),
        },
      );
      if (!result?.attached) {
        throw new Error(result?.message || `Could not attach ${image.name}`);
      }
      attachedCount += 1;
    } catch (err) {
      if (attachedCount === 0 && dashboardAttachmentUnsupportedError(err)) {
        return { handled: false, refs: [] };
      }
      throw err;
    }
  }

  const refs: string[] = [];
  for (let index = 0; index < files.length; index++) {
    const attachment = files[index];
    const name = safeFileAttachmentName(attachment, index);
    const params: Record<string, unknown> = {
      session_id: sessionId,
      name,
    };

    if (attachment.kind === "text-file") {
      const dataUrl = dashboardDataUrlForTextAttachment(attachment);
      if (!dataUrl) return { handled: false, refs: [] };
      params.data_url = dataUrl;
    } else if (attachment.kind === "path-ref" && attachment.path) {
      params.path = attachment.path;
    } else {
      return { handled: false, refs: [] };
    }

    try {
      const result = await client.request<FileAttachResponse>(
        "file.attach",
        params,
      );
      if (!result?.attached || !result.ref_text) {
        throw new Error(result?.message || `Could not attach ${name}`);
      }
      refs.push(result.ref_text);
      attachedCount += 1;
    } catch (err) {
      if (attachedCount === 0 && dashboardAttachmentUnsupportedError(err)) {
        return { handled: false, refs: [] };
      }
      throw err;
    }
  }

  return { handled: true, refs };
}

export function resolveDashboardProviderForModel(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
  modelBaseUrl: string | undefined,
  live: ModelOptionsResponse | null | undefined,
): string | undefined {
  if (requestedProvider !== "custom" || !requestedModel) {
    return requestedProvider;
  }

  const providers = live?.providers ?? [];
  const requestedBaseUrl = normalizeBaseUrl(modelBaseUrl);
  const model = requestedModel.trim();

  if (requestedBaseUrl) {
    const builtInProvider = builtInProviderForCustomBaseUrl(
      modelBaseUrl || "",
      model,
      live,
    );
    if (builtInProvider) return builtInProvider;
  }

  const customProviders = providers.filter((provider) =>
    provider.slug?.toLowerCase().startsWith("custom:"),
  );

  if (requestedBaseUrl) {
    // Match ANY provider row on the requested endpoint — named user providers
    // from config.yaml `providers:` (e.g. the mirrored `hermesone` entry) as
    // well as legacy `custom:<name>` rows. Falling through to bare "custom"
    // is the failure mode this avoids: the agent resolves `--provider custom`
    // against the session's *current* base URL, so a session sitting on
    // another provider would send this model to the wrong endpoint (the
    // hermesone-swift → Nous-proxy 404).
    const baseMatches = providers.filter(
      (provider) =>
        !!provider.slug &&
        normalizeBaseUrl(providerBaseUrl(provider)) === requestedBaseUrl,
    );
    return (
      baseMatches.find((provider) => modelIsListedByProvider(provider, model))
        ?.slug ||
      baseMatches.find((provider) => provider.is_current)?.slug ||
      baseMatches[0]?.slug ||
      requestedProvider
    );
  }

  return (
    customProviders.find((provider) => modelIsListedByProvider(provider, model))
      ?.slug ||
    customProviders.find((provider) => provider.is_current)?.slug ||
    requestedProvider
  );
}

export function dashboardModelMatches(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
  live: ModelOptionsResponse | null | undefined,
): boolean {
  if (!requestedProvider || requestedProvider === "auto" || !requestedModel) {
    return true;
  }

  const liveProvider = (live?.provider || "").trim().toLowerCase();
  const liveModel = (live?.model || "").trim();
  const provider = requestedProvider.trim().toLowerCase();
  const model = requestedModel.trim();

  if (!liveProvider || !liveModel) return false;
  if (liveModel !== model) return false;
  if (liveProvider === provider) return true;

  // Named custom providers can be reported by Hermes Agent as custom:<slug>
  // while Hermes One's older model config still treats them as custom rows.
  return provider === "custom" && liveProvider.startsWith("custom:");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadTextLength(
  payload: Record<string, unknown>,
  key: string,
): number {
  return typeof payload[key] === "string" ? payload[key].length : 0;
}

interface DashboardEventSummary {
  eventSessionId: string | null;
  hasUsage: boolean;
  payloadKeys: string[];
  reasoningLength: number;
  renderedLength: number;
  runtimeSessionId: string | null;
  status: "accepted" | "dropped";
  textLength: number;
  timestamp: string;
  type: string;
}

declare global {
  interface Window {
    __HERMES_DASHBOARD_EVENTS__?: DashboardEventSummary[];
  }
}

function logDashboardEvent(
  event: DashboardStreamEvent,
  status: "accepted" | "dropped",
  runtimeSessionId: string | null,
): void {
  if (import.meta.env.VITE_HERMES_DESKTOP_DASHBOARD_EVENT_LOG !== "1") return;
  const payload = asRecord(event.payload);
  const summary: DashboardEventSummary = {
    timestamp: new Date().toISOString(),
    status,
    type: event.type,
    eventSessionId: event.session_id || null,
    runtimeSessionId,
    payloadKeys: Object.keys(payload).sort(),
    textLength: payloadTextLength(payload, "text"),
    renderedLength: payloadTextLength(payload, "rendered"),
    reasoningLength: payloadTextLength(payload, "reasoning"),
    hasUsage: !!payload.usage,
  };

  const events = window.__HERMES_DASHBOARD_EVENTS__ ?? [];
  events.push(summary);
  window.__HERMES_DASHBOARD_EVENTS__ = events.slice(-200);
  console.info("[Hermes dashboard event]", summary);
}

export function usageFromPayload(payload: unknown): Partial<UsageState> | null {
  const usage = asRecord(asRecord(payload).usage);
  // The Hermes gateway (`_get_usage` in tui_gateway/server.py) emits
  // snake-case, non-`_tokens` keys: input/output/prompt/completion/total plus
  // context_used/context_max/context_percent when the context compressor is
  // active. Older OpenAI-style payloads use prompt_tokens/promptTokens. Read
  // every spelling so the context gauge works regardless of which backend/
  // provider produced the usage record — no chars/4 estimate needed because
  // the gateway already reports exact counts.
  const promptTokens = Number(
    usage.input ??
      usage.prompt ??
      usage.prompt_tokens ??
      usage.promptTokens ??
      0,
  );
  const completionTokens = Number(
    usage.output ??
      usage.completion ??
      usage.completion_tokens ??
      usage.completionTokens ??
      0,
  );
  const totalTokens = Number(
    usage.total ??
      usage.total_tokens ??
      usage.totalTokens ??
      promptTokens + completionTokens,
  );
  // context_used = the current turn's prompt-token occupancy of the context
  // window (compressor's last_prompt_tokens), which is exactly what the gauge
  // wants — a live snapshot, not a cross-turn sum. Fall back to the latest
  // prompt count when the compressor hasn't reported yet.
  const contextUsed = Number(usage.context_used ?? 0);
  const contextMax = Number(usage.context_max ?? 0);
  if (!promptTokens && !completionTokens && !totalTokens && !contextUsed) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    contextTokens: contextUsed || promptTokens || undefined,
    contextWindowTokens: contextMax || undefined,
  };
}

function messageChars(message: ChatMessage): number {
  if ("content" in message) return message.content?.length ?? 0;
  switch (message.kind) {
    case "reasoning":
      return message.text.length;
    case "tool_call":
      return message.name.length + message.args.length;
    case "clarify":
      return message.question.length;
    default:
      return 0;
  }
}

/**
 * Rough context-occupancy estimate (~4 chars/token) from the transcript, used
 * as a last resort when the provider omits usage counts so the context gauge
 * still renders (it only shows when `contextTokens` is set — see Chat.tsx).
 *
 * `contextTokens` means the turn's PROMPT-side occupancy, and by the time
 * `message.complete` is handled the just-finished assistant reply has already
 * been reconciled into `messagesRef.current` — so the last assistant bubble
 * (specifically the bubble, not trailing tool/reasoning sub-rows, which were
 * part of the prompt loop) is subtracted back out.
 *
 * Inherently a floor: system prompt, tool schemas, and attachments aren't
 * visible to the renderer.
 */
export function estimateContextTokens(
  messages: ReadonlyArray<ChatMessage>,
): number {
  let totalChars = 0;
  let lastAssistantBubbleChars = 0;
  for (const message of messages) {
    const chars = messageChars(message);
    totalChars += chars;
    const isBubble = message.kind === undefined || message.kind === "assistant";
    if (message.role === "agent" && isBubble) {
      lastAssistantBubbleChars = chars;
    }
  }
  return Math.max(Math.round((totalChars - lastAssistantBubbleChars) / 4), 0);
}

export function completionFailed(payload: unknown): boolean {
  const row = asRecord(payload);
  const status = String(row.status || "").toLowerCase();
  if (status === "error" || status === "failed") return true;
  if (typeof row.error === "string" && row.error.trim()) return true;
  if (row.ok === false || row.success === false) return true;
  const text = String(row.text || row.rendered || "").trim();
  return /^(error:\s*)?(error code:\s*\d+|api call failed after \d+ retries|hermes dashboard did not switch\b)/i.test(
    text,
  );
}

function completionErrorMessage(payload: unknown): string {
  const row = asRecord(payload);
  const raw = String(row.error || row.text || row.rendered || "").trim();
  return raw.replace(/^error\s*:\s*/i, "") || "Hermes reported an error";
}

function userContentById(
  messages: ReadonlyArray<ChatMessage>,
  userId: string | null | undefined,
): string {
  if (!userId) return "";
  const message = messages.find(
    (candidate) =>
      isBubbleMessage(candidate) &&
      candidate.role === "user" &&
      candidate.id === userId,
  );
  return message && isBubbleMessage(message) ? message.content || "" : "";
}

function previousUserIdBefore(
  messages: ReadonlyArray<ChatMessage>,
  beforeIndex: number,
): string | null {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (isBubbleMessage(message) && message.role === "user") return message.id;
    if (
      isBubbleMessage(message) &&
      message.role === "agent" &&
      !message.error
    ) {
      return null;
    }
  }
  return null;
}

export function dashboardSeedMessagesFromTranscript(
  messages: ReadonlyArray<ChatMessage>,
  options: DashboardSeedOptions = {},
): DashboardSeedMessage[] {
  const failedUserIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (isBubbleMessage(message) && message.role === "agent" && message.error) {
      const userId = previousUserIdBefore(messages, i);
      if (userId) failedUserIds.add(userId);
    }
  }

  const seed: DashboardSeedMessage[] = [];
  for (const message of messages) {
    if (!isBubbleMessage(message)) continue;
    if (message.role === "user" && message.id === options.excludeUserId)
      continue;
    if (message.localOnly || message.error || message.pending) continue;
    if (failedUserIds.has(message.id)) continue;
    const content = normalizeMessageText(message.content);
    if (!content) continue;
    seed.push({
      role: message.role === "agent" ? "assistant" : "user",
      content,
    });
  }
  return seed;
}

export function dashboardContinuationItemsFromTranscript(
  messages: ReadonlyArray<ChatMessage>,
  options: DashboardSeedOptions = {},
): DesktopSessionContinuationItem[] {
  const items: DesktopSessionContinuationItem[] = [];

  for (const message of messages) {
    if (isBubbleMessage(message)) {
      if (message.role === "user" && message.id === options.excludeUserId) {
        continue;
      }

      if (message.role === "user") {
        const content = message.content || "";
        if (!normalizeMessageText(content) && !message.attachments?.length) {
          continue;
        }
        items.push({
          kind: "user",
          content,
          ...(message.attachments?.length
            ? { attachments: message.attachments }
            : {}),
        });
        continue;
      }

      const content = message.content || "";
      const error = message.error || "";
      if (
        !normalizeMessageText(content) &&
        !normalizeMessageText(error) &&
        !message.attachments?.length
      ) {
        continue;
      }
      items.push({
        kind: "assistant",
        content,
        ...(error ? { error } : {}),
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
      });
      continue;
    }

    if (message.kind === "reasoning") {
      if (!normalizeMessageText(message.text)) continue;
      items.push({ kind: "reasoning", text: message.text });
      continue;
    }

    if (message.kind === "tool_call") {
      items.push({
        kind: "tool_call",
        callId: message.callId,
        name: message.name,
        args: message.args,
      });
      continue;
    }

    if (message.kind === "tool_result") {
      const content = message.content || "";
      if (!normalizeMessageText(content) && !message.attachments?.length) {
        continue;
      }
      items.push({
        kind: "tool_result",
        callId: message.callId,
        name: message.name,
        content,
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
      });
    }
  }

  return items;
}

export function useDashboardChatTransport({
  activeTurnRef,
  contextFolder,
  connectionMode,
  enabled,
  fallbackOnUnavailable,
  hermesSessionId,
  messages,
  model,
  modelBaseUrl,
  profile,
  provider,
  setHermesSessionId,
  setIsLoading,
  setMessages,
  setToolProgress,
  setUsage,
  onDashboardUnavailable,
}: UseDashboardChatTransportArgs): UseDashboardChatTransportResult {
  const clientRef = useRef<DashboardGatewayClient | null>(null);
  const connectingRef = useRef<Promise<DashboardGatewayClient> | null>(null);
  const clientGenerationRef = useRef(0);
  // Sticky "dashboard transport can't connect on this remote/SSH connection"
  // flag. The dashboard WebSocket (`/api/ws`) never connects against a tunneled
  // `hermes gateway` (issue #667), so once we've learned it's unavailable we
  // fail `ensureClient` fast on every later message instead of re-running the
  // multi-second status+probe — letting the caller fall back to legacy HTTP
  // immediately. Reset on connection change (see the effect below).
  const dashboardUnavailableRef = useRef(false);
  const runtimeSessionIdRef = useRef<string | null>(null);
  const storedSessionIdRef = useRef<string | null>(hermesSessionId);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const reasoningSegmentClosedRef = useRef(false);
  const appliedModelRef = useRef<string | null>(null);
  const recreateRuntimeSessionRef = useRef(false);
  const lastRuntimeSessionWasCreatedRef = useRef(false);
  const pendingClarifyRequestIdRef = useRef<string | null>(null);
  const pendingRecoveredContinuationRef = useRef<
    DesktopSessionContinuationItem[]
  >([]);
  const lastSyncedCwdRef = useRef<string | null>(null);

  useEffect(() => {
    // `messagesRef` is the synchronous source of truth for `handleGatewayEvent`:
    // it reads the ref, applies a stream delta, writes the ref back, then calls
    // `setMessages`. Every `setMessages` in this hook stores that exact array in
    // the ref, so when React finally commits our own push, `messages` is the
    // very same reference and there is nothing to do. Re-syncing on that commit
    // is what dropped streaming chunks (#757): a second delta could land on an
    // older `messages` snapshot and reset the ref behind the deltas already
    // applied. Skip when the identity matches (our push); adopt any other array,
    // which can only come from Chat state changing underneath us — a new user
    // turn (grows), `handleClear` (`setMessages([])`, shrinks), or a clarify
    // card resolving in place (same length). A length check misses the last two.
    if (messages !== messagesRef.current) {
      messagesRef.current = messages;
    }
  }, [messages]);

  useEffect(() => {
    if (hermesSessionId === storedSessionIdRef.current) return;
    storedSessionIdRef.current = hermesSessionId;
    runtimeSessionIdRef.current = null;
    reasoningSegmentClosedRef.current = false;
    appliedModelRef.current = null;
    recreateRuntimeSessionRef.current = false;
    lastRuntimeSessionWasCreatedRef.current = false;
    pendingClarifyRequestIdRef.current = null;
    lastSyncedCwdRef.current = null;
  }, [hermesSessionId]);

  useEffect(() => {
    appliedModelRef.current = null;
  }, [model, provider]);

  useEffect(() => {
    clientGenerationRef.current += 1;
    dashboardUnavailableRef.current = false;
    clientRef.current?.close();
    clientRef.current = null;
    connectingRef.current = null;
    runtimeSessionIdRef.current = null;
    reasoningSegmentClosedRef.current = false;
    appliedModelRef.current = null;
    recreateRuntimeSessionRef.current = false;
    lastRuntimeSessionWasCreatedRef.current = false;
    pendingClarifyRequestIdRef.current = null;
    pendingRecoveredContinuationRef.current = [];
    lastSyncedCwdRef.current = null;
  }, [connectionMode, profile]);

  const handleGatewayEvent = useCallback(
    (event: DashboardStreamEvent): void => {
      const runtimeSessionId = runtimeSessionIdRef.current;
      if (
        event.session_id &&
        runtimeSessionId &&
        event.session_id !== runtimeSessionId
      ) {
        logDashboardEvent(event, "dropped", runtimeSessionId);
        return;
      }
      logDashboardEvent(event, "accepted", runtimeSessionId);

      // Background (`/btw`) prompts run on a separate agent and report back via
      // `background.complete` — outside the main turn lifecycle, so render the
      // answer as a standalone agent message without touching isLoading or the
      // active turn.
      if (event.type === "background.complete") {
        const p =
          event.payload && typeof event.payload === "object"
            ? (event.payload as { task_id?: string; text?: string })
            : {};
        const label = p.task_id ? `[bg ${p.task_id}] ` : "[bg] ";
        const body = String(p.text ?? "").trim() || "(no output)";
        const appended: ChatMessage[] = [
          ...messagesRef.current,
          {
            id: `bg-${p.task_id || Date.now()}`,
            role: "agent",
            content: `${label}${body}`,
          },
        ];
        messagesRef.current = appended;
        setMessages(appended);
        return;
      }

      const failed =
        event.type === "message.complete" && completionFailed(event.payload);
      const next = applyDashboardStreamEvent(
        {
          messages: messagesRef.current,
          reasoningSegmentClosed: reasoningSegmentClosedRef.current,
        },
        event,
        {
          activeTurn: activeTurnRef.current,
          renderAssistantDeltas: connectionMode === "local",
        },
      );
      reasoningSegmentClosedRef.current = next.reasoningSegmentClosed;
      const nextMessages = failed
        ? markActiveTurnFailed(
            next.messages,
            completionErrorMessage(event.payload),
            activeTurnRef.current,
          )
        : next.messages;
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      if (event.type === "message.complete") {
        if (failed) {
          appliedModelRef.current = null;
          recreateRuntimeSessionRef.current = true;
          const storedSessionId = storedSessionIdRef.current;
          const userContent = userContentById(
            messagesRef.current,
            activeTurnRef.current?.userId,
          );
          const recordLocalError = window.hermesAPI.recordSessionLocalError;
          if (
            dashboardShouldPersistLocalOverlays(connectionMode) &&
            storedSessionId &&
            userContent &&
            typeof recordLocalError === "function"
          ) {
            void recordLocalError(storedSessionId, {
              userContent,
              error: completionErrorMessage(event.payload),
            }).catch(() => undefined);
          }
        }
        const activeTurn = activeTurnRef.current;
        if (activeTurn) activeTurn.status = failed ? "failed" : "completed";
        activeTurnRef.current = null;
        setToolProgress(null);
        setIsLoading(false);
        const usage = usageFromPayload(event.payload);
        if (usage || !failed) {
          // The gauge only renders when `contextTokens` is set, so it must be
          // populated even when the provider omits usage — entirely
          // (usageFromPayload → null) or just the prompt-side counts. Exact
          // payload values win; otherwise fall back to the chars/4 transcript
          // estimate, then to the previous turn's value. A failed turn with no
          // usage doesn't fabricate one — nothing new entered the context.
          const estimatedContextTokens = estimateContextTokens(
            messagesRef.current,
          );
          setUsage((prev) => ({
            promptTokens:
              (prev?.promptTokens || 0) + (usage?.promptTokens || 0),
            completionTokens:
              (prev?.completionTokens || 0) + (usage?.completionTokens || 0),
            totalTokens: (prev?.totalTokens || 0) + (usage?.totalTokens || 0),
            cost: prev?.cost,
            contextTokens:
              usage?.contextTokens ||
              estimatedContextTokens ||
              prev?.contextTokens,
            contextWindowTokens:
              usage?.contextWindowTokens || prev?.contextWindowTokens,
            cacheReadTokens: prev?.cacheReadTokens,
            cacheWriteTokens: prev?.cacheWriteTokens,
          }));
        }
      }

      if (event.type === "clarify.request") {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as { request_id?: unknown })
            : {};
        const requestId =
          typeof payload.request_id === "string" ? payload.request_id : "";
        if (requestId) {
          pendingClarifyRequestIdRef.current = requestId;
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
        }
      }
    },
    [
      activeTurnRef,
      connectionMode,
      setIsLoading,
      setMessages,
      setToolProgress,
      setUsage,
    ],
  );

  const ensureClient =
    useCallback(async (): Promise<DashboardGatewayClient> => {
      const existing = clientRef.current;
      if (existing?.connected) return existing;
      // Already known unavailable on this remote/SSH connection — fail fast so the
      // caller falls back to legacy without re-running the slow status+probe.
      if (dashboardUnavailableRef.current) {
        throw new Error("Hermes dashboard transport is unavailable");
      }
      if (connectingRef.current) return connectingRef.current;

      const generation = clientGenerationRef.current;
      const pending = (async () => {
        // The dashboard `/api/ws` is the ONLY chat transport when a dashboard is
        // available (matching apps/desktop, which has no /v1 chat path). A WS
        // drop / "socket hang up" — e.g. a momentary SSH tunnel blip — is
        // TRANSIENT and must reconnect, NOT fall back to the main-process /v1
        // path: over the dashboard tunnel /v1 doesn't exist and 405s. So retry
        // the connect (re-running startDashboard each attempt to re-establish the
        // tunnel). Only a genuinely-absent dashboard (running=false) latches the
        // negative flag and lets the caller drop to legacy gateway /v1.
        let lastConnectErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const status = await window.hermesAPI.startDashboard(profile);
          if (clientGenerationRef.current !== generation) {
            throw new Error("Hermes dashboard connection was superseded");
          }
          if (!status.running || !status.connection) {
            if (status.needsOAuthLogin) {
              const error = new Error(
                status.error || "Remote gateway sign-in is required",
              ) as Error & { dashboardWasReachable?: boolean };
              error.dashboardWasReachable = true;
              throw error;
            }
            // No dashboard on this remote (gateway-only install). Latch + notify
            // only in auto mode where we actually fall back to legacy.
            if (
              connectionMode !== "local" &&
              fallbackOnUnavailable &&
              !dashboardUnavailableRef.current
            ) {
              dashboardUnavailableRef.current = true;
              onDashboardUnavailable?.(
                status.error || "Hermes dashboard transport is unavailable",
              );
            }
            throw new Error(
              status.error || "Hermes dashboard transport is unavailable",
            );
          }
          const client: DashboardGatewayClient = new DashboardGatewayClient({
            onEvent: handleGatewayEvent,
            onClose: () => {
              if (clientRef.current === client) {
                clientRef.current = null;
              }
            },
          });
          try {
            const freshUrl = window.hermesAPI.freshDashboardWsUrl
              ? await window.hermesAPI.freshDashboardWsUrl(profile)
              : status.connection.wsUrl;
            if (!freshUrl) {
              throw new Error("Hermes dashboard WebSocket URL is unavailable");
            }
            await client.connect(freshUrl);
          } catch (err) {
            lastConnectErr = err;
            client.close();
            if (clientGenerationRef.current !== generation) {
              throw new Error("Hermes dashboard connection was superseded");
            }
            // Transient connect failure while the dashboard IS up — back off and
            // retry (the tunnel may be re-establishing).
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          if (clientGenerationRef.current !== generation) {
            client.close();
            throw new Error("Hermes dashboard connection was superseded");
          }
          clientRef.current = client;
          return client;
        }
        // Dashboard was up but the WS wouldn't stay connected. Tag the error so
        // the caller fails the turn (and lets the user retry) instead of POSTing
        // /v1 to the dashboard tunnel (which 405s).
        const err = new Error(
          lastConnectErr instanceof Error
            ? `Hermes dashboard chat connection failed: ${lastConnectErr.message}`
            : "Hermes dashboard chat connection failed",
        ) as Error & { dashboardWasReachable?: boolean };
        err.dashboardWasReachable = true;
        throw err;
      })();
      connectingRef.current = pending;

      try {
        return await pending;
      } finally {
        if (connectingRef.current === pending) {
          connectingRef.current = null;
        }
      }
    }, [
      handleGatewayEvent,
      profile,
      connectionMode,
      fallbackOnUnavailable,
      onDashboardUnavailable,
    ]);

  const ensureRuntimeSession = useCallback(
    async (
      client: DashboardGatewayClient,
      options: {
        excludeSeedUserId?: string | null;
        forceCreate?: boolean;
      } = {},
    ): Promise<string> => {
      let targetSessionId = runtimeSessionIdRef.current;
      let justCreated = false;

      if (!targetSessionId) {
        const stored = storedSessionIdRef.current;
        const excludeSeedUserId =
          options.excludeSeedUserId ?? activeTurnRef.current?.userId ?? null;
        const response = await ensureDashboardRuntimeSession({
          client,
          contextFolder,
          excludeSeedUserId,
          forceCreate: options.forceCreate ?? false,
          messages: messagesRef.current,
          profile,
          storedSessionId: stored,
        });

        if (stored && response.created) {
          pendingRecoveredContinuationRef.current =
            dashboardContinuationItemsFromTranscript(messagesRef.current, {
              excludeUserId: excludeSeedUserId,
            });
        }

        targetSessionId = response.runtimeSessionId;
        runtimeSessionIdRef.current = targetSessionId;
        lastRuntimeSessionWasCreatedRef.current = response.created;
        justCreated = response.created;
        if (justCreated && contextFolder) {
          lastSyncedCwdRef.current = contextFolder;
        }
        const storedId = response.storedSessionId;
        storedSessionIdRef.current = storedId;
        recreateRuntimeSessionRef.current = false;
        setHermesSessionId(storedId);
      }

      if (
        contextFolder &&
        targetSessionId &&
        lastSyncedCwdRef.current !== contextFolder
      ) {
        lastSyncedCwdRef.current = contextFolder;
        await client
          .request("session.cwd.set", {
            session_id: targetSessionId,
            cwd: contextFolder,
          })
          .catch((err) => {
            lastSyncedCwdRef.current = null;
            console.warn("Failed to sync dashboard CWD:", err);
          });
      }

      return targetSessionId;
    },
    [activeTurnRef, contextFolder, profile, setHermesSessionId],
  );

  const ensureSelectedModel = useCallback(
    async (
      client: DashboardGatewayClient,
      sessionId: string,
    ): Promise<string> => {
      const command = dashboardModelCommand(provider, model);
      if (!command) return sessionId;
      const resetRuntimeSession = async (
        targetSessionId: string,
      ): Promise<string> => {
        const storedSessionId = storedSessionIdRef.current;
        await client
          .request("session.close", { session_id: targetSessionId })
          .catch(() => undefined);
        runtimeSessionIdRef.current = null;
        storedSessionIdRef.current = storedSessionId;
        reasoningSegmentClosedRef.current = false;
        appliedModelRef.current = null;
        return ensureRuntimeSession(client);
      };

      const switchAndValidate = async (
        targetSessionId: string,
      ): Promise<string> => {
        let before = await client.request<ModelOptionsResponse>(
          "model.options",
          {
            session_id: targetSessionId,
          },
        );
        let dashboardProvider = resolveDashboardProviderForModel(
          provider,
          model,
          modelBaseUrl,
          before,
        );

        if (
          storedSessionIdRef.current &&
          !dashboardModelMatches(dashboardProvider, model, before) &&
          (provider === "custom" ||
            (before.provider || "").toLowerCase().startsWith("custom"))
        ) {
          targetSessionId = await resetRuntimeSession(targetSessionId);
          before = await client.request<ModelOptionsResponse>("model.options", {
            session_id: targetSessionId,
          });
          dashboardProvider = resolveDashboardProviderForModel(
            provider,
            model,
            modelBaseUrl,
            before,
          );
          if (dashboardModelMatches(dashboardProvider, model, before)) {
            appliedModelRef.current = `${targetSessionId}\n${dashboardProvider}\n${model}`;
            return targetSessionId;
          }
        }

        if (
          provider === "custom" &&
          dashboardProvider === "custom" &&
          storedSessionIdRef.current
        ) {
          targetSessionId = await resetRuntimeSession(targetSessionId);

          const rebuilt = await client.request<ModelOptionsResponse>(
            "model.options",
            {
              session_id: targetSessionId,
            },
          );
          if (dashboardModelMatches("custom", model, rebuilt)) {
            appliedModelRef.current = `${targetSessionId}\ncustom\n${model}`;
            return targetSessionId;
          }
        }

        const resolvedCommand = dashboardModelCommand(dashboardProvider, model);
        if (!resolvedCommand) return targetSessionId;
        const key = `${targetSessionId}\n${dashboardProvider}\n${model}`;
        let slashResponse: SlashExecResponse | null = null;
        if (appliedModelRef.current !== key) {
          slashResponse = await client.request<SlashExecResponse>(
            "slash.exec",
            {
              session_id: targetSessionId,
              command: resolvedCommand,
            },
          );
        }

        const live = await client.request<ModelOptionsResponse>(
          "model.options",
          {
            session_id: targetSessionId,
          },
        );
        if (!dashboardModelMatches(dashboardProvider, model, live)) {
          appliedModelRef.current = null;
          const warning = slashResponse?.warning
            ? `; /model warning: ${slashResponse.warning}`
            : "";
          const output = slashResponse?.output
            ? `; /model output: ${slashResponse.output}`
            : "";
          throw new Error(
            `Hermes dashboard did not switch to ${dashboardProvider}/${model}; live model is ${live.provider || "unknown"}/${live.model || "unknown"}${warning}${output}; custom inventory: ${modelOptionsSummary(before)}`,
          );
        }
        appliedModelRef.current = key;
        return targetSessionId;
      };

      try {
        return await switchAndValidate(sessionId);
      } catch (err) {
        if (!isDashboardSlashWorkerExitError(err)) throw err;
        appliedModelRef.current = null;
        const freshSessionId = await resetRuntimeSession(sessionId);
        return switchAndValidate(freshSessionId);
      }
    },
    [ensureRuntimeSession, model, modelBaseUrl, provider],
  );

  const syncDashboardAttachments = useCallback(
    async (
      client: DashboardGatewayClient,
      sessionId: string,
      attachments?: Attachment[],
    ): Promise<{ handled: boolean; refs: string[] }> => {
      return syncDashboardAttachmentsForSubmit(client, sessionId, attachments);
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<boolean> => {
      if (!enabled) return false;
      const pendingClarifyRequestId = pendingClarifyRequestIdRef.current;
      if (pendingClarifyRequestId) {
        pendingClarifyRequestIdRef.current = null;
        try {
          const client = await ensureClient();
          await client.request("clarify.respond", {
            request_id: pendingClarifyRequestId,
            answer: text,
          });
          return true;
        } catch (err) {
          pendingClarifyRequestIdRef.current = pendingClarifyRequestId;
          const message = err instanceof Error ? err.message : String(err);
          const activeTurn = activeTurnRef.current;
          if (activeTurn) activeTurn.status = "failed";
          setMessages((prev) => {
            const failedMessages = markActiveTurnFailed(
              prev,
              message,
              activeTurn,
            );
            messagesRef.current = failedMessages;
            return failedMessages;
          });
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
          return true;
        }
      }
      const dashboardText = dashboardPromptTextForAttachments(
        text,
        attachments,
      );
      const mergePendingRecoveredContinuation = (
        existing: DesktopSessionContinuationItem[],
      ): DesktopSessionContinuationItem[] => {
        if (pendingRecoveredContinuationRef.current.length === 0) {
          return existing;
        }
        const pending = pendingRecoveredContinuationRef.current;
        pendingRecoveredContinuationRef.current = [];
        return existing.length > 0 ? existing : pending;
      };
      const recordContinuationItems = async (
        items: DesktopSessionContinuationItem[],
      ): Promise<void> => {
        const storedSessionId = storedSessionIdRef.current;
        const recordContinuation = window.hermesAPI.recordSessionContinuation;
        if (
          dashboardShouldPersistLocalOverlays(connectionMode) &&
          storedSessionId &&
          items.length > 0 &&
          typeof recordContinuation === "function"
        ) {
          await recordContinuation(storedSessionId, items).catch(
            () => undefined,
          );
        }
      };
      const failActiveTurn = (message: string): true => {
        const activeTurn = activeTurnRef.current;
        if (activeTurn) activeTurn.status = "failed";
        let failedMessages: ChatMessage[] | null = null;
        setMessages((prev) => {
          failedMessages = markActiveTurnFailed(prev, message, activeTurn);
          messagesRef.current = failedMessages;
          return failedMessages;
        });
        const storedSessionId = storedSessionIdRef.current;
        const userContent = userContentById(
          failedMessages ?? messagesRef.current,
          activeTurn?.userId,
        );
        const recordLocalError = window.hermesAPI.recordSessionLocalError;
        if (
          dashboardShouldPersistLocalOverlays(connectionMode) &&
          storedSessionId &&
          userContent &&
          typeof recordLocalError === "function"
        ) {
          void recordLocalError(storedSessionId, {
            userContent,
            error: message,
          }).catch(() => undefined);
        }
        activeTurnRef.current = null;
        setToolProgress(null);
        setIsLoading(false);
        return true;
      };
      if (dashboardText === null) {
        if (fallbackOnUnavailable) return false;
        return failActiveTurn(
          "Dashboard chat supports image attachments only in this build. Use Auto or Legacy for mixed file attachments.",
        );
      }

      let client: DashboardGatewayClient;
      try {
        client = await ensureClient();
      } catch (err) {
        // Dashboard was reachable but the chat WS wouldn't connect: do NOT fall
        // back to the /v1 path — over the dashboard tunnel /v1 doesn't exist and
        // 405s. Surface the error so the user retries on the same transport.
        if (
          (err as { dashboardWasReachable?: boolean })?.dashboardWasReachable
        ) {
          const message = err instanceof Error ? err.message : String(err);
          return failActiveTurn(message);
        }
        if (fallbackOnUnavailable) {
          console.warn("Falling back to legacy chat transport.", err);
          return false;
        }
        const message = err instanceof Error ? err.message : String(err);
        return failActiveTurn(message);
      }

      try {
        let continuationItems: DesktopSessionContinuationItem[] = [];
        const forceCreateRuntime = recreateRuntimeSessionRef.current;
        if (recreateRuntimeSessionRef.current) {
          continuationItems = dashboardContinuationItemsFromTranscript(
            messagesRef.current,
            { excludeUserId: activeTurnRef.current?.userId ?? null },
          );
          const staleRuntimeSessionId = runtimeSessionIdRef.current;
          if (staleRuntimeSessionId) {
            await client
              .request("session.close", { session_id: staleRuntimeSessionId })
              .catch(() => undefined);
          }
          runtimeSessionIdRef.current = null;
          reasoningSegmentClosedRef.current = false;
          appliedModelRef.current = null;
        }
        const runtimeSessionId = await ensureRuntimeSession(client, {
          forceCreate: forceCreateRuntime,
        });
        if (
          lastRuntimeSessionWasCreatedRef.current ||
          pendingRecoveredContinuationRef.current.length > 0
        ) {
          continuationItems =
            mergePendingRecoveredContinuation(continuationItems);
        } else {
          continuationItems = [];
        }
        await recordContinuationItems(continuationItems);
        const selectedSessionId = await ensureSelectedModel(
          client,
          runtimeSessionId,
        );
        await recordContinuationItems(mergePendingRecoveredContinuation([]));
        const syncedAttachments = await syncDashboardAttachments(
          client,
          selectedSessionId,
          attachments,
        );
        if (!syncedAttachments.handled) {
          if (fallbackOnUnavailable) return false;
          return failActiveTurn(
            "Hermes dashboard could not attach the selected file. Use Auto or Legacy to fall back to the legacy attachment path.",
          );
        }
        const submitText = dashboardPromptTextWithAttachmentRefs(
          dashboardText,
          syncedAttachments.refs,
        );
        await submitDashboardPromptWithRecovery(client, {
          sessionId: selectedSessionId,
          storedSessionId: storedSessionIdRef.current,
          text: submitText,
          profile,
          onRecoveredSessionId: (recoveredSessionId) => {
            runtimeSessionIdRef.current = recoveredSessionId;
          },
        });
        return true;
      } catch (err) {
        appliedModelRef.current = null;
        recreateRuntimeSessionRef.current = true;
        const message = err instanceof Error ? err.message : String(err);
        return failActiveTurn(message);
      }
    },
    [
      activeTurnRef,
      connectionMode,
      enabled,
      fallbackOnUnavailable,
      ensureClient,
      ensureRuntimeSession,
      ensureSelectedModel,
      syncDashboardAttachments,
      setIsLoading,
      setMessages,
      setToolProgress,
      profile,
    ],
  );

  const execSlash = useCallback(
    async (
      command: string,
      sys: (text: string) => void,
    ): Promise<SlashExecOutcome> => {
      if (!enabled) {
        return { kind: "error", message: "dashboard transport disabled" };
      }
      try {
        const client = await ensureClient();
        const runtimeSessionId = await ensureRuntimeSession(client);
        const sessionId = await ensureSelectedModel(client, runtimeSessionId);
        return await executeSlash({
          command,
          sessionId,
          request: (method, params) => client.request(method, params),
          sys,
        });
      } catch (err) {
        return {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [enabled, ensureClient, ensureRuntimeSession, ensureSelectedModel],
  );

  const getCommandCatalog =
    useCallback(async (): Promise<AgentCommandsCatalogResponse> => {
      if (!enabled) {
        throw new Error("dashboard transport disabled");
      }
      const client = await ensureClient();
      return client.request<AgentCommandsCatalogResponse>(
        "commands.catalog",
        {},
      );
    }, [enabled, ensureClient]);

  const runBackground = useCallback(
    async (text: string): Promise<{ taskId?: string; error?: string }> => {
      if (!enabled) return { error: "dashboard transport disabled" };
      try {
        const client = await ensureClient();
        const runtimeSessionId = await ensureRuntimeSession(client);
        const sessionId = await ensureSelectedModel(client, runtimeSessionId);
        const r = await client.request<{ task_id?: string }>(
          "prompt.background",
          {
            session_id: sessionId,
            text,
            ...(profile && profile !== "default" ? { profile } : {}),
          },
        );
        return { taskId: r?.task_id };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [enabled, ensureClient, ensureRuntimeSession, ensureSelectedModel, profile],
  );

  const abort = useCallback(() => {
    const client = clientRef.current;
    const sessionId = runtimeSessionIdRef.current;
    if (!enabled || !client || !sessionId) return;
    void client
      .request("session.interrupt", { session_id: sessionId })
      .catch(() => {
        client.close();
      });
  }, [enabled]);

  useEffect(
    () => () => {
      clientRef.current?.close();
      clientRef.current = null;
    },
    [],
  );

  return {
    abort,
    enabled,
    sendMessage,
    execSlash,
    getCommandCatalog,
    runBackground,
  };
}
