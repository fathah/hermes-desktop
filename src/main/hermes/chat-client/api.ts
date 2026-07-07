import { randomUUID } from "crypto";
import http from "node:http";
import type { ClientRequest } from "node:http";
import https from "node:https";
import {
  getApiServerKey,
  getConnectionConfig,
  getModelConfig,
  readEnv,
} from "../../config";
import { CredentialPoolManager } from "../../config/credential-pool-manager";
import { buildActiveSkillsSystemMessage } from "../../active-skills";
import { redactSensitiveData } from "../../security";
import { ShellHookManager } from "../../security/shell-hooks";
import { gatewayFetch } from "../../security/network-policy";
import {
  processCustomEvent as parseCustomEvent,
  processSseData,
  type SseCallbacks,
} from "../../sse-parser";
import { type Attachment } from "../../../shared/attachments";
import { ContextCompressor } from "../context-compressor";
import { ErrorDoctor } from "../error-doctor";
import {
  getApiUrl,
  getChatTransportCacheGeneration,
  getRemoteAuthHeader,
  isRemoteMode,
} from "../gateway-process";
import {
  buildUserContent,
  contextFolderSystemMessage,
  type ChatCallbacks,
  type ChatContent,
  type ChatHandle,
} from "./messages";
import {
  REQUEST_TIMEOUT_MS,
  STREAM_NO_CONTENT_DEADLINE_MS,
  requestTimeoutForAttempt,
  retryDelayWithinDeadline,
} from "./deadline";
import { formatLogError, log } from "../../log";

function isLocalGatewayRequestTimeout(
  errorText: string,
  statusCode?: number,
): boolean {
  return (
    !isRemoteMode() &&
    statusCode === 408 &&
    /^API request timed out\. The local Hermes gateway may be unresponsive/i.test(
      errorText,
    )
  );
}

export type HermesChatTransport =
  | "v1ChatCompletions"
  | "apiChatCompletions"
  | "sessionChatStream"
  | "unsupported";

export const CHAT_REQUEST_ABORTED_MESSAGE = "Chat request aborted.";

const CHAT_TRANSPORT_CACHE_TTL_MS = 30_000;
const CHAT_TRANSPORT_PROBE_TIMEOUT_MS = 750;

const chatTransportCache = new Map<
  string,
  { transport: HermesChatTransport; expiresAt: number }
>();

export function clearHermesChatTransportCache(): void {
  chatTransportCache.clear();
}

function chatTransportCacheKey(baseUrl: string, mode: string): string {
  return `${mode}:${getChatTransportCacheGeneration()}:${baseUrl}`;
}

function cacheChatTransport(
  baseUrl: string,
  mode: string,
  transport: HermesChatTransport,
): HermesChatTransport {
  if (transport !== "unsupported") {
    chatTransportCache.set(chatTransportCacheKey(baseUrl, mode), {
      transport,
      expiresAt: Date.now() + CHAT_TRANSPORT_CACHE_TTL_MS,
    });
  }
  return transport;
}

function authProbeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const auth = headers.Authorization;
  return auth ? { Authorization: auth } : {};
}

export async function fetchJsonProbe(
  url: string,
  headers: Record<string, string>,
  timeoutMs = CHAT_TRANSPORT_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; data: unknown } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await gatewayFetch(url, {
      method: "GET",
      headers: authProbeHeaders(headers),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      data,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function openApiPaths(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const paths = (data as { paths?: unknown }).paths;
  if (!paths || typeof paths !== "object") return null;
  return paths as Record<string, unknown>;
}

function selectTransportFromPaths(
  paths: Record<string, unknown>,
  excluded: Set<HermesChatTransport>,
): HermesChatTransport | null {
  const keys = Object.keys(paths);
  const has = (path: string): boolean => keys.includes(path);
  const hasSessionStream = keys.some((path) =>
    /^\/api\/sessions\/\{[^/]+\}\/chat\/stream$/.test(path),
  );

  if (has("/v1/chat/completions") && !excluded.has("v1ChatCompletions")) {
    return "v1ChatCompletions";
  }
  if (has("/api/chat/completions") && !excluded.has("apiChatCompletions")) {
    return "apiChatCompletions";
  }
  if (
    hasSessionStream &&
    has("/api/sessions") &&
    !excluded.has("sessionChatStream")
  ) {
    return "sessionChatStream";
  }
  return null;
}

function jsonMentions(data: unknown, needle: string): boolean {
  try {
    return JSON.stringify(data).includes(needle);
  } catch {
    return false;
  }
}

function selectTransportFromCapabilities(
  data: unknown,
  excluded: Set<HermesChatTransport>,
): HermesChatTransport | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (
    !excluded.has("v1ChatCompletions") &&
    (jsonMentions(data, "/v1/chat/completions") ||
      value.chat_completions === true)
  ) {
    return "v1ChatCompletions";
  }
  if (
    !excluded.has("apiChatCompletions") &&
    jsonMentions(data, "/api/chat/completions")
  ) {
    return "apiChatCompletions";
  }
  if (
    !excluded.has("sessionChatStream") &&
    (jsonMentions(data, "/api/sessions/{session_id}/chat/stream") ||
      value.session_chat_streaming === true)
  ) {
    return "sessionChatStream";
  }
  return null;
}

async function resolveHermesChatTransport(
  baseUrl: string,
  headers: Record<string, string>,
  options: {
    exclude?: HermesChatTransport[];
    bypassCache?: boolean;
  } = {},
): Promise<HermesChatTransport> {
  if (!isRemoteMode()) return "v1ChatCompletions";

  const mode = getConnectionConfig().mode;
  const excluded = new Set(options.exclude || []);
  const cacheKey = chatTransportCacheKey(baseUrl, mode);
  const cached = chatTransportCache.get(cacheKey);
  if (
    !options.bypassCache &&
    excluded.size === 0 &&
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.transport;
  }

  let sawAuthoritativeSurface = false;
  const openApi = await fetchJsonProbe(`${baseUrl}/openapi.json`, headers);
  if (openApi?.ok) {
    sawAuthoritativeSurface = true;
    const paths = openApiPaths(openApi.data);
    const transport = paths ? selectTransportFromPaths(paths, excluded) : null;
    if (transport) return cacheChatTransport(baseUrl, mode, transport);
  }

  const capabilities = await fetchJsonProbe(
    `${baseUrl}/v1/capabilities`,
    headers,
  );
  if (capabilities?.ok) {
    sawAuthoritativeSurface = true;
    const transport = selectTransportFromCapabilities(
      capabilities.data,
      excluded,
    );
    if (transport) return cacheChatTransport(baseUrl, mode, transport);
  }

  if (excluded.has("v1ChatCompletions")) {
    return "apiChatCompletions";
  }

  return sawAuthoritativeSurface
    ? "unsupported"
    : cacheChatTransport(baseUrl, mode, "v1ChatCompletions");
}

function unsupportedRemoteChatMessage(): string {
  return (
    "Connected Hermes backend does not expose a compatible chat API. " +
    "Connect Remote/SSH to the Hermes proxy/API-server port, not the v0.17 serve/dashboard port."
  );
}

function chatCompletionPath(transport: HermesChatTransport): string {
  return transport === "apiChatCompletions"
    ? "/api/chat/completions"
    : "/v1/chat/completions";
}

function chatContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      const imageUrl = (part as { image_url?: { url?: unknown } })?.image_url
        ?.url;
      if (typeof imageUrl === "string") return `[Image: ${imageUrl}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function parseEventStreamBlock(block: string): {
  eventType: string;
  data: string;
} {
  let eventType = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    }
  }
  return { eventType, data: dataLines.join("\n") };
}

function parseJsonObject(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(body);
    const bodyBuf = Buffer.from(rawBody, "utf-8");
    const requester = url.startsWith("https") ? https : http;
    const req = requester.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": String(bodyBuf.length),
        },
        signal,
        timeout: timeoutMs,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Gateway returned ${res.statusCode}`));
            return;
          }
          resolve(parseJsonObject(raw));
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(bodyBuf);
    req.end();
  });
}

export function respondRunApproval(
  runId: string,
  choice: "once" | "session" | "always" | "deny",
  profile?: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ choice });
    const bodyBuf = Buffer.from(body, "utf-8");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(bodyBuf.length),
      ...getRemoteAuthHeader(),
    };
    if (!isRemoteMode()) {
      const apiServerKey = getApiServerKey(profile);
      if (apiServerKey) headers.Authorization = `Bearer ${apiServerKey}`;
    }
    const url = `${getApiUrl(profile)}/v1/runs/${encodeURIComponent(runId)}/approval`;
    const requester = url.startsWith("https") ? https.request : http.request;
    const req = requester(
      url,
      { method: "POST", headers, timeout: 30000 },
      (res) => {
        res.on("data", () => {});
        res.on("end", () =>
          resolve({
            ok: (res.statusCode ?? 500) < 400,
            error:
              (res.statusCode ?? 500) >= 400
                ? `Gateway returned ${res.statusCode}`
                : undefined,
          }),
        );
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Request timed out" });
    });
    req.write(bodyBuf);
    req.end();
  });
}

export function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  _resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  attachments?: Attachment[],
  contextFolder?: string,
  groundingSystem?: { role: "system"; content: string } | null,
  selfAwarenessSystem?: { role: "system"; content: string } | null,
  modelOverride?: { model?: string; provider?: string; baseUrl?: string },
): ChatHandle {
  const mc = getModelConfig(profile);
  const effectiveModel = modelOverride?.model || mc.model;
  const controller = new AbortController();
  let activeRequest: ClientRequest | null = null;
  let finished = false;
  let hasContent = false;
  let lastError = "";
  let sessionId = _resumeSessionId || "";
  let triedV1MethodFallback = false;
  const noContentDeadlineAt = Date.now() + STREAM_NO_CONTENT_DEADLINE_MS;

  function finish(error?: string): void {
    if (finished) return;
    finished = true;
    if (error) {
      cb.onError(error);
    } else {
      cb.onDone(sessionId || undefined);
    }
  }

  const messages: Array<{ role: string; content: ChatContent }> = [];
  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push({
        role: msg.role === "agent" ? "assistant" : msg.role,
        content: msg.content,
      });
    }
  }
  const userContent = buildUserContent(message, attachments);
  messages.push({ role: "user", content: userContent });

  const ctxSystem = contextFolderSystemMessage(contextFolder);
  if (ctxSystem) messages.unshift(ctxSystem);

  if (groundingSystem) messages.unshift(groundingSystem);

  if (selfAwarenessSystem) messages.unshift(selfAwarenessSystem);

  const activeSkillsSystem = buildActiveSkillsSystemMessage(profile);
  if (activeSkillsSystem) messages.unshift(activeSkillsSystem);

  async function executeRequest(
    retryBudget: number,
    customBudgetChars?: number,
    forcedTransport?: HermesChatTransport,
  ): Promise<void> {
    if (finished || controller.signal.aborted) return;

    // 1. Gating / Context Injection Hook (The Security Guard)
    try {
      const hookRes = await ShellHookManager.runHook(
        "pre_llm_call",
        {
          message,
          profile,
          model: effectiveModel || "hermes-agent",
        },
        profile,
      );

      if (hookRes.action === "block") {
        finished = true;
        cb.onError(hookRes.message || "Execution blocked by shell hook.");
        return;
      }

      if (hookRes.context) {
        messages.unshift({
          role: "system",
          content: hookRes.context,
        });
      }
    } catch (err) {
      log.warn("hermes", {
        msg: "pre-LLM hook failed",
        error: formatLogError(err),
      });
    }

    // 2. Smart Memory Shrinking (Context Compressor)
    const compressor = new ContextCompressor({
      budgetChars: customBudgetChars,
    });
    const compressedMessages = compressor.compress(messages);

    // Dynamic headers compilation for credential pool rotation read-back
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...getRemoteAuthHeader(),
    };

    if (!isRemoteMode()) {
      const apiServerKey = getApiServerKey(profile);
      if (apiServerKey) {
        baseHeaders.Authorization = `Bearer ${apiServerKey}`;
      }
    }

    // Direct auth injection for remote endpoints during rotative fallback
    if (isRemoteMode()) {
      const provider = mc.provider || "openai";
      const envKey = CredentialPoolManager.getEnvKeyForProvider(provider);
      const activeKey = readEnv(profile)[envKey] || process.env[envKey] || "";
      if (activeKey) {
        baseHeaders.Authorization = `Bearer ${activeKey}`;
      }
    }

    const baseUrl = getApiUrl(profile);
    const selectedTransport =
      forcedTransport ||
      (await resolveHermesChatTransport(baseUrl, baseHeaders));
    let headers: Record<string, string> = {};
    let chatUrl = "";

    if (finished || controller.signal.aborted) return;

    if (selectedTransport === "unsupported") {
      finish(unsupportedRemoteChatMessage());
      return;
    }

    if (selectedTransport === "sessionChatStream") {
      await executeSessionChatStream();
      return;
    }

    const hasAuth = "Authorization" in baseHeaders;
    if (!sessionId && hasAuth) {
      sessionId = `desk-${Date.now()}-${randomUUID()}`;
    }

    const body = JSON.stringify({
      model: effectiveModel || "hermes-agent",
      messages: compressedMessages,
      stream: true,
      ...(_resumeSessionId ? { session_id: _resumeSessionId } : {}),
    });

    const bodyBuf = Buffer.from(body, "utf-8");
    headers = {
      ...baseHeaders,
      "Content-Length": String(bodyBuf.length),
    };
    if (sessionId) {
      headers["X-Hermes-Session-Id"] = sessionId;
    }
    chatUrl = `${baseUrl}${chatCompletionPath(selectedTransport)}`;

    async function executeSessionChatStream(): Promise<void> {
      const requestTimeoutMs = hasContent
        ? REQUEST_TIMEOUT_MS
        : requestTimeoutForAttempt(noContentDeadlineAt);
      if (!hasContent && requestTimeoutMs <= 0) {
        finish(
          "No response received from the model before the retry deadline.",
        );
        return;
      }

      try {
        let streamSessionId = _resumeSessionId || "";
        if (!streamSessionId) {
          const created = await postJson(
            `${baseUrl}/api/sessions`,
            baseHeaders,
            {},
            controller.signal,
            requestTimeoutMs,
          );
          const createdId =
            created.session_id || created.sessionId || created.id;
          if (typeof createdId !== "string" || !createdId) {
            finish("Hermes session API did not return a session id.");
            return;
          }
          streamSessionId = createdId;
        }
        sessionId = streamSessionId;

        const systemMessage = compressedMessages
          .filter((msg) => msg.role === "system")
          .map((msg) => chatContentToText(msg.content))
          .filter(Boolean)
          .join("\n\n");
        const streamBody = JSON.stringify({
          message: chatContentToText(userContent),
          ...(systemMessage ? { system_message: systemMessage } : {}),
        });
        const streamBodyBuf = Buffer.from(streamBody, "utf-8");
        const streamHeaders: Record<string, string> = {
          ...baseHeaders,
          "Content-Length": String(streamBodyBuf.length),
          "X-Hermes-Session-Id": streamSessionId,
        };
        const streamUrl = `${baseUrl}/api/sessions/${encodeURIComponent(
          streamSessionId,
        )}/chat/stream`;
        const requester = streamUrl.startsWith("https") ? https : http;

        const req = requester.request(
          streamUrl,
          {
            method: "POST",
            headers: streamHeaders,
            signal: controller.signal,
            timeout: requestTimeoutMs,
          },
          (res) => {
            if ((res.statusCode ?? 200) >= 400) {
              let raw = "";
              res.on("data", (chunk) => {
                raw += chunk.toString();
              });
              res.on("end", () => {
                handleRequestError(
                  raw || `Gateway returned ${res.statusCode}`,
                  res.statusCode,
                );
              });
              return;
            }

            let buffer = "";
            res.on("data", (chunk: Buffer) => {
              buffer += chunk.toString();
              let boundary = buffer.indexOf("\n\n");
              while (boundary !== -1) {
                const block = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 2);
                boundary = buffer.indexOf("\n\n");
                handleSessionBlock(block);
                if (finished) return;
              }
            });
            res.on("end", () => {
              if (finished) return;
              const tail = buffer.trim();
              if (tail) handleSessionBlock(tail);
              if (!finished) {
                if (hasContent) finish();
                else handleRequestError("No response received from model");
              }
            });
            res.on("error", (err) => {
              if (err.message === "aborted" || err.name === "AbortError")
                return;
              handleRequestError(
                `Stream error: ${err.message}`,
                res.statusCode,
              );
            });
          },
        );

        activeRequest = req;
        req.setTimeout(requestTimeoutMs);
        req.on("error", (err) => {
          if (err.name === "AbortError") return;
          handleRequestError(`API request failed: ${err.message}`);
        });
        req.on("timeout", () => {
          req.destroy();
          handleRequestError(
            "API request timed out. Check the remote Hermes gateway and your network connection.",
            408,
          );
        });
        req.write(streamBodyBuf);
        req.end();
      } catch (err) {
        if (controller.signal.aborted) return;
        handleRequestError(err instanceof Error ? err.message : String(err));
      }
    }

    function handleSessionBlock(block: string): void {
      if (finished || !block) return;
      const { eventType, data } = parseEventStreamBlock(block);
      const parsed = parseJsonObject(data);
      if (eventType === "assistant.delta") {
        const delta = parsed.delta || parsed.content;
        if (typeof delta === "string" && delta) {
          hasContent = true;
          cb.onChunk(delta);
        }
        return;
      }
      if (eventType === "error") {
        const message =
          typeof parsed.message === "string"
            ? parsed.message
            : "Hermes session stream returned an error.";
        finish(message);
        return;
      }
      if (eventType === "run.completed") {
        const completedSessionId = parsed.session_id || parsed.sessionId;
        if (typeof completedSessionId === "string" && completedSessionId) {
          sessionId = completedSessionId;
        }
        finish();
        return;
      }
      if (eventType === "done") {
        finish();
      }
    }

    async function retryWithoutV1MethodNotAllowed(): Promise<void> {
      if (
        triedV1MethodFallback ||
        selectedTransport !== "v1ChatCompletions" ||
        !isRemoteMode()
      ) {
        finish(unsupportedRemoteChatMessage());
        return;
      }
      triedV1MethodFallback = true;
      const fallbackTransport = await resolveHermesChatTransport(
        baseUrl,
        baseHeaders,
        {
          exclude: ["v1ChatCompletions"],
          bypassCache: true,
        },
      );
      if (
        fallbackTransport === "unsupported" ||
        fallbackTransport === "v1ChatCompletions"
      ) {
        finish(unsupportedRemoteChatMessage());
        return;
      }
      await executeRequest(retryBudget, customBudgetChars, fallbackTransport);
    }

    function probeRealError(): void {
      const probeTimeoutMs = hasContent
        ? REQUEST_TIMEOUT_MS
        : requestTimeoutForAttempt(noContentDeadlineAt);
      if (!hasContent && probeTimeoutMs <= 0) {
        handleRequestError(
          "No response received from the model before the retry deadline.",
          408,
        );
        return;
      }
      const probeBody = JSON.stringify({
        model: effectiveModel || "hermes-agent",
        messages: [{ role: "user", content: userContent }],
        stream: false,
      });
      const probeBodyBuf = Buffer.from(probeBody, "utf-8");
      const probeHeaders = {
        ...headers,
        "Content-Length": String(probeBodyBuf.length),
      };
      const probeUrl = chatUrl;
      const probeMod = probeUrl.startsWith("https") ? https : http;
      const probeReq = probeMod.request(
        probeUrl,
        { method: "POST", headers: probeHeaders, timeout: probeTimeoutMs },
        (res) => {
          let raw = "";
          res.on("data", (d) => {
            raw += d.toString();
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(raw);
              const content = parsed.choices?.[0]?.message?.content || "";
              const errMsg = parsed.error?.message || "";
              handleRequestError(
                content || errMsg || "No response received from model",
                res.statusCode,
              );
            } catch {
              handleRequestError(
                "No response received from the model. Check configuration.",
                res.statusCode,
              );
            }
          });
        },
      );
      probeReq.on("error", () => {
        handleRequestError(
          "No response received from the model. Check configuration.",
          500,
        );
      });
      probeReq.setTimeout(probeTimeoutMs);
      probeReq.on("timeout", () => {
        probeReq.destroy();
        handleRequestError(
          "No response received from the model (request timed out). Check configuration.",
          408,
        );
      });
      probeReq.write(probeBodyBuf);
      probeReq.end();
    }

    function handleRequestError(errorText: string, statusCode?: number): void {
      if (isLocalGatewayRequestTimeout(errorText, statusCode)) {
        finish(errorText);
        return;
      }

      if (
        statusCode === 405 &&
        selectedTransport === "v1ChatCompletions" &&
        isRemoteMode() &&
        !hasContent
      ) {
        void retryWithoutV1MethodNotAllowed();
        return;
      }

      const classification = ErrorDoctor.classify(errorText, statusCode);
      log.info("hermes", {
        msg: "Error Doctor classification",
        classification,
      });

      if (classification.retryable && retryBudget > 0 && !hasContent) {
        if (requestTimeoutForAttempt(noContentDeadlineAt) <= 0) {
          finish(errorText);
          return;
        }

        if (classification.shouldCompress) {
          log.info("hermes", {
            msg: "memory overflow detected; compacting budget",
          });
          executeRequest(retryBudget - 1, 20000, selectedTransport);
          return;
        }

        if (classification.shouldRotateCredential) {
          const provider = mc.provider || "openai";
          const envKey = CredentialPoolManager.getEnvKeyForProvider(provider);
          const currentKey =
            readEnv(profile)[envKey] || process.env[envKey] || "";

          if (currentKey) {
            CredentialPoolManager.markKeyCooldown(
              provider,
              currentKey,
              classification.cooldownMs || 60000,
              profile,
            );
          }
          const nextKey = CredentialPoolManager.rotateKey(provider, profile);
          if (nextKey) {
            log.info("hermes", {
              msg: "credential rotated successfully; retrying request",
              provider,
              profile,
            });
            executeRequest(
              retryBudget - 1,
              customBudgetChars,
              selectedTransport,
            );
            return;
          }
        }

        const delay = classification.cooldownMs || 2000;
        const boundedDelay = retryDelayWithinDeadline(
          delay,
          noContentDeadlineAt,
        );
        if (boundedDelay == null) {
          finish(errorText);
          return;
        }
        log.info("hermes", {
          msg: "retrying request after delay",
          delayMs: boundedDelay,
          retryBudget,
        });
        setTimeout(() => {
          executeRequest(retryBudget - 1, customBudgetChars, selectedTransport);
        }, boundedDelay);
        return;
      }

      finish(errorText);
    }

    function processCustomEvent(eventType: string, data: string): void {
      parseCustomEvent(eventType, data, cb);
    }

    const requester = chatUrl.startsWith("https") ? https : http;
    const requestTimeoutMs = hasContent
      ? REQUEST_TIMEOUT_MS
      : requestTimeoutForAttempt(noContentDeadlineAt);
    if (!hasContent && requestTimeoutMs <= 0) {
      finish("No response received from the model before the retry deadline.");
      return;
    }

    const sseCb = { ...cb, onDone: undefined };

    function finalize(): void {
      if (finished) return;
      if (lastError) {
        if (hasContent) {
          cb.onChunk(`\n\n⚠️ ${lastError}`);
          finish();
        } else {
          handleRequestError(lastError);
        }
      } else if (hasContent) {
        finish();
      } else {
        probeRealError();
      }
    }

    function handleBlock(block: string): void {
      if (finished || !block) return;
      if (block.startsWith("event: ")) {
        let eventType = "";
        let dataLine = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }
        if (eventType && dataLine) {
          processCustomEvent(eventType, dataLine);
        }
        return;
      }
      if (block.startsWith("data: ")) {
        const data = block.slice(6);
        const state = { hasContent, lastError };
        const sseRes = processSseData(
          data,
          sseCb as unknown as SseCallbacks,
          state,
          {
            redact: redactSensitiveData,
            model: mc.model,
            sessionId: sessionId || _resumeSessionId || undefined,
          },
        );
        hasContent = sseRes.hasContent;
        lastError = state.lastError;
        if (sseRes.done) finalize();
      }
    }

    const req = requester.request(
      chatUrl,
      {
        method: "POST",
        headers,
        signal: controller.signal,
        timeout: requestTimeoutMs,
      },
      (res) => {
        const sid = res.headers["x-hermes-session-id"];
        if (sid && typeof sid === "string") sessionId = sid;

        if (
          res.statusCode === 405 &&
          selectedTransport === "v1ChatCompletions" &&
          isRemoteMode()
        ) {
          res.on("data", () => {});
          res.on("end", () => {
            handleRequestError(
              "Hermes backend rejected /v1/chat/completions.",
              405,
            );
          });
          return;
        }

        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            handleBlock(block);
            if (finished) return;
          }
        });

        res.on("end", () => {
          if (finished) return;
          const tail = buffer.trim();
          if (tail) handleBlock(tail);
          finalize();
        });

        res.on("error", (err) => {
          if (err.message === "aborted" || err.name === "AbortError") return;
          handleRequestError(`Stream error: ${err.message}`, res.statusCode);
        });
      },
    );

    activeRequest = req;

    req.setTimeout(requestTimeoutMs);

    req.on("error", (err) => {
      if (err.name === "AbortError") return;
      handleRequestError(`API request failed: ${err.message}`);
    });

    req.on("timeout", () => {
      req.destroy();
      const mode = getConnectionConfig().mode;
      const where =
        mode === "ssh"
          ? "Check the SSH tunnel and the remote Hermes gateway."
          : mode === "remote"
            ? "Check the remote Hermes gateway and your network connection."
            : "The local Hermes gateway may be unresponsive — check that a model is configured and the gateway is running.";
      handleRequestError(`API request timed out. ${where}`, 408);
    });

    req.write(bodyBuf);
    req.end();
  }

  // Start executing request with 3 retries allowed
  executeRequest(3);

  return {
    abort: () => {
      finish(CHAT_REQUEST_ABORTED_MESSAGE);
      controller.abort();
      if (activeRequest) {
        try {
          activeRequest.destroy();
        } catch {
          // Ignore cleanup failures after the abort signal has already fired.
        }
      }
    },
  };
}
