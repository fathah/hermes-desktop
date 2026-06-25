import { beforeEach, describe, expect, it, vi } from "vitest";

const { capturedRequests, state, makeMockRequest } = vi.hoisted(() => {
  const capturedRequests: Array<{
    url: string;
    options: Record<string, unknown>;
    body: string;
  }> = [];
  const state = {
    remoteMode: true,
    apiAvailable: true as boolean | null,
    apiReady: true,
    localGatewayRunning: false,
  };

  function makeMockRequest(
    url: string,
    options: Record<string, unknown>,
  ): {
    write: (body: string | Buffer) => void;
    end: () => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    destroy: () => void;
    setTimeout: (timeout: number) => void;
  } {
    return {
      write: (body: string | Buffer) => {
        capturedRequests.push({
          url,
          options,
          body: Buffer.isBuffer(body) ? body.toString("utf-8") : body,
        });
      },
      end: () => {},
      on: () => {},
      destroy: () => {},
      setTimeout: () => {},
    };
  }

  return { capturedRequests, state, makeMockRequest };
});

vi.mock("node:http", () => ({
  default: {
    request: (url: string, options: Record<string, unknown>) =>
      makeMockRequest(url, options),
  },
}));

vi.mock("node:https", () => ({
  default: {
    request: (url: string, options: Record<string, unknown>) =>
      makeMockRequest(url, options),
  },
}));

vi.mock("../src/main/hermes/gateway-process", async (importActual) => {
  const actual =
    await importActual<typeof import("../src/main/hermes/gateway-process")>();
  return {
    ...actual,
    getApiUrl: () => "http://test-api.example.com",
    getRemoteAuthHeader: () =>
      state.remoteMode ? { Authorization: "Bearer remote" } : {},
    isRemoteMode: () => state.remoteMode,
    isApiServerReady: () => Promise.resolve(state.apiReady),
    waitForApiServerReady: () => Promise.resolve(state.apiReady),
    isGatewayRunning: () => state.localGatewayRunning,
    getApiServerAvailable: () => state.apiAvailable,
    setApiServerAvailable: (value: boolean) => {
      state.apiAvailable = value;
    },
    startHealthPolling: vi.fn(),
    resolveProfile: (profile?: string) => profile || "default",
  };
});

vi.mock("../src/main/config", () => ({
  getApiServerKey: () => "local-key",
  getModelConfig: () => ({
    model: "test-model",
    provider: "openai",
    baseUrl: "",
  }),
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: state.remoteMode ? "remote" : "local",
  }),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test",
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/tmp/hermes-agent",
  hermesCliArgs: () => ["/tmp/hermes-agent"],
  getEnhancedPath: () => process.env.PATH || "",
  getHermesVersion: () => Promise.resolve("test-version"),
}));

vi.mock("../src/main/security/shell-hooks", () => ({
  ShellHookManager: {
    runHook: vi.fn(async () => ({ action: "allow" })),
  },
}));

vi.mock("../src/main/active-skills", () => ({
  buildActiveSkillsSystemMessage: () => null,
}));

vi.mock("../src/main/tools", () => ({
  getToolsets: () => [],
}));

vi.mock("../src/main/skills", () => ({
  listInstalledSkills: () => [],
}));

vi.mock("../src/main/db", () => ({
  getSharedDb: () => null,
}));

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
}));

import {
  sendMessage,
  type ChatCallbacks,
} from "../src/main/hermes/chat-client";

const callbacks: ChatCallbacks = {
  onChunk: () => {},
  onDone: () => {},
  onError: () => {},
};

const history = [
  { role: "user", content: "first question" },
  { role: "agent", content: "first answer" },
];

async function latestRequestBody(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => {
    expect(capturedRequests.length).toBeGreaterThan(0);
  });
  return JSON.parse(capturedRequests.at(-1)!.body) as Record<string, unknown>;
}

function assertHistoryPreserved(body: Record<string, unknown>): void {
  const messages = body.messages as Array<{ role: string; content: string }>;
  const userIndex = messages.findIndex(
    (msg) => msg.role === "user" && msg.content === "first question",
  );
  const assistantIndex = messages.findIndex(
    (msg) => msg.role === "assistant" && msg.content === "first answer",
  );
  const currentIndex = messages.findIndex(
    (msg) => msg.role === "user" && msg.content === "follow up",
  );

  expect(userIndex).toBeGreaterThanOrEqual(0);
  expect(assistantIndex).toBeGreaterThan(userIndex);
  expect(currentIndex).toBeGreaterThan(assistantIndex);
  expect(messages.at(-1)).toMatchObject({ role: "user", content: "follow up" });
}

describe("Remote/SSH Mode History Preservation", () => {
  beforeEach(() => {
    capturedRequests.length = 0;
    state.remoteMode = true;
    state.apiAvailable = true;
    state.apiReady = true;
    state.localGatewayRunning = false;
  });

  it("serializes prior turns before the current user message in remote mode", async () => {
    await sendMessage("follow up", callbacks, "default", undefined, history);

    const body = await latestRequestBody();
    assertHistoryPreserved(body);
  });

  it("serializes prior turns before the current user message in the local API path", async () => {
    state.remoteMode = false;
    state.apiAvailable = true;

    await sendMessage("follow up", callbacks, "default", undefined, history);

    const body = await latestRequestBody();
    assertHistoryPreserved(body);
  });
});
