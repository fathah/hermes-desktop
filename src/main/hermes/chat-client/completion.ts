import http from "node:http";
import https from "node:https";
import { getApiServerKey, getModelConfig } from "../../config";
import { redactSensitiveData } from "../../security";
import { processSseData, type SseCallbacks } from "../../sse-parser";
import {
  getApiUrl,
  getRemoteAuthHeader,
  isRemoteMode,
} from "../gateway-process";
import type { ChatHandle } from "./messages";

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

/**
 * Streaming sibling of `chatCompletionOnce` for short, prompt-driven
 * completions (e.g. the Ask-pane "Answer"). Reuses the SAME SSE plumbing as the
 * main chat (`processSseData` + the `\n\n`-delimited block buffering) so there
 * is no second, divergent streaming mechanism — just without the chat session /
 * tool / approval machinery. Fires `onChunk` per content delta, `onDone` once,
 * or `onError` once. Returns a handle so the caller can abort.
 */
export function chatCompletionStream(
  messages: Array<{ role: string; content: string }>,
  cb: {
    onChunk: (text: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  },
  profile?: string,
): ChatHandle {
  const mc = getModelConfig(profile);
  const body = JSON.stringify({
    model: mc.model || "hermes-agent",
    messages,
    stream: true,
  });
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
  const url = `${getApiUrl(profile)}/v1/chat/completions`;
  const requester = url.startsWith("https") ? https : http;
  const controller = new AbortController();

  let finished = false;
  let hasContent = false;
  let lastError = "";
  function finish(error?: string): void {
    if (finished) return;
    finished = true;
    if (error) cb.onError(error);
    else cb.onDone();
  }
  // onDone stripped: processSseData fires it on `[DONE]`, but we own the single
  // terminal callback in finalize() — otherwise it would fire twice.
  const sseCb = { onChunk: cb.onChunk } as unknown as SseCallbacks;

  const req = requester.request(
    url,
    { method: "POST", headers, signal: controller.signal, timeout: 120000 },
    (res) => {
      function finalize(): void {
        if (finished) return;
        if (lastError && !hasContent) finish(lastError);
        else finish();
      }
      function handleBlock(block: string): void {
        if (finished || !block || !block.startsWith("data: ")) return;
        const data = block.slice(6);
        const state = { hasContent, lastError };
        const sseRes = processSseData(data, sseCb, state, {
          redact: redactSensitiveData,
          model: mc.model,
        });
        hasContent = state.hasContent;
        lastError = state.lastError;
        if (sseRes.done) finalize();
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
        // Keep what already streamed, but surface a late error as a trailing
        // notice (mirrors the main chat's MED-5 behaviour).
        if (lastError && hasContent) cb.onChunk(`\n\n⚠️ ${lastError}`);
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
    finish("Request timed out");
  });
  req.write(bodyBuf);
  req.end();

  return { abort: () => controller.abort() };
}
