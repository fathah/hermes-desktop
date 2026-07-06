import { describe, expect, it } from "vitest";
import {
  chatToolEventFromRunEvent,
  parseRunSseBlock,
  runCompletedUsage,
  runEventReasoningText,
  supportsHermesRunsTransport,
} from "../src/main/run-stream";

describe("supportsHermesRunsTransport", () => {
  it("requires the run features and endpoint paths", () => {
    expect(
      supportsHermesRunsTransport({
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
          run_approval: { path: "/v1/runs/{run_id}/approval" },
          run_stop: { path: "/v1/runs/{run_id}/stop" },
        },
      }),
    ).toBe(true);
  });

  it("rejects older gateways that only expose chat completions", () => {
    expect(
      supportsHermesRunsTransport({
        features: {
          chat_completions_streaming: true,
        },
        endpoints: {
          chat_completions: { path: "/v1/chat/completions" },
        },
      }),
    ).toBe(false);
  });

  it("rejects partial run support without stop", () => {
    expect(
      supportsHermesRunsTransport({
        features: {
          run_submission: true,
          run_events_sse: true,
          run_approval_response: true,
          tool_progress_events: true,
        },
        endpoints: {
          runs: { path: "/v1/runs" },
          run_events: { path: "/v1/runs/{run_id}/events" },
          run_approval: { path: "/v1/runs/{run_id}/approval" },
        },
      }),
    ).toBe(false);
  });
});

describe("run stream event mapping", () => {
  it("maps reasoning events to reasoning text", () => {
    expect(
      runEventReasoningText({
        event: "reasoning.available",
        text: "thinking...",
      }),
    ).toBe("thinking...");
  });

  it("maps run tool lifecycle events to chat tool events", () => {
    expect(
      chatToolEventFromRunEvent({
        event: "tool.started",
        run_id: "run_1",
        tool: "terminal",
        preview: "npm test",
      }),
    ).toEqual({
      callId: "run_1:terminal",
      hasStableCallId: false,
      name: "terminal",
      status: "running",
      preview: "npm test",
    });

    expect(
      chatToolEventFromRunEvent({
        event: "tool.completed",
        run_id: "run_1",
        tool: "terminal",
        result_text: "ok",
      }),
    ).toEqual({
      callId: "run_1:terminal",
      hasStableCallId: false,
      name: "terminal",
      status: "completed",
      result: "ok",
    });
  });

  it("maps run.completed usage to renderer usage fields", () => {
    expect(
      runCompletedUsage({
        event: "run.completed",
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18,
        },
      }),
    ).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });

  it("parses data-only SSE blocks with CRLF line endings", () => {
    expect(parseRunSseBlock('data: {"event":"message.delta"}\r\n\r\n')).toEqual(
      {
        eventType: "",
        data: '{"event":"message.delta"}',
      },
    );
  });
});
