import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "../src/main/config";

const transport = vi.hoisted(() => ({
  runs: false,
  requests: [] as string[],
  response: null as PassThrough | null,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-sse-utf8-test",
  HERMES_PYTHON: "/usr/bin/true",
  HERMES_REPO: "/tmp",
  hermesCliArgs: () => [],
  getEnhancedPath: () => "",
}));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({ mode: "remote", ssh: {} }),
  getModelConfig: () => ({ provider: "openrouter", model: "test-model" }),
  getConfigValue: () => null,
  readEnv: () => ({}),
}));
vi.mock("../src/main/models", () => ({ readModels: () => [] }));
vi.mock("../src/main/utils", () => ({ stripAnsi: (value: string) => value }));
vi.mock("../src/main/gatewayPrompt", () => ({
  promptSudoPassword: vi.fn(),
  promptSecretValue: vi.fn(),
}));
vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
}));
vi.mock("http", () => ({
  default: {
    request: (
      url: string,
      _options: unknown,
      callback: (response: PassThrough) => void,
    ) => {
      transport.requests.push(url);
      const response = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: { "x-hermes-session-id": "utf8-session" },
      });
      return Object.assign(new EventEmitter(), {
        write: () => undefined,
        destroy: () => response.destroy(),
        end: () =>
          queueMicrotask(() => {
            callback(response);
            if (url.endsWith("/v1/capabilities")) {
              response.end(
                JSON.stringify(
                  transport.runs
                    ? {
                        features: {
                          run_submission: true,
                          run_events_sse: true,
                          run_stop: true,
                          run_approval_response: true,
                          tool_progress_events: true,
                        },
                        endpoints: {
                          runs: { path: "/v1/runs" },
                          run_events: { path: "/v1/runs/{run_id}/events" },
                          run_stop: { path: "/v1/runs/{run_id}/stop" },
                          run_approval: { path: "/v1/runs/{run_id}/approval" },
                        },
                      }
                    : {},
                ),
              );
            } else if (url.endsWith("/v1/runs")) {
              response.end('{"run_id":"utf8-run"}');
            } else {
              transport.response = response;
            }
          }),
      });
    },
  },
}));

import { sendMessage, stopHealthPolling } from "../src/main/hermes";

afterEach(() => {
  transport.response?.destroy();
  stopHealthPolling();
});

describe.each(["chat completions", "runs"])("%s SSE UTF-8", (mode) => {
  // @lat: [[chat-commands#SSE byte decoding]]
  it.each(
    [1, 3, 4096].flatMap((size) => [
      { size, terminated: true },
      { size, terminated: false },
    ]),
  )(
    "preserves text with $size-byte chunks (terminal delimiter: $terminated)",
    async ({ size, terminated }) => {
      transport.runs = mode === "runs";
      transport.requests = [];
      transport.response = null;
      const chunks: string[] = [];
      const thoughts: string[] = [];
      const onError = vi.fn();
      const onDone = vi.fn();
      const connection = {
        mode: "remote",
        remoteUrl: `http://utf8-${crypto.randomUUID()}.test`,
        apiKey: "test-key",
        ssh: {},
      } as ConnectionConfig;
      await sendMessage(
        "hello",
        {
          onChunk: (text) => chunks.push(text),
          onReasoningChunk: (text) => thoughts.push(text),
          onError,
          onDone,
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        connection,
      );
      await vi.waitFor(() => expect(transport.response).not.toBeNull());

      const text = "中文 café 😀 日本語";
      const reasoning = "思考 🧠 résumé";
      const events = transport.runs
        ? [
            { event: "reasoning.available", text: reasoning },
            { event: "message.delta", delta: text },
            { event: "run.completed" },
          ]
        : [
            { choices: [{ delta: { reasoning_content: reasoning } }] },
            { choices: [{ delta: { content: text } }] },
            "[DONE]",
          ];
      const bytes = Buffer.from(
        events
          .map(
            (event) =>
              `data: ${typeof event === "string" ? event : JSON.stringify(event)}`,
          )
          .join("\n\n") + (terminated ? "\n\n" : ""),
      );
      for (let offset = 0; offset < bytes.length; offset += size) {
        transport.response!.write(bytes.subarray(offset, offset + size));
      }
      transport.response!.end();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
      expect(onError).not.toHaveBeenCalled();
      expect(chunks).toEqual([text]);
      expect(thoughts).toEqual([reasoning]);
      expect(transport.requests.map((url) => new URL(url).pathname)).toEqual(
        transport.runs
          ? ["/v1/capabilities", "/v1/runs", "/v1/runs/utf8-run/events"]
          : ["/v1/capabilities", "/v1/chat/completions"],
      );
    },
  );
});
