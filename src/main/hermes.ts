import { ChildProcess, spawn } from "child_process";
import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer";
import { getApiServerKey, getModelConfig, readEnv } from "./config";
import { stripAnsi } from "./utils";

const API_URL = "http://127.0.0.1:8642";

const LOCAL_PROVIDERS = new Set([
  "custom",
  "lmstudio",
  "ollama",
  "vllm",
  "llamacpp",
]);

// Map base-URL patterns to the API key env var they need
const URL_KEY_MAP: Array<{ pattern: RegExp; envKey: string }> = [
  { pattern: /openrouter\.ai/i, envKey: "OPENROUTER_API_KEY" },
  { pattern: /anthropic\.com/i, envKey: "ANTHROPIC_API_KEY" },
  { pattern: /openai\.com/i, envKey: "OPENAI_API_KEY" },
  { pattern: /huggingface\.co/i, envKey: "HF_TOKEN" },
];

interface ChatHandle {
  abort: () => void;
}

// ────────────────────────────────────────────────────
//  API Server health check
// ────────────────────────────────────────────────────

function isApiServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${API_URL}/health`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ────────────────────────────────────────────────────
//  Ensure API server is enabled in config
// ────────────────────────────────────────────────────

function ensureApiServerConfig(): void {
  try {
    const configPath = join(HERMES_HOME, "config.yaml");
    if (!existsSync(configPath)) return;
    const content = readFileSync(configPath, "utf-8");
    // If api_server is already configured, skip
    if (/api_server/i.test(content)) return;
    const addition = `
# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: 8642
      host: "127.0.0.1"
`;
    appendFileSync(configPath, addition, "utf-8");
  } catch {
    /* non-fatal */
  }
}

// ────────────────────────────────────────────────────
//  HTTP API streaming (fast path — no process spawn)
// ────────────────────────────────────────────────────

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }) => void;
}

function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  _resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
): ChatHandle {
  const mc = getModelConfig(profile);
  const controller = new AbortController();

  // Build full conversation from history + current message (standard OpenAI format)
  const messages: Array<{ role: string; content: string }> = [];
  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push({
        role: msg.role === "agent" ? "assistant" : msg.role,
        content: msg.content,
      });
    }
  }
  messages.push({ role: "user", content: message });

  const body = JSON.stringify({
    model: mc.model || "hermes-agent",
    messages,
    stream: true,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiServerKey = getApiServerKey(profile);
  if (apiServerKey) {
    headers.Authorization = `Bearer ${apiServerKey}`;
  }

  let sessionId = _resumeSessionId || "";
  let hasContent = false;
  let finished = false; // guard against double callbacks
  let lastError = ""; // capture embedded error messages
  // Tool progress pattern: `emoji tool_name` or `emoji description`
  const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

  function finish(error?: string): void {
    if (finished) return;
    finished = true;
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
      messages: [{ role: "user", content: message }],
      stream: false,
    });
    const probeReq = http.request(
      `${API_URL}/v1/chat/completions`,
      { method: "POST", headers },
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
    probeReq.write(probeBody);
    probeReq.end();
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

      // Extract usage from final chunk
      if (parsed.usage && cb.onUsage) {
        cb.onUsage({
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
        });
      }

      if (delta?.content) {
        const content = delta.content.trim();
        // Detect tool progress lines: `🔍 search_web`
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

  const req = http.request(
    `${API_URL}/v1/chat/completions`,
    {
      method: "POST",
      headers,
      signal: controller.signal,
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

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            if (processSseData(line.slice(6))) return;
          }
        }
      });

      res.on("end", () => {
        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            if (processSseData(line.slice(6))) return;
          }
        }
        // Signal completion — even when no content was received
        if (!hasContent && !lastError) {
          probeRealError();
          return;
        }
        finish(hasContent ? undefined : lastError);
      });

      res.on("error", (err) => finish(`Stream error: ${err.message}`));
    },
  );

  req.on("error", (err) => {
    if (err.name === "AbortError") return;
    finish(`API request failed: ${err.message}`);
  });

  req.write(body);
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
): ChatHandle {
  const mc = getModelConfig(profile);
  const profileEnv = readEnv(profile);

  const args = [HERMES_SCRIPT];
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

  // Inject all API keys from the profile .env so the CLI can access them
  const KNOWN_API_KEYS = [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
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

  const isCustomEndpoint = LOCAL_PROVIDERS.has(mc.provider);
  if (isCustomEndpoint && mc.baseUrl) {
    env.HERMES_INFERENCE_PROVIDER = "custom";
    env.OPENAI_BASE_URL = mc.baseUrl.replace(/\/+$/, "");

    // Resolve the right API key: check URL-specific key first, then OPENAI_API_KEY
    let resolvedKey = "";
    for (const { pattern, envKey } of URL_KEY_MAP) {
      if (pattern.test(mc.baseUrl)) {
        resolvedKey = profileEnv[envKey] || env[envKey] || "";
        break;
      }
    }
    if (!resolvedKey) {
      resolvedKey = profileEnv.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
    }
    // Local servers (localhost/127.0.0.1) don't need a real key
    if (!resolvedKey && /localhost|127\.0\.0\.1/i.test(mc.baseUrl)) {
      resolvedKey = "no-key-required";
    }
    env.OPENAI_API_KEY = resolvedKey || "no-key-required";

    delete env.OPENROUTER_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_TOKEN;
    delete env.OPENROUTER_BASE_URL;
  }

  const proc = spawn(HERMES_PYTHON, args, {
    cwd: HERMES_REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let hasOutput = false;
  let capturedSessionId = "";
  let outputBuffer = "";

  function processOutput(raw: Buffer): void {
    const text = stripAnsi(raw.toString());
    outputBuffer += text;

    const sidMatch = outputBuffer.match(/session_id:\s*(\S+)/);
    if (sidMatch) capturedSessionId = sidMatch[1];

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
): Promise<ChatHandle> {
  ensureInitialized();
  // Check API server availability (cache the result, re-check periodically)
  if (apiServerAvailable === null || apiServerAvailable === false) {
    apiServerAvailable = await isApiServerReady();
  }

  if (apiServerAvailable) {
    return sendMessageViaApi(message, cb, profile, resumeSessionId, history);
  }

  // Fallback to CLI
  return sendMessageViaCli(message, cb, profile, resumeSessionId);
}

// Lazy init — called on first sendMessage or gateway start
let _initialized = false;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function ensureInitialized(): void {
  if (_initialized) return;
  _initialized = true;
  ensureApiServerConfig();
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

let gatewayProcess: ChildProcess | null = null;
let gatewayStartedByApp = false;

export function startGateway(profile?: string): boolean {
  ensureInitialized();
  if (isGatewayRunning()) return false;

  // Build gateway env with profile API keys
  const gatewayEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    API_SERVER_ENABLED: "true", // Ensure API server starts with gateway
  };

  // Inject ALL profile API keys so the gateway can authenticate with any provider.
  const profileEnv = readEnv(profile);
  for (const [key, value] of Object.entries(profileEnv)) {
    if (value) {
      gatewayEnv[key] = value;
    }
  }

  gatewayProcess = spawn(HERMES_PYTHON, [HERMES_SCRIPT, "gateway"], {
    cwd: HERMES_REPO,
    env: gatewayEnv,
    stdio: "ignore",
    detached: true,
  });

  gatewayProcess.unref();

  gatewayProcess.on("close", () => {
    gatewayProcess = null;
    gatewayStartedByApp = false;
    apiServerAvailable = false;
    // Restart health polling to detect if gateway comes back
    startHealthPolling();
  });

  gatewayStartedByApp = true;

  // Wait a bit then check if API server came up
  setTimeout(async () => {
    apiServerAvailable = await isApiServerReady();
  }, 3000);

  return true;
}

function readPidFile(): number | null {
  const pidFile = join(HERMES_HOME, "gateway.pid");
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

export function stopGateway(force = false): void {
  if (!force && !gatewayStartedByApp) return;

  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill("SIGTERM");
    gatewayProcess = null;
  }
  const pid = readPidFile();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  gatewayStartedByApp = false;
  apiServerAvailable = false;
}

export function isGatewayRunning(): boolean {
  if (gatewayProcess && !gatewayProcess.killed) return true;
  const pid = readPidFile();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isApiReady(): boolean {
  return apiServerAvailable === true;
}

/**
 * Restart the gateway so it picks up new model/provider config.
 * Only restarts if the gateway was started by this app.
 */
export function restartGateway(profile?: string): void {
  if (!gatewayStartedByApp && !isGatewayRunning()) return;
  stopGateway(true);
  // Small delay to let the old process die before starting a new one
  setTimeout(() => {
    startGateway(profile);
  }, 500);
}
