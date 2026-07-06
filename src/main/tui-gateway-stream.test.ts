import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gatewayCompletionSuffix,
  gatewayMessageCompleteText,
  gatewayMessageDelta,
  gatewayReasoningText,
  gatewayToolEvent,
  gatewayUsage,
} from "./tui-gateway-stream";

// Mocks so hermes.ts (which transitively reaches electron via ./installer) can
// be imported under vitest for the gateway-env regression tests below. Only
// the names hermes.ts imports from each module need to exist.
vi.mock("./installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
  HERMES_REPO: "/tmp/hermes-test-repo",
  HERMES_PYTHON: "/usr/bin/python3",
  hermesCliArgs: vi.fn(() => []),
  getEnhancedPath: vi.fn(() => "/usr/bin"),
}));
vi.mock("./config", () => ({
  getApiServerKey: vi.fn(() => null),
  getConnectionConfig: vi.fn(() => ({})),
  getConfigValue: vi.fn(() => null),
  getModelConfig: vi.fn(() => ({})),
  readEnv: vi.fn(() => ({})),
}));
vi.mock("./ssh-tunnel", () => ({
  getSshTunnelUrl: vi.fn(() => null),
  isSshTunnelActive: vi.fn(() => false),
  isSshTunnelHealthy: vi.fn(() => false),
  startSshTunnel: vi.fn(),
}));
vi.mock("./utils", () => ({
  pidIsAliveAs: vi.fn(() => false),
  stripAnsi: (s: string) => s,
  profileHome: vi.fn(() => "/tmp/hermes-test-home"),
  // A nonexistent configFile makes ensureApiServerConfig a no-op.
  profilePaths: vi.fn(() => ({
    configFile: "/nonexistent/hermes-test/config.yaml",
  })),
  normalizeProfileName: (p?: string) => p,
  getActiveProfileNameSync: vi.fn(() => undefined),
}));
vi.mock("./gateway-ports", () => ({ getProfilePort: vi.fn(() => 8642) }));
vi.mock("./models", () => ({ readModels: vi.fn(() => []) }));
vi.mock("./secrets", () => ({ providerListSafe: vi.fn(() => ({})) }));

import { readEnv } from "./config";
import { providerListSafe } from "./secrets";
import { buildGatewayEnv, tuiGatewayEnv } from "./hermes";

describe("tui gateway stream mapping", () => {
  it("maps message and reasoning deltas", () => {
    expect(
      gatewayMessageDelta({
        type: "message.delta",
        payload: { text: "hello" },
      }),
    ).toBe("hello");
    expect(
      gatewayReasoningText({
        type: "reasoning.delta",
        payload: { text: "thinking" },
      }),
    ).toBe("thinking");
    expect(
      gatewayMessageCompleteText({
        type: "message.complete",
        payload: { rendered: "final" },
      }),
    ).toBe("final");
  });

  it("uses completion text when streamed deltas were only whitespace", () => {
    expect(gatewayCompletionSuffix("\n  ", "final answer")).toBe(
      "final answer",
    );
  });

  it("only appends the missing suffix when completion repeats streamed text", () => {
    expect(gatewayCompletionSuffix("hello", "hello world")).toBe(" world");
    expect(gatewayCompletionSuffix("hello world", "hello world")).toBe("");
  });

  it("does not duplicate unrelated completion text after visible stream text", () => {
    expect(gatewayCompletionSuffix("partial answer", "different answer")).toBe(
      "",
    );
  });

  it("ignores reasoning.available previews for live reasoning", () => {
    expect(
      gatewayReasoningText({
        type: "reasoning.available",
        payload: { text: "final answer preview" },
      }),
    ).toBe("");
  });

  it("maps stable tool start and complete events with result payloads", () => {
    expect(
      gatewayToolEvent({
        type: "tool.start",
        session_id: "s1",
        payload: {
          args_text: "curl http://127.0.0.1",
          name: "terminal",
          tool_id: "call-1",
        },
      }),
    ).toMatchObject({
      callId: "call-1",
      hasStableCallId: true,
      name: "terminal",
      preview: "curl http://127.0.0.1",
      status: "running",
    });

    expect(
      gatewayToolEvent({
        type: "tool.complete",
        session_id: "s1",
        payload: {
          name: "terminal",
          result_text: "ok",
          tool_id: "call-1",
        },
      }),
    ).toMatchObject({
      callId: "call-1",
      name: "terminal",
      result: "ok",
      status: "completed",
    });
  });

  it("formats structured tool results when result_text is absent", () => {
    const mapped = gatewayToolEvent({
      type: "tool.complete",
      payload: {
        name: "skill_view",
        result: { answer: "done" },
        tool_id: "call-2",
      },
    });

    expect(mapped?.result).toContain('"answer": "done"');
  });

  it("maps message completion usage", () => {
    expect(
      gatewayUsage({
        type: "message.complete",
        payload: {
          usage: {
            cache_read: 2,
            cache_write: 3,
            input: 10,
            output: 5,
            total: 15,
          },
        },
      }),
    ).toEqual({
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      completionTokens: 5,
      promptTokens: 10,
      totalTokens: 15,
    });
  });
});

describe("gateway env builders consult the secrets provider", () => {
  // Regression: provider-resolved secrets were injected only on the CLI
  // fallback path; buildGatewayEnv/tuiGatewayEnv read only readEnv(), so a
  // command-provider user got a gateway with silently missing API keys.
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.mocked(readEnv).mockReset().mockReturnValue({});
    vi.mocked(providerListSafe).mockReset().mockReturnValue({});
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it("buildGatewayEnv injects a provider-resolved key absent from process.env and .env", () => {
    vi.mocked(providerListSafe).mockReturnValue({
      ANTHROPIC_API_KEY: "from-provider",
    });
    expect(buildGatewayEnv().ANTHROPIC_API_KEY).toBe("from-provider");
  });

  it("buildGatewayEnv keeps the .env value when both .env and provider have the key", () => {
    vi.mocked(readEnv).mockReturnValue({ ANTHROPIC_API_KEY: "from-dotenv" });
    vi.mocked(providerListSafe).mockReturnValue({
      ANTHROPIC_API_KEY: "from-provider",
    });
    expect(buildGatewayEnv().ANTHROPIC_API_KEY).toBe("from-dotenv");
  });

  it("buildGatewayEnv keeps the process.env value over the provider's", () => {
    process.env.ANTHROPIC_API_KEY = "from-process-env";
    vi.mocked(providerListSafe).mockReturnValue({
      ANTHROPIC_API_KEY: "from-provider",
    });
    expect(buildGatewayEnv().ANTHROPIC_API_KEY).toBe("from-process-env");
  });

  it("tuiGatewayEnv injects a provider-resolved key absent from process.env and .env", () => {
    vi.mocked(providerListSafe).mockReturnValue({
      ANTHROPIC_API_KEY: "from-provider",
    });
    expect(tuiGatewayEnv().ANTHROPIC_API_KEY).toBe("from-provider");
  });

  it("tuiGatewayEnv keeps the .env value when both .env and provider have the key", () => {
    vi.mocked(readEnv).mockReturnValue({ ANTHROPIC_API_KEY: "from-dotenv" });
    vi.mocked(providerListSafe).mockReturnValue({
      ANTHROPIC_API_KEY: "from-provider",
    });
    expect(tuiGatewayEnv().ANTHROPIC_API_KEY).toBe("from-dotenv");
  });
});
