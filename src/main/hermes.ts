import { ChildProcess, spawn } from "child_process";
import { randomUUID } from "crypto";
import {
  existsSync,
  readFileSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import https from "https";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer";
import {
  getApiServerKey,
  getConnectionConfig,
  getModelConfig,
  readEnv,
} from "./config";
import {
  getSshTunnelUrl,
  isSshTunnelActive,
  isSshTunnelHealthy,
  startSshTunnel,
} from "./ssh-tunnel";
import {
  pidIsAliveAs,
  stripAnsi,
  profileHome,
  profilePaths,
  normalizeProfileName,
  getActiveProfileNameSync,
} from "./utils";
import { getProfilePort } from "./gateway-ports";
import { readModels } from "./models";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { type Attachment, escapeXmlAttr } from "../shared/attachments";
import { URL_KEY_MAP, OPENAI_COMPAT_PROVIDERS } from "../shared/url-key-map";

/**
 * Resolve which profile a gateway call targets. An explicit profile always
 * wins; otherwise we fall back to the file-backed active profile so that
 * callers without a profile argument (health polling, status, app-exit)
 * operate on whatever the desktop is currently showing — not a hardcoded
 * "default". Returns `undefined` for the default profile (matching the
 * profileHome/readEnv/getProfilePort convention).
 */
function resolveProfile(profile?: string): string | undefined {
  return normalizeProfileName(profile ?? getActiveProfileNameSync());
}

/** Map a resolved profile to the key used in the per-profile process maps. */
function profileKey(profile?: string): string {
  return resolveProfile(profile) ?? "default";
}

/**
 * Normalise a remote-mode URL the user typed into the connection
 * settings.  Strips trailing slashes and, importantly, a trailing
 * `/v1` segment — callers append `/v1/<path>` themselves, so leaving
 * the user's `/v1` would produce `http://host/v1/v1/chat/completions`
 * → 404.  Reported as #266 (multiple users entered the URL "with
 * /v1" because the gateway's curl examples show that form).
 *
 * Also tolerates trailing whitespace and the rare `/v1/` (slash-suffixed)
 * form.  Returns the cleaned string.
 */
export function normaliseRemoteUrl(raw: string): string {
  let url = (raw || "").trim();
  // Strip trailing slashes
  url = url.replace(/\/+$/, "");
  // Strip trailing `/v1` (callers append /v1/<path> themselves)
  url = url.replace(/\/v1$/i, "");
  return url;
}

export function getApiUrl(profile?: string): string {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh") {
    const sshUrl = getSshTunnelUrl();
    if (sshUrl) return normaliseRemoteUrl(sshUrl);
    throw new Error("SSH tunnel is not active");
  }
  if (conn.mode === "remote" && conn.remoteUrl) {
    return normaliseRemoteUrl(conn.remoteUrl);
  }
  // Local mode: each profile's gateway binds its own port so they can run
  // concurrently. Address the active (or explicitly requested) profile's
  // gateway rather than a fixed 8642 — that constant would always resolve to
  // whichever gateway grabbed the port first, regardless of active profile.
  return `http://127.0.0.1:${getProfilePort(resolveProfile(profile))}`;
}

export function isRemoteMode(): boolean {
  const mode = getConnectionConfig().mode;
  return mode === "remote" || mode === "ssh";
}

/** True only for pure remote HTTP — SSH tunnel has full local access via SSH exec */
export function isRemoteOnlyMode(): boolean {
  return getConnectionConfig().mode === "remote";
}

// Cached API key read from the remote .env when SSH tunnel starts
let _sshRemoteApiKey = "";

export function setSshRemoteApiKey(key: string): void {
  _sshRemoteApiKey = key;
}

export function getRemoteAuthHeader(): Record<string, string> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh") {
    if (_sshRemoteApiKey)
      return { Authorization: `Bearer ${_sshRemoteApiKey}` };
    return {};
  }
  if (conn.mode === "remote" && conn.apiKey) {
    return { Authorization: `Bearer ${conn.apiKey}` };
  }
  return {};
}

function resolveRemoteApiKey(url: string, apiKey?: string): string {
  if (apiKey !== undefined) return apiKey;

  const conn = getConnectionConfig();
  if (conn.mode !== "remote" || !conn.apiKey || !conn.remoteUrl) return "";
  if (normaliseRemoteUrl(conn.remoteUrl) !== normaliseRemoteUrl(url)) {
    return "";
  }
  return conn.apiKey;
}

export async function ensureSshTunnelIfNeeded(): Promise<void> {
  const conn = getConnectionConfig();
  if (
    conn.mode === "ssh" &&
    (!isSshTunnelActive() || !(await isSshTunnelHealthy()))
  ) {
    await startSshTunnel(conn.ssh);
  }
}

/** Pick a Whisper model name appropriate for the provider's base URL. */
function whisperModelForBaseUrl(baseUrl: string): string {
  if (/api\.groq\.com/i.test(baseUrl)) return "whisper-large-v3-turbo";
  // OpenAI and most OpenAI-compatible gateways accept whisper-1.
  return "whisper-1";
}

/**
 * Transcribe a recorded audio clip to text via the active profile's provider.
 *
 * The local gateway has no audio endpoint, so this goes straight to the
 * profile's OpenAI-compatible provider (`{baseUrl}/audio/transcriptions`) — the
 * same base URL + key the model uses (e.g. Groq Whisper). Used as the desktop's
 * voice-input fallback when the browser SpeechRecognition API is unavailable.
 *
 * Throws with a user-readable message when no transcription-capable endpoint /
 * key is configured, so the caller can surface it.
 */
export async function transcribeAudio(
  audio: Uint8Array,
  mimeType: string,
  profile?: string,
): Promise<string> {
  const resolved = resolveProfile(profile);
  const mc = getModelConfig(resolved);
  const baseUrl = (mc.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(
      "Voice input needs an OpenAI-compatible base URL (e.g. Groq) on the active model. Set one in Models, or type your message.",
    );
  }

  // Resolve the provider key the same way the chat path does: URL-specific key
  // first, then the generic CUSTOM_API_KEY / OPENAI_API_KEY fallbacks.
  const env = readEnv(resolved);
  let apiKey = "";
  for (const { pattern, envKey } of URL_KEY_MAP) {
    if (pattern.test(baseUrl)) {
      apiKey = (env[envKey] || "").trim();
      break;
    }
  }
  if (!apiKey) apiKey = (env.CUSTOM_API_KEY || env.OPENAI_API_KEY || "").trim();

  const form = new FormData();
  form.append(
    "file",
    new Blob([audio as BlobPart], { type: mimeType || "audio/webm" }),
    "speech.webm",
  );
  form.append("model", whisperModelForBaseUrl(baseUrl));

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Transcription failed (${res.status}). ${body.slice(0, 200)}`.trim(),
    );
  }
  const data = (await res.json().catch(() => null)) as { text?: string } | null;
  return (data?.text || "").trim();
}

interface ChatHandle {
  abort: () => void;
}

// ────────────────────────────────────────────────────
//  API Server health check
// ────────────────────────────────────────────────────

function isApiServerReady(profile?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `${getApiUrl(profile)}/health`;
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(
      url,
      { method: "GET", timeout: 1500, headers: getRemoteAuthHeader() },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiServerReady(
  timeoutMs = 8000,
  profile?: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isApiServerReady(profile)) return true;
    await delay(250);
  }
  return false;
}

// ────────────────────────────────────────────────────
//  Ensure API server is enabled in config
// ────────────────────────────────────────────────────

function ensureApiServerConfig(profile?: string): void {
  try {
    const { configFile } = profilePaths(resolveProfile(profile));
    if (!existsSync(configFile)) return;
    const content = readFileSync(configFile, "utf-8");
    // If api_server is already configured, skip — the port is then governed
    // by the existing block (reconciled for collisions by getProfilePort) and
    // by the API_SERVER_PORT env we pass at spawn.
    if (/api_server/i.test(content)) return;
    // Bind this profile's gateway to its own allocated port so profiles can
    // run concurrently without fighting over 8642.
    const port = getProfilePort(profile);
    const addition = `
# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: ${port}
      host: "127.0.0.1"
`;
    appendFileSync(configFile, addition, "utf-8");
  } catch {
    /* non-fatal */
  }
}

// ────────────────────────────────────────────────────
//  HTTP API streaming (fast path — no process spawn)
// ────────────────────────────────────────────────────

/**
 * Pull the streaming reasoning / thinking text from one SSE `delta`
 * object, if present. Two shapes seen in the wild:
 *
 *   - DeepSeek (reasoning models): `delta.reasoning_content`
 *   - OpenAI o1/o3-style streams + some OpenRouter routes:
 *     `delta.reasoning` (older OpenAI thinking-mode docs also use this
 *     field name).
 *
 * Returns `""` (falsy) for any other shape, so the caller can skip
 * forwarding without a null check.
 *
 * Exported so we can unit-test the field-extraction without booting
 * the whole HTTP path. (#352)
 */
export function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const d = delta as Record<string, unknown>;
  if (typeof d.reasoning_content === "string" && d.reasoning_content)
    return d.reasoning_content;
  if (typeof d.reasoning === "string" && d.reasoning) return d.reasoning;
  return "";
}

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  /** Streaming reasoning / thinking tokens, when the provider emits them
   *  alongside `content`. DeepSeek surfaces these as `delta.reasoning_content`;
   *  OpenAI o1/o3-style streams use `delta.reasoning`. Forwarded on a
   *  dedicated channel so the renderer can render the thinking bubble
   *  live instead of waiting for a state-DB refresh on focus change
   *  (issue #352). */
  onReasoningChunk?: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }) => void;
}

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

/**
 * Build the OpenAI-compatible `content` payload for a user turn.
 *
 * - No attachments → plain string (preserves prompt-cache friendliness for
 *   the all-text path).
 * - Text-file attachments → inlined into the text part as `<file …>…</file>`
 *   wrappers (the gateway rejects `file`/`input_file` content parts, see
 *   gateway/platforms/api_server.py:263).
 * - Image attachments → emitted as `image_url` parts in the OpenAI vision
 *   format, which the gateway accepts and converts for Anthropic providers.
 * - Path-ref attachments → appended as `[Attached file: <abs-path>]` lines
 *   so the agent's existing file-reading skills can pick them up.  Works
 *   for PDFs/docx/binaries the gateway won't pass through inline.
 */
export function buildUserContent(
  text: string,
  attachments?: Attachment[],
): ChatContent {
  if (!attachments || attachments.length === 0) return text;

  const textFiles = attachments.filter((a) => a.kind === "text-file");
  const pathRefs = attachments.filter(
    (a) => a.kind === "path-ref" && typeof a.path === "string" && a.path,
  );
  const images = attachments.filter(
    (a) => a.kind === "image" && typeof a.dataUrl === "string" && a.dataUrl,
  );

  const parts: string[] = [];
  if (text.trim()) parts.push(text);
  for (const f of textFiles) {
    if (typeof f.text !== "string") continue;
    const name = escapeXmlAttr(f.name);
    const mime = escapeXmlAttr(f.mime || "text/plain");
    parts.push(`<file name="${name}" mime="${mime}">\n${f.text}\n</file>`);
  }
  if (pathRefs.length > 0) {
    const lines = pathRefs.map((f) => `[Attached file: ${f.path}]`);
    parts.push(lines.join("\n"));
  }
  const composedText = parts.join("\n\n");

  if (images.length === 0) return composedText;

  const imageParts = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: img.dataUrl! },
  }));

  // Omit the text part entirely when there's nothing to say — some
  // providers (Anthropic via Bedrock, certain vision endpoints) reject an
  // empty-string text part as `invalid_content_part`.
  if (!composedText) return imageParts;

  return [{ type: "text" as const, text: composedText }, ...imageParts];
}

/**
 * Build the system message that scopes a conversation to a working folder
 * (issue #27). Returns null when no folder is set (undefined / empty /
 * whitespace) so callers can skip injection. Exported for unit testing.
 */
export function contextFolderSystemMessage(
  contextFolder?: string,
): { role: "system"; content: string } | null {
  const folder = contextFolder?.trim();
  if (!folder) return null;
  return {
    role: "system",
    content:
      `The working folder for this conversation is ${folder}. ` +
      `When the user asks you to read, create, modify, or run project ` +
      `files, use the file, terminal, and code-execution tools with ` +
      `absolute paths under this folder.`,
  };
}

function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  _resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  attachments?: Attachment[],
  contextFolder?: string,
): ChatHandle {
  const mc = getModelConfig(profile);
  const controller = new AbortController();

  // Build full conversation from history + current message (standard OpenAI format).
  // History items are kept text-only — attachments from prior turns live in
  // the gateway's session state when resuming via session_id.
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

  // Context folder (issue #27): when the conversation is bound to a working
  // folder, prepend a system message so the agent scopes file/terminal work
  // there. Injected only at the request-build step — the renderer's visible
  // transcript stays clean, and getSessionMessages filters non-user/assistant
  // roles, so reloaded sessions stay clean too.
  const ctxSystem = contextFolderSystemMessage(contextFolder);
  if (ctxSystem) messages.unshift(ctxSystem);

  const body = JSON.stringify({
    model: mc.model || "hermes-agent",
    messages,
    stream: true,
    ...(_resumeSessionId ? { session_id: _resumeSessionId } : {}),
  });

  // Encode the body up-front into a Buffer so we can:
  //  1. Set `Content-Length` accurately based on byte length (NOT char
  //     count — JSON.stringify of an image data URL is ASCII so they
  //     match, but multi-byte chars in user text would diverge).
  //  2. Disable Node's default `Transfer-Encoding: chunked` framing for
  //     bodies written via `req.write(body); req.end();`. Chunked
  //     framing skips the gateway's `body_limit_middleware` (which
  //     inspects Content-Length only), so an oversized payload that
  //     should produce a clean 413 "body_too_large" gets the
  //     misleading 400 "Invalid JSON in request body" via aiohttp's
  //     client_max_size overflow path. See #405.
  const bodyBuf = Buffer.from(body, "utf-8");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(bodyBuf.length),
    ...getRemoteAuthHeader(),
  };
  // Local API server key (API_SERVER_KEY in the profile's .env /
  // config.yaml) only applies in local mode — in remote/SSH mode the
  // remote endpoint's own auth header (set above) is authoritative and
  // must not be overwritten.
  if (!isRemoteMode()) {
    const apiServerKey = getApiServerKey(profile);
    console.log(
      "[hermes] apiServerKey=",
      apiServerKey ? apiServerKey.slice(0, 12) + "…" : "(none)",
    );
    if (apiServerKey) {
      headers.Authorization = `Bearer ${apiServerKey}`;
    }
  }

  // Session id: always send via `X-Hermes-Session-Id` so the gateway
  // doesn't fall back to its `_derive_chat_session_id` fingerprint —
  // sha256(system_prompt + first_user_message)[:16] — which collides
  // across every chat whose first user message is the same (e.g. "Hi").
  // The collision silently fragments state.db rows across unrelated
  // conversations and, post-#352, surfaces as old-session content
  // bleeding into new chats when our end-of-stream merge reads
  // getSessionMessages(). Filed upstream as
  // NousResearch/hermes-agent#7484 (security framing — same root cause).
  //
  // Format: `desk-<ms>-<uuidv4>`. UUIDv4 alone is collision-safe
  // probabilistically (~10⁻³⁶ for any pair); the timestamp prefix makes
  // it defensively unique even under a hypothetical PRNG bug, and the
  // `desk-` tag makes desktop-originated sessions visually distinct
  // from the gateway's fingerprint-derived `api-<hash>` ids in
  // state.db / logs.
  //
  // Gate on auth: the gateway rejects `X-Hermes-Session-Id` with 403
  // when API_SERVER_KEY isn't configured (its history-load is gated
  // behind auth). The desktop auto-generates API_SERVER_KEY at install
  // and remote mode supplies its own bearer, so in practice this
  // branch is always taken; the guard exists only so a misconfigured
  // local install degrades to the pre-fix (fingerprint) behaviour
  // rather than 403-looping.
  const hasAuth = "Authorization" in headers;
  let sessionId =
    _resumeSessionId || (hasAuth ? `desk-${Date.now()}-${randomUUID()}` : "");
  if (sessionId) {
    headers["X-Hermes-Session-Id"] = sessionId;
  }
  let hasContent = false;
  let finished = false; // guard against double callbacks
  let lastError = ""; // capture embedded error messages
  // Tool progress pattern: `emoji tool_name` or `emoji description`
  const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

  function finish(error?: string): void {
    if (finished) return;
    finished = true;
    console.log(
      "[hermes] finish called:",
      error ? `error=${error}` : "done",
      "sessionId=",
      sessionId,
    );
    if (error) {
      cb.onError(error);
    } else {
      cb.onDone(sessionId || undefined);
    }
  }

  function probeRealError(): void {
    // When streaming returns empty, make a non-streaming request to surface the real error
    const probeBody = JSON.stringify({
      model: mc.model || "hermes-agent",
      messages: [{ role: "user", content: userContent }],
      stream: false,
    });
    const probeBodyBuf = Buffer.from(probeBody, "utf-8");
    // Per-request Content-Length (the outer `headers` object's value
    // belongs to the streaming request — reusing it here would lie about
    // this body's size and break the framing the same way the missing
    // Content-Length did before #405). Spread + override.
    const probeHeaders = {
      ...headers,
      "Content-Length": String(probeBodyBuf.length),
    };
    const probeUrl = `${getApiUrl(profile)}/v1/chat/completions`;
    const probeMod = probeUrl.startsWith("https") ? https : http;
    const probeReq = probeMod.request(
      probeUrl,
      { method: "POST", headers: probeHeaders },
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
            finish(
              content ||
                errMsg ||
                "No response received from the model. Check your model configuration and API key.",
            );
          } catch {
            finish(
              "No response received from the model. Check your model configuration and API key.",
            );
          }
        });
      },
    );
    probeReq.on("error", () => {
      finish(
        "No response received from the model. Check your model configuration and API key.",
      );
    });
    probeReq.write(probeBodyBuf);
    probeReq.end();
  }

  /** Handle a custom SSE event (non-data lines with `event:` prefix). */
  function processCustomEvent(eventType: string, data: string): void {
    if (eventType === "hermes.tool.progress" && cb.onToolProgress) {
      try {
        const payload = JSON.parse(data);
        const label = payload.label || payload.tool || "";
        const emoji = payload.emoji || "";
        cb.onToolProgress(emoji ? `${emoji} ${label}` : label);
      } catch {
        /* malformed — skip */
      }
    }
  }

  function processSseData(data: string): boolean {
    if (data === "[DONE]") {
      if (hasContent) {
        finish();
      } else if (lastError) {
        finish(lastError);
      } else {
        // Streaming returned empty — probe non-streaming to get the real error
        probeRealError();
      }
      return true; // signals done
    }
    try {
      const parsed = JSON.parse(data);

      // Capture error responses forwarded through SSE
      if (parsed.error) {
        lastError = parsed.error.message || JSON.stringify(parsed.error);
        return false;
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      // Extract usage from final chunk (with optional cost + rate limit info)
      if (parsed.usage && cb.onUsage) {
        cb.onUsage({
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
          cost: parsed.usage.cost,
          rateLimitRemaining: parsed.usage.rate_limit_remaining,
          rateLimitReset: parsed.usage.rate_limit_reset,
          // Prompt-cache stats for the context gauge. The gateway emits
          // cache_read_tokens / cache_write_tokens; OpenAI-style providers
          // expose cached_tokens under prompt_tokens_details.
          cacheReadTokens:
            parsed.usage.cache_read_tokens ??
            parsed.usage.prompt_tokens_details?.cached_tokens,
          cacheWriteTokens: parsed.usage.cache_write_tokens,
        });
      }

      // Reasoning / thinking tokens, when the provider emits them.
      // Forwarded on a dedicated callback so the renderer can render the
      // thinking bubble live (#352). We do NOT set `hasContent = true`
      // here — reasoning alone shouldn't suppress the "empty stream"
      // diagnostic probe.
      const reasoningDelta = extractReasoningDelta(delta);
      if (reasoningDelta && cb.onReasoningChunk) {
        cb.onReasoningChunk(reasoningDelta);
      }

      if (delta?.content) {
        const content = delta.content.trim();
        // Legacy: Detect tool progress lines injected into content: `🔍 search_web`
        const match = toolProgressRe.exec(content);
        if (match && cb.onToolProgress) {
          cb.onToolProgress(`${match[1]} ${match[2]}`);
        } else {
          hasContent = true;
          cb.onChunk(delta.content);
        }
      }
    } catch {
      /* malformed chunk — skip */
    }
    return false;
  }

  const chatUrl = `${getApiUrl(profile)}/v1/chat/completions`;
  const requester = chatUrl.startsWith("https") ? https.request : http.request;
  const req = requester(
    chatUrl,
    {
      method: "POST",
      headers,
      signal: controller.signal,
      timeout: 120000,
    },
    (res) => {
      const sid = res.headers["x-hermes-session-id"];
      if (sid && typeof sid === "string") sessionId = sid;

      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", (d) => {
          errBody += d.toString();
        });
        res.on("end", () => {
          try {
            const err = JSON.parse(errBody);
            finish(err.error?.message || `API error ${res.statusCode}`);
          } catch {
            finish(
              `API server returned ${res.statusCode}: ${errBody.slice(0, 200)}`,
            );
          }
        });
        return;
      }

      let buffer = "";

      /** Parse an SSE block which may contain `event:` and `data:` lines. */
      function processSseBlock(block: string): boolean {
        let eventType = "";
        let dataLine = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }
        if (!dataLine) return false;
        if (eventType) {
          // Custom event (e.g. hermes.tool.progress) — never signals [DONE]
          processCustomEvent(eventType, dataLine);
          return false;
        }
        return processSseData(dataLine);
      }

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (processSseBlock(part)) return;
        }
      });

      res.on("end", () => {
        if (buffer.trim()) {
          for (const part of buffer.split("\n\n")) {
            if (processSseBlock(part)) return;
          }
        }
        // Signal completion — even when no content was received
        if (!hasContent && !lastError) {
          probeRealError();
          return;
        }
        finish(hasContent ? undefined : lastError);
      });

      res.on("error", (err) => {
        if (err.message === "aborted" || err.name === "AbortError") return;
        finish(`Stream error: ${err.message}`);
      });
    },
  );

  req.on("error", (err) => {
    if (err.name === "AbortError") return;
    finish(`API request failed: ${err.message}`);
  });
  req.on("timeout", () => {
    req.destroy();
    finish(
      "API request timed out. Check the SSH tunnel and remote Hermes gateway.",
    );
  });

  req.write(bodyBuf);
  req.end();

  return {
    abort: () => {
      controller.abort();
    },
  };
}

// ────────────────────────────────────────────────────
//  CLI fallback (slow path — spawns process)
// ────────────────────────────────────────────────────

const NOISE_PATTERNS = [/^[╭╰│╮╯─┌┐└┘┤├┬┴┼]/, /⚕\s*Hermes/];

function sendMessageViaCli(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  attachments?: Attachment[],
): ChatHandle {
  // CLI fallback can't pipe multimodal content; inline text-file attachments
  // and ignore images.  The gateway is the supported attachment path; this
  // is only hit when the API server isn't reachable.
  if (attachments && attachments.length > 0) {
    const textFiles = attachments.filter(
      (a) => a.kind === "text-file" && typeof a.text === "string",
    );
    if (textFiles.length > 0) {
      const wrapped = textFiles
        .map(
          (f) =>
            `<file name="${escapeXmlAttr(f.name)}" mime="${escapeXmlAttr(f.mime || "text/plain")}">\n${f.text}\n</file>`,
        )
        .join("\n\n");
      message = message.trim() ? `${message}\n\n${wrapped}` : wrapped;
    }
  }
  const mc = getModelConfig(profile);
  const profileEnv = readEnv(profile);

  const args = hermesCliArgs();
  if (profile && profile !== "default") {
    args.push("-p", profile);
  }
  args.push("chat", "-q", message, "-Q", "--source", "desktop");

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  if (mc.model) {
    args.push("-m", mc.model);
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    PYTHONUNBUFFERED: "1",
  };

  // Inject all API keys from the profile .env so the CLI can access them.
  // The built-in remote OpenAI-compatible providers (DeepSeek, Together,
  // Fireworks, Cerebras, Mistral) are listed here too — without them the
  // agent has no way to see the user-configured key when the user picked
  // the built-in provider entry rather than a `custom` entry, and the
  // upstream fallback chain then misroutes the request (see #260 / the
  // `pickAutoApiKeyForCustomProvider` workaround in config.ts).
  const KNOWN_API_KEYS = [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "TOGETHER_API_KEY",
    "FIREWORKS_API_KEY",
    "CEREBRAS_API_KEY",
    "MISTRAL_API_KEY",
    "PERPLEXITY_API_KEY",
    "GLM_API_KEY",
    "KIMI_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_CN_API_KEY",
    "HF_TOKEN",
    "EXA_API_KEY",
    "PARALLEL_API_KEY",
    "TAVILY_API_KEY",
    "FIRECRAWL_API_KEY",
    "FAL_KEY",
    "HONCHO_API_KEY",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "VOICE_TOOLS_OPENAI_KEY",
    "TINKER_API_KEY",
    "WANDB_API_KEY",
  ];
  for (const key of KNOWN_API_KEYS) {
    if (profileEnv[key] && !env[key]) {
      env[key] = profileEnv[key];
    }
  }

  const isCustomEndpoint = OPENAI_COMPAT_PROVIDERS.has(mc.provider);
  if (isCustomEndpoint && mc.baseUrl) {
    // Check if this model has an explicit apiMode from custom_providers
    let modelApiMode: string | null = null;
    try {
      const modelEntry = readModels().find(
        (m) => m.baseUrl === mc.baseUrl && m.model === mc.model,
      );
      if (modelEntry) modelApiMode = modelEntry.apiMode || null;
    } catch {
      /* ignore */
    }
    const isAnthropicProtocol = modelApiMode === "anthropic_messages";
    if (isAnthropicProtocol) {
      env.HERMES_INFERENCE_PROVIDER = "anthropic";
      env.ANTHROPIC_BASE_URL = mc.baseUrl.replace(/\/+$/, "");
    } else {
      env.HERMES_INFERENCE_PROVIDER = "custom";
      env.OPENAI_BASE_URL = mc.baseUrl.replace(/\/+$/, "");
    }

    // Resolve the right API key: check URL-specific key first, then OPENAI_API_KEY
    let resolvedKey = "";
    for (const { pattern, envKey } of URL_KEY_MAP) {
      if (pattern.test(mc.baseUrl)) {
        resolvedKey = profileEnv[envKey] || env[envKey] || "";
        break;
      }
    }
    if (!resolvedKey) {
      // Try custom provider auto-generated key from models.json
      try {
        const models = readModels();
        const matching = models.find((m) => m.baseUrl === mc.baseUrl);
        if (matching) {
          const envKey2 =
            "CUSTOM_PROVIDER_" +
            matching.name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase() +
            "_KEY";
          resolvedKey = profileEnv[envKey2] || env[envKey2] || "";
        }
      } catch {
        /* ignore */
      }
      if (!resolvedKey) {
        resolvedKey =
          profileEnv.CUSTOM_API_KEY ||
          env.CUSTOM_API_KEY ||
          profileEnv.OPENAI_API_KEY ||
          env.OPENAI_API_KEY ||
          "";
      }
    }
    // Local servers (localhost/127.0.0.1) don't need a real key
    if (!resolvedKey && /localhost|127\.0\.0\.1/i.test(mc.baseUrl)) {
      resolvedKey = "no-key-required";
    }
    if (isAnthropicProtocol) {
      env.ANTHROPIC_API_KEY = resolvedKey || "no-key-required";
    } else {
      env.OPENAI_API_KEY = resolvedKey || "no-key-required";
    }

    delete env.OPENROUTER_API_KEY;
    delete env.ANTHROPIC_TOKEN;
    delete env.OPENROUTER_BASE_URL;
  }

  const proc = spawn(HERMES_PYTHON, args, {
    cwd: HERMES_REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });

  let hasOutput = false;
  let capturedSessionId = "";
  let outputBuffer = "";

  function captureSessionId(text: string): void {
    const sidMatch = text.match(/session_id:\s*(\S+)/);
    if (sidMatch) capturedSessionId = sidMatch[1];
  }

  function processOutput(raw: Buffer): void {
    const text = stripAnsi(raw.toString());
    outputBuffer += text;

    captureSessionId(outputBuffer);

    const cleaned = text.replace(/session_id:\s*\S+\n?/g, "");
    const lines = cleaned.split("\n");
    const result: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (t && NOISE_PATTERNS.some((p) => p.test(t))) continue;
      result.push(line);
    }

    const output = result.join("\n");
    if (output) {
      hasOutput = true;
      cb.onChunk(output);
    }
  }

  proc.stdout?.on("data", processOutput);

  let stderrBuffer = "";
  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    captureSessionId(text);
    if (
      !text.trim() ||
      text.includes("UserWarning") ||
      text.includes("FutureWarning")
    ) {
      return;
    }
    // Forward errors visibly to the chat
    if (
      /❌|⚠️|Error|Traceback|error|failed|denied|unauthorized|invalid/i.test(
        text,
      )
    ) {
      hasOutput = true;
      cb.onChunk(text);
    } else {
      // Buffer other stderr for reporting on non-zero exit
      stderrBuffer += text;
    }
  });

  proc.on("close", (code) => {
    if (code === 0 || hasOutput) {
      cb.onDone(capturedSessionId || undefined);
    } else {
      const detail = stderrBuffer.trim();
      cb.onError(
        detail
          ? `Hermes exited with code ${code}: ${detail}`
          : `Hermes exited with code ${code}. Check your model configuration and API key.`,
      );
    }
  });

  proc.on("error", (err) => {
    cb.onError(err.message);
  });

  return {
    abort: () => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 3000);
    },
  };
}

// ────────────────────────────────────────────────────
//  Public API: auto-routes to HTTP API or CLI fallback
// ────────────────────────────────────────────────────

let apiServerAvailable: boolean | null = null; // cached after first check

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  attachments?: Attachment[],
  contextFolder?: string,
): Promise<ChatHandle> {
  ensureInitialized();

  // Remote mode: always use API, no CLI fallback
  if (isRemoteMode()) {
    return sendMessageViaApi(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
    );
  }

  // Check API server availability. In local mode, a running gateway process
  // can still be in its startup window (or the cached ready state can be stale
  // after an external stop/start), so verify health before taking the API path.
  const localGatewayRunning = !isRemoteMode() && isGatewayRunning(profile);
  if (
    apiServerAvailable === null ||
    apiServerAvailable === false ||
    localGatewayRunning
  ) {
    apiServerAvailable = await isApiServerReady(profile);
    if (!apiServerAvailable && localGatewayRunning) {
      apiServerAvailable = await waitForApiServerReady(8000, profile);
    }
  }

  if (apiServerAvailable) {
    return sendMessageViaApi(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
      attachments,
      contextFolder,
    );
  }

  // Fallback to CLI
  return sendMessageViaCli(message, cb, profile, resumeSessionId, attachments);
}

// Lazy init — called on first sendMessage or gateway start
let _initialized = false;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function ensureInitialized(): void {
  if (_initialized) return;
  _initialized = true;
  // Note: api_server config is written per-profile by startGateway() now
  // (each profile needs its own port), so ensureInitialized only owns the
  // shared health poller.
  startHealthPolling();
}

function startHealthPolling(): void {
  if (_healthCheckInterval) return;
  _healthCheckInterval = setInterval(async () => {
    apiServerAvailable = await isApiServerReady();
    // Stop polling once API is confirmed available — only re-check on demand
    if (apiServerAvailable && _healthCheckInterval) {
      clearInterval(_healthCheckInterval);
      _healthCheckInterval = null;
    }
  }, 15000);
}

export function stopHealthPolling(): void {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

// ────────────────────────────────────────────────────
//  Gateway management
// ────────────────────────────────────────────────────

// Profiles each own a gateway, keyed by profileKey() ("default" for the
// default profile, the profile name otherwise). Tracking them in maps —
// rather than a single global — lets several profiles' gateways run at once
// (e.g. each keeping its own Telegram bot online), which is the documented
// hermes model: one gateway per profile, bound to that profile's own port.
const gatewayProcesses = new Map<string, ChildProcess>();
const appStartedProfiles = new Set<string>();

/**
 * Clear the cached API-server-ready flag, but only when `profile` is the one
 * the desktop currently addresses (the active profile). A *background*
 * profile's gateway dying must not flip the active profile's chat into the
 * CLI-fallback path on its next message.
 */
function invalidateApiCacheFor(profile?: string): void {
  if (profileKey(profile) === profileKey(undefined)) {
    apiServerAvailable = false;
  }
}

export function startGateway(profile?: string): boolean {
  // Defensive: the local gateway is never the right thing to spawn in
  // remote/SSH mode — the user is pointing at an off-machine server.
  // Callers should already gate, but several IPC handlers historically
  // forgot to (issue #266), and reaching `spawn(HERMES_PYTHON, …)` when
  // there's no local hermes-agent install produces an uncaught ENOENT
  // that pops a generic error dialog.  Refuse cleanly here.
  if (isRemoteMode()) {
    console.warn(
      "[gateway] startGateway() called in remote/SSH mode — refusing local spawn",
    );
    return false;
  }
  ensureInitialized();
  if (isGatewayRunning(profile)) return false;

  // Pre-flight: verify the Python interpreter exists before attempting to
  // spawn. Without this check, spawn() fails with ENOENT and the error is
  // completely silent (stdio:"ignore", no error handler).
  if (!existsSync(HERMES_PYTHON)) {
    console.error(
      `[gateway] Cannot start: Python interpreter not found at ${HERMES_PYTHON}. ` +
        "Is hermes-agent installed?",
    );
    return false;
  }
  if (!existsSync(HERMES_REPO)) {
    console.error(
      `[gateway] Cannot start: hermes-agent repo not found at ${HERMES_REPO}. ` +
        "Is hermes-agent installed?",
    );
    return false;
  }

  const resolved = resolveProfile(profile); // undefined => default
  const key = profileKey(profile);

  // Make sure this profile's config.yaml enables the api_server and binds the
  // profile's own port before we spawn.
  ensureApiServerConfig(profile);
  const port = getProfilePort(profile);

  // Build gateway env with profile API keys
  const gatewayEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    API_SERVER_ENABLED: "true", // Ensure API server starts with gateway
    // Bind to this profile's port. config.yaml's api_server.port wins when
    // present (getProfilePort keeps it collision-free); this env value covers
    // the case where the block exists but omits an explicit port.
    API_SERVER_PORT: String(port),
  };

  // Inject ALL profile API keys so the gateway can authenticate with any provider.
  const profileEnv = readEnv(profile);
  for (const [k, value] of Object.entries(profileEnv)) {
    if (value) {
      gatewayEnv[k] = value;
    }
  }

  // Inject the resolved API_SERVER_KEY into the gateway's env.
  //
  // The desktop's `getApiServerKey` reads the shared secret from six
  // sources: config.yaml top-level `API_SERVER_KEY:`, `.env`
  // `API_SERVER_KEY=`, and config.yaml `api_server.token:` (each per-profile
  // and default-profile). The upstream gateway's `APIServerAdapter` (see
  // `gateway/platforms/api_server.py:647`) only reads two of those:
  // `api_server.extra.key` from config.yaml, or `os.getenv("API_SERVER_KEY")`
  // at startup. Upstream `gateway/run.py:608-610` bridges *top-level*
  // config.yaml keys into env vars, so `API_SERVER_KEY:` at the top
  // level works — but the nested `api_server.token:` location does not
  // become an env var, and the gateway never reads it directly.
  //
  // The result is a divergence: the desktop happily sends
  // `Authorization: Bearer <key>` + `X-Hermes-Session-Id` for users
  // whose key lives in `api_server.token`, while the gateway's
  // `self._api_key` is empty and returns 403 with
  //   "Session continuation requires API key authentication.
  //    Configure API_SERVER_KEY to enable this feature."
  // (api_server.py:1097-1109). This is what users on Telegram, Reddit,
  // and several open issues have been hitting since v0.5.1 — PR #357
  // started sending the session header on every fresh chat, which made
  // the latent divergence user-visible on every send.
  //
  // Bridging the desktop's resolved value into the spawn env makes the
  // gateway's `os.getenv("API_SERVER_KEY")` fallback see whatever the
  // desktop sees, regardless of source. This is the canonical fix until
  // upstream learns to read `api_server.token` directly.
  const resolvedApiServerKey = getApiServerKey(profile);
  if (resolvedApiServerKey) {
    gatewayEnv.API_SERVER_KEY = resolvedApiServerKey;
  }

  // Route stderr to a log file so startup errors are visible for debugging.
  // Per-profile log dir so a named profile's failures (e.g. a duplicate bot
  // token, which the gateway refuses to start with) don't get mixed into the
  // default profile's log. stdout is ignored (the gateway daemonizes and
  // writes its own logs).
  const logDir = profileHome(resolved);
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    // ignore
  }
  const logPath = join(logDir, "gateway-stderr.log");
  // Open the log synchronously and hand spawn a real fd. A createWriteStream
  // opens its fd asynchronously, so passing the stream to stdio races: when
  // the fd hasn't resolved yet (fd: null) Electron's Node rejects it with
  // ERR_INVALID_ARG_VALUE. An integer fd sidesteps the race entirely.
  let stderrFd: number;
  try {
    stderrFd = openSync(logPath, "a");
  } catch {
    // If the log file can't be opened (e.g. permissions), fall back to
    // discarding stderr rather than failing the whole gateway start.
    stderrFd = -1;
  }

  // Target the specific profile via `--profile <name>` (placed before the
  // subcommand, as the CLI requires). The flag makes the CLI repoint
  // HERMES_HOME at the profile's dir internally; the shared repo/venv stay
  // put. The default profile takes no flag.
  const cliArgs = resolved ? ["--profile", resolved, "gateway"] : ["gateway"];
  const proc = spawn(HERMES_PYTHON, hermesCliArgs(cliArgs), {
    cwd: HERMES_REPO,
    env: gatewayEnv,
    stdio: ["ignore", "ignore", stderrFd >= 0 ? stderrFd : "ignore"],
    detached: true,
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });
  // The child has inherited (dup'd) the fd; close our copy so we don't leak a
  // descriptor on every gateway (re)start.
  if (stderrFd >= 0) {
    try {
      closeSync(stderrFd);
    } catch {
      // best-effort
    }
  }

  proc.on("error", (err) => {
    console.error(
      `[gateway:${key}] Failed to spawn gateway process:`,
      err.message,
    );
    if (gatewayProcesses.get(key) === proc) gatewayProcesses.delete(key);
    appStartedProfiles.delete(key);
    invalidateApiCacheFor(profile);
  });

  proc.on("close", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(
        `[gateway:${key}] Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}. ` +
          `Check ${logPath} for details.`,
      );
    }
    if (gatewayProcesses.get(key) === proc) gatewayProcesses.delete(key);
    appStartedProfiles.delete(key);
    invalidateApiCacheFor(profile);
    // Restart health polling to detect if gateway comes back
    startHealthPolling();
  });

  proc.unref();
  gatewayProcesses.set(key, proc);
  appStartedProfiles.add(key);

  // Wait a bit then check if API server came up (only meaningful for the
  // active profile, whose URL getApiUrl() resolves to).
  setTimeout(async () => {
    if (profileKey(profile) === profileKey(undefined)) {
      apiServerAvailable = await isApiServerReady(profile);
    }
  }, 3000);

  return true;
}

function parsePidFromFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const raw = readFileSync(pidFile, "utf-8").trim();
    // PID file can be JSON ({"pid": 1234, ...}) or plain integer
    const parsed = raw.startsWith("{")
      ? JSON.parse(raw).pid
      : parseInt(raw, 10);
    return typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The gateway.pid path for a profile. The hermes CLI writes it into the
 * profile's home directory (~/.hermes/gateway.pid for default,
 * ~/.hermes/profiles/<name>/gateway.pid for a named profile), so each
 * profile's gateway has its own PID file — that's what lets them coexist.
 */
function gatewayPidPath(profile?: string): string {
  return join(profileHome(resolveProfile(profile)), "gateway.pid");
}

function readPidFile(profile?: string): number | null {
  return parsePidFromFile(gatewayPidPath(profile));
}

/**
 * Stop a single profile's gateway. Defaults to the active profile. By design
 * this only touches the named profile — switching profiles, app exit, etc.
 * must never take down a *different* profile's gateway (and its bots).
 */
export function stopGateway(profile?: string, force = false): void {
  const key = profileKey(profile);
  if (!force && !appStartedProfiles.has(key)) return;

  const proc = gatewayProcesses.get(key);
  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
  }
  gatewayProcesses.delete(key);

  const pid = readPidFile(profile);
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  // Always clear the PID file once we've signalled it. Leaving a stale PID
  // around means the next isGatewayRunning() / stopGateway() call can hit
  // an unrelated process that the OS has since assigned the same PID.
  const pidFile = gatewayPidPath(profile);
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // best-effort; will be overwritten on next gateway start
    }
  }
  appStartedProfiles.delete(key);
  invalidateApiCacheFor(profile);
}

// Python image prefixes covering both native Windows (pythonw.exe / python.exe)
// and POSIX (python, python3, pythonw). Used to verify the PID we read from
// gateway.pid actually belongs to a python process before reporting alive.
const GATEWAY_IMAGE_PREFIXES = ["python", "pythonw"];

export function isGatewayRunning(profile?: string): boolean {
  const proc = gatewayProcesses.get(profileKey(profile));
  if (proc && !proc.killed) return true;
  const pid = readPidFile(profile);
  if (!pid) return false;
  return pidIsAliveAs(pid, GATEWAY_IMAGE_PREFIXES);
}

export function isApiReady(): boolean {
  return apiServerAvailable === true;
}

export function testRemoteConnection(
  url: string,
  apiKey?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const target = `${normaliseRemoteUrl(url)}/health`;
    const mod = target.startsWith("https") ? https : http;
    const headers: Record<string, string> = {};
    const resolvedApiKey = resolveRemoteApiKey(url, apiKey);
    if (resolvedApiKey) headers.Authorization = `Bearer ${resolvedApiKey}`;
    const req = mod.request(
      target,
      { method: "GET", timeout: 5000, headers },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

export function restartGateway(profile?: string): void {
  // Same defensive gate as startGateway — the local gateway has no role
  // in remote/SSH mode.  Cheap to check; catches IPC paths that don't
  // wrap their restart calls in an isRemoteMode() check.
  if (isRemoteMode()) return;
  const key = profileKey(profile);
  if (!appStartedProfiles.has(key) && !isGatewayRunning(profile)) return;
  stopGateway(profile, true);
  setTimeout(() => {
    startGateway(profile);
  }, 500);
}

/**
 * Hook for the profile-switch handler: drop the cached ready flag so the next
 * health check probes the newly active profile's port instead of trusting a
 * value sampled against the previous profile's gateway.
 */
export function notifyProfileSwitched(): void {
  apiServerAvailable = null;
}
