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
  const noContentDeadlineAt = Date.now() + STREAM_NO_CONTENT_DEADLINE_MS;

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
      console.warn("[hermes] Pre-LLM hook failed:", err);
    }

    // 2. Smart Memory Shrinking (Context Compressor)
    const compressor = new ContextCompressor({
      budgetChars: customBudgetChars,
    });
    const compressedMessages = compressor.compress(messages);

    const body = JSON.stringify({
      model: effectiveModel || "hermes-agent",
      messages: compressedMessages,
      stream: true,
      ...(_resumeSessionId ? { session_id: _resumeSessionId } : {}),
    });

    const bodyBuf = Buffer.from(body, "utf-8");

    // Dynamic headers compilation for credential pool rotation read-back
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(bodyBuf.length),
      ...getRemoteAuthHeader(),
    };

    if (!isRemoteMode()) {
      const apiServerKey = getApiServerKey(profile);
      if (apiServerKey) {
        headers.Authorization = `Bearer ${apiServerKey}`;
      }
    }

    // Direct auth injection for remote endpoints during rotative fallback
    if (isRemoteMode()) {
      const provider = mc.provider || "openai";
      const envKey = CredentialPoolManager.getEnvKeyForProvider(provider);
      const activeKey = readEnv(profile)[envKey] || process.env[envKey] || "";
      if (activeKey) {
        headers.Authorization = `Bearer ${activeKey}`;
      }
    }

    const hasAuth = "Authorization" in headers;
    if (!sessionId && hasAuth) {
      sessionId = `desk-${Date.now()}-${randomUUID()}`;
    }
    if (sessionId) {
      headers["X-Hermes-Session-Id"] = sessionId;
    }

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
      const probeUrl = `${getApiUrl(profile)}/v1/chat/completions`;
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
      const classification = ErrorDoctor.classify(errorText, statusCode);
      console.log("[hermes] Error Doctor classification:", classification);

      if (classification.retryable && retryBudget > 0 && !hasContent) {
        if (requestTimeoutForAttempt(noContentDeadlineAt) <= 0) {
          finish(errorText);
          return;
        }

        if (classification.shouldCompress) {
          console.log("[hermes] Memory overflow detected. Compacting budget.");
          executeRequest(retryBudget - 1, 20000);
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
            console.log(
              "[hermes] Credential rotated successfully. Retrying request.",
            );
            executeRequest(retryBudget - 1, customBudgetChars);
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
        console.log(
          `[hermes] Retrying request after delay of ${boundedDelay}ms...`,
        );
        setTimeout(() => {
          executeRequest(retryBudget - 1, customBudgetChars);
        }, boundedDelay);
        return;
      }

      finish(errorText);
    }

    function processCustomEvent(eventType: string, data: string): void {
      parseCustomEvent(eventType, data, cb);
    }

    const url = `${getApiUrl(profile)}/v1/chat/completions`;
    const requester = url.startsWith("https") ? https : http;
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
      url,
      {
        method: "POST",
        headers,
        signal: controller.signal,
        timeout: requestTimeoutMs,
      },
      (res) => {
        const sid = res.headers["x-hermes-session-id"];
        if (sid && typeof sid === "string") sessionId = sid;

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
