import { spawn } from "child_process";
import { randomUUID } from "crypto";
import http from "http";
import https from "https";
import { homedir } from "os";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  hermesCliArgs,
  getEnhancedPath,
  getHermesVersion,
} from "../installer";
import {
  getApiServerKey,
  getModelConfig,
  readEnv,
  getConnectionConfig,
} from "../config";
import {
  getApiUrl,
  getRemoteAuthHeader,
  isRemoteMode,
  isApiServerReady,
  waitForApiServerReady,
  isGatewayRunning,
  getApiServerAvailable,
  setApiServerAvailable,
  resolveProfile,
  startHealthPolling,
} from "./gateway-process";
import { stripAnsi } from "../utils";
import {
  processCustomEvent as parseCustomEvent,
  processSseData,
  type SseCallbacks,
  type ApprovalRequest,
  type CheckpointEvent,
  type DelegateProgress,
} from "../sse-parser";
import { readModels } from "../models";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import { type Attachment, escapeXmlAttr } from "../../shared/attachments";
import { URL_KEY_MAP, OPENAI_COMPAT_PROVIDERS } from "../../shared/url-key-map";
import { redactSensitiveData } from "../security";
import { buildRetrievalSystemMessage } from "./grounding";

export interface ChatCallbacks {
  onChunk: (text: string) => void;
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
    model?: string;
    sessionId?: string;
    cacheRead?: number;
    cacheWrite?: number;
  }) => void;
  onApprovalRequest?: (req: ApprovalRequest) => void;
  onCheckpoint?: (cp: CheckpointEvent) => void;
  onDelegateProgress?: (p: DelegateProgress) => void;
}

export interface ChatHandle {
  abort: () => void;
}

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export async function chatCompletionOnce(
  messages: Array<{ role: string; content: string }>,
  profile?: string,
): Promise<{ content: string; error?: string }> {
  const mc = getModelConfig(profile);
  const body = JSON.stringify({
    model: mc.model || "hermes-agent",
    messages,
    stream: false,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getRemoteAuthHeader(),
  };
  if (!isRemoteMode()) {
    const apiServerKey = getApiServerKey(profile);
    if (apiServerKey) headers.Authorization = `Bearer ${apiServerKey}`;
  }
  const url = `${getApiUrl(profile)}/v1/chat/completions`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let parsed: {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        content: "",
        error: `Bad response from gateway (${res.status})`,
      };
    }

    if (parsed.error) {
      return {
        content: "",
        error: parsed.error.message || "Gateway error",
      };
    }

    return {
      content: parsed.choices?.[0]?.message?.content || "",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : "";
    if (errorName === "AbortError") {
      return { content: "", error: "Request timed out" };
    }
    return { content: "", error: errorMsg };
  }
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

  if (!composedText) return imageParts;

  return [{ type: "text" as const, text: composedText }, ...imageParts];
}

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

export async function buildSelfAwarenessSystemMessage(
  profile?: string,
): Promise<{ role: "system"; content: string } | null> {
  try {
    const { getToolsets } = await import("../tools");
    const { listInstalledSkills } = await import("../skills");
    const { getSharedDb } = await import("../db");
    const activeProfile = resolveProfile(profile) || "default";
    const enabledTools = getToolsets(profile)
      .filter((t) => t.enabled)
      .map((t) => t.key);
    const installedSkills = listInstalledSkills(profile).map((s) => s.name);
    const version = (await getHermesVersion()) || "Unknown Version";

    let registryCount = 0;
    try {
      const db = getSharedDb(true);
      if (db) {
        const tableCheck = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='skills_registry'",
          )
          .get();
        if (tableCheck) {
          const row = db
            .prepare("SELECT COUNT(*) as count FROM skills_registry")
            .get() as { count: number };
          registryCount = row.count;
        }
      }
    } catch {
      /* best-effort */
    }

    const sysMsg =
      `You are Hermes, a self-improving AI agent. ` +
      `You are running inside Hermes Desktop v${version} on the user's local machine. ` +
      `Active profile: "${activeProfile}".\n\n` +
      `Your active capabilities configuration:\n` +
      `- Enabled toolsets: [${enabledTools.join(", ")}]\n` +
      `- Installed skills (advanced agents you can delegate to): [${installedSkills.join(", ")}]\n` +
      `- Skills available in registry: ${registryCount} (use skills-registry-lookup to find or sync them)\n\n` +
      `Feel free to use your tools to achieve the user's goal.`;

    return { role: "system", content: sysMsg };
  } catch (err) {
    console.error(
      "[hermes] Failed to build self-awareness system message:",
      err,
    );
    return null;
  }
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

  const body = JSON.stringify({
    model: effectiveModel || "hermes-agent",
    messages,
    stream: true,
    ...(_resumeSessionId ? { session_id: _resumeSessionId } : {}),
  });

  const bodyBuf = Buffer.from(body, "utf-8");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(bodyBuf.length),
    ...getRemoteAuthHeader(),
  };

  if (!isRemoteMode()) {
    // LOW-1: never log the key (even a prefix) — secrets don't belong in logs.
    const apiServerKey = getApiServerKey(profile);
    if (apiServerKey) {
      headers.Authorization = `Bearer ${apiServerKey}`;
    }
  }

  const hasAuth = "Authorization" in headers;
  let sessionId =
    _resumeSessionId || (hasAuth ? `desk-${Date.now()}-${randomUUID()}` : "");
  if (sessionId) {
    headers["X-Hermes-Session-Id"] = sessionId;
  }
  let hasContent = false;
  let finished = false;
  let lastError = "";

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
    // HIGH-1: the probe is a separate request and inherits none of the main
    // request's timeout — without this it can hang forever, leaving the chat
    // promise unresolved and the UI stuck "thinking".
    probeReq.setTimeout(120000);
    probeReq.on("timeout", () => {
      probeReq.destroy();
      finish(
        "No response received from the model (request timed out). Check your model configuration and API key.",
      );
    });
    probeReq.write(probeBodyBuf);
    probeReq.end();
  }

  function processCustomEvent(eventType: string, data: string): void {
    parseCustomEvent(eventType, data, cb);
  }

  const url = `${getApiUrl(profile)}/v1/chat/completions`;
  const requester = url.startsWith("https") ? https : http;

  const req = requester.request(
    url,
    {
      method: "POST",
      headers,
      signal: controller.signal,
      timeout: 120000,
    },
    (res) => {
      const sid = res.headers["x-hermes-session-id"];
      if (sid && typeof sid === "string") sessionId = sid;

      // processSseData fires onDone itself on `[DONE]`; we own the single
      // terminal callback in finalize(), so hand it a callback set with onDone
      // stripped — otherwise onDone fires twice (once here, once in finish()).
      const sseCb = { ...cb, onDone: undefined };

      // Single decision point for how the turn ends, shared by the `[DONE]`
      // block and the stream-end path.
      function finalize(): void {
        if (finished) return;
        if (lastError) {
          if (hasContent) {
            // MED-5: keep what already streamed, but surface the error as a
            // trailing notice so an error followed by `[DONE]` (or content) is
            // not silently swallowed.
            cb.onChunk(`\n\n⚠️ ${lastError}`);
            finish();
          } else {
            finish(lastError);
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
          lastError = state.lastError; // MED-5: propagate, else errors are lost across chunks
          if (sseRes.done) finalize();
        }
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
        // MED-6: flush a trailing block left without a closing `\n\n` (gateway
        // crashed/disconnected mid-chunk) before deciding the outcome.
        const tail = buffer.trim();
        if (tail) handleBlock(tail);
        finalize();
      });

      res.on("error", (err) => {
        if (err.message === "aborted" || err.name === "AbortError") return;
        finish(`Stream error: ${err.message}`);
      });
    },
  );
  req.setTimeout(120000);

  req.on("error", (err) => {
    if (err.name === "AbortError") return;
    finish(`API request failed: ${err.message}`);
  });
  req.on("timeout", () => {
    req.destroy();
    // LOW-3: blame the right layer for the connection mode actually in use.
    const mode = getConnectionConfig().mode;
    const where =
      mode === "ssh"
        ? "Check the SSH tunnel and the remote Hermes gateway."
        : mode === "remote"
          ? "Check the remote Hermes gateway and your network connection."
          : "The local Hermes gateway may be unresponsive — check that a model is configured and the gateway is running.";
    finish(`API request timed out. ${where}`);
  });

  req.write(bodyBuf);
  req.end();

  return {
    abort: () => {
      controller.abort();
    },
  };
}

const NOISE_PATTERNS = [/^[╭╰│╮╯─┌┐└┘┤├┬┴┼]/, /⚕\s*Hermes/];

export function sendMessageViaCli(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  attachments?: Attachment[],
): ChatHandle {
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

    let resolvedKey = "";
    for (const { pattern, envKey } of URL_KEY_MAP) {
      if (pattern.test(mc.baseUrl)) {
        resolvedKey = profileEnv[envKey] || env[envKey] || "";
        break;
      }
    }
    if (!resolvedKey) {
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
      cb.onChunk(redactSensitiveData(output));
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
    if (
      /❌|⚠️|Error|Traceback|error|failed|denied|unauthorized|invalid/i.test(
        text,
      )
    ) {
      hasOutput = true;
      cb.onChunk(redactSensitiveData(text));
    } else {
      stderrBuffer += text;
    }
  });

  // MED-1: a spawn failure fires `error` then `close`; without a guard the CLI
  // path calls a terminal callback twice. The API path has the same `finished`
  // flag — mirror it here so exactly one of onDone/onError fires.
  let finished = false;
  let exited = false;

  proc.on("close", (code) => {
    exited = true;
    if (finished) return;
    finished = true;
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

  proc.on("exit", () => {
    exited = true;
  });

  proc.on("error", (err) => {
    if (finished) return;
    finished = true;
    cb.onError(err.message);
  });

  return {
    abort: () => {
      proc.kill("SIGTERM");
      // LOW-6: escalate to SIGKILL only if the process has not actually exited.
      // `proc.killed` only reflects that a signal was *sent*, not that the
      // process died, so a wedged process could otherwise linger.
      const killTimer = setTimeout(() => {
        if (!exited) proc.kill("SIGKILL");
      }, 3000);
      if (typeof killTimer.unref === "function") killTimer.unref();
    },
  };
}

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  attachments?: Attachment[],
  contextFolder?: string,
  groundInWorkspace?: boolean,
  modelOverride?: { model?: string; provider?: string; baseUrl?: string },
): Promise<ChatHandle> {
  startHealthPolling();

  const groundingSystem =
    groundInWorkspace && !isRemoteMode()
      ? await buildRetrievalSystemMessage(message, profile)
      : null;

  const selfAwarenessSystem = await buildSelfAwarenessSystemMessage(profile);

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
      groundingSystem,
      selfAwarenessSystem,
      modelOverride,
    );
  }

  let apiServerAvailable = getApiServerAvailable();
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
    setApiServerAvailable(apiServerAvailable);
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
      groundingSystem,
      selfAwarenessSystem,
      modelOverride,
    );
  }

  return sendMessageViaCli(message, cb, profile, resumeSessionId, attachments);
}
