import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared state for capturing HTTP requests (hoisted before mocks) ──

const { capturedRequests, makeMockRequest } = vi.hoisted(() => {
  const capturedRequests: Array<{
    url: string;
    options: Record<string, unknown>;
    body: string;
  }> = [];

  function makeMockRequest(
    url: string,
    options: Record<string, unknown>,
  ): {
    write: (body: string) => void;
    end: () => void;
    on: (event: string, cb: () => void) => void;
    destroy: () => void;
  } {
    return {
      write: (body: string) => {
        capturedRequests.push({ url, options, body });
      },
      end: () => {},
      on: (_event: string, _cb: () => void) => {},
      destroy: () => {},
    };
  }

  return {
    capturedRequests,
    makeMockRequest,
  };
});

// ── Mock Node.js http/https modules ──

vi.mock("http", () => ({
  default: {
    request: (url: string, options: Record<string, unknown>) =>
      makeMockRequest(url, options),
  },
}));

vi.mock("https", () => ({
  default: {
    request: (url: string, options: Record<string, unknown>) =>
      makeMockRequest(url, options),
  },
}));

// ── Mock project dependencies ──

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-api-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: () => ["/dev/null"],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  getConfigValue: () => "",
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: "remote" as const,
    remoteUrl: "http://test-api.example.com",
    apiKey: "test-key",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  }),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
}));

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

// ── Import module under test ──

import {
  sendMessage,
  stopHealthPolling as realStopHealthPolling,
} from "../src/main/hermes";

describe("sendMessageViaApi forwards resumeSessionId", () => {
  beforeEach(() => {
    capturedRequests.length = 0;
  });

  afterEach(() => {
    realStopHealthPolling();
    capturedRequests.length = 0;
  });

  it("includes session_id in request body when resumeSessionId is provided", async () => {
    const testSessionId = "session-abc-123";

    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      testSessionId,
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const parsed = JSON.parse(chatRequest!.body);

    expect(parsed.session_id).toBe(testSessionId);
  });

  it("does not include session_id field when resumeSessionId is absent", async () => {
    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      undefined,
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const parsed = JSON.parse(chatRequest!.body);

    expect(parsed).not.toHaveProperty("session_id");
  });

  it("does not send empty string session_id when resumeSessionId is empty string", async () => {
    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      "",
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const parsed = JSON.parse(chatRequest!.body);

    expect(parsed).not.toHaveProperty("session_id");
  });

  it("sends the X-Hermes-Session-Id request header when resuming", async () => {
    const testSessionId = "session-abc-123";

    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      testSessionId,
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const headers = chatRequest!.options.headers as Record<string, string>;

    // The gateway resumes an existing session from this request header;
    // the session_id body field is ignored. Without it every request
    // forks a new server-side session (issue #226).
    expect(headers["X-Hermes-Session-Id"]).toBe(testSessionId);
  });

  it("generates a fresh `desk-`-prefixed X-Hermes-Session-Id when no resumeSessionId is passed", async () => {
    // Pin the new-chat session-id behaviour: instead of letting the
    // gateway fall back to its `_derive_chat_session_id` fingerprint
    // (sha256(system_prompt + first_user_message)[:16]), the desktop
    // generates `desk-<ms>-<uuid>` per fresh chat and ships it via the
    // header. The fingerprint collides across all chats whose first
    // message is the same — see NousResearch/hermes-agent#7484.
    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      undefined,
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const headers = chatRequest!.options.headers as Record<string, string>;

    expect(headers).toHaveProperty("X-Hermes-Session-Id");
    expect(headers["X-Hermes-Session-Id"]).toMatch(
      /^desk-\d{13,}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates a different X-Hermes-Session-Id on each fresh send (no fingerprint collision)", async () => {
    // The same first message twice MUST NOT produce the same session
    // id — the whole point of the fix.
    await sendMessage(
      "Hello there",
      { onChunk: () => {}, onDone: () => {}, onError: () => {} },
      "default",
      undefined,
    );
    await sendMessage(
      "Hello there",
      { onChunk: () => {}, onDone: () => {}, onError: () => {} },
      "default",
      undefined,
    );

    const chatRequests = capturedRequests.filter((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequests.length).toBeGreaterThanOrEqual(2);
    const ids = chatRequests.map(
      (r) =>
        (r.options.headers as Record<string, string>)["X-Hermes-Session-Id"],
    );
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
