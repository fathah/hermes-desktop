import { act, render, waitFor } from "@testing-library/react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { DashboardRpcEvent } from "../dashboardGatewayClient";
import { useDashboardChatTransport } from "./useDashboardChatTransport";
import { useTranscriptState } from "./useTranscriptState";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";

type SetUsageMock = Mock<(value: SetStateAction<UsageState | null>) => void>;

const dashboardMock = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(async () => undefined),
  instances: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    connected: boolean;
    request: ReturnType<typeof vi.fn>;
  }>,
  onClose: null as (() => void) | null,
  onEvent: null as ((event: DashboardRpcEvent) => void) | null,
  request: vi.fn(),
}));

vi.mock("../dashboardGatewayClient", () => ({
  DashboardGatewayClient: class MockDashboardGatewayClient {
    close = dashboardMock.close;
    connect = dashboardMock.connect;
    connected = true;
    request = dashboardMock.request;

    constructor(
      options: {
        onEvent?: (event: DashboardRpcEvent) => void;
        onClose?: () => void;
      } = {},
    ) {
      dashboardMock.onEvent = options.onEvent ?? null;
      dashboardMock.onClose = options.onClose ?? null;
      dashboardMock.instances.push(this);
    }
  },
}));

interface HarnessApi {
  isLoading?: boolean;
  activeTurnRef?: MutableRefObject<ActiveTurn | null>;
  abort?: () => void;
  messages?: ChatMessage[];
  respondClarify?: ReturnType<
    typeof useDashboardChatTransport
  >["respondClarify"];
  respondApproval?: ReturnType<
    typeof useDashboardChatTransport
  >["respondApproval"];
  send?: (text: string) => Promise<boolean>;
  setConnectionMode?: Dispatch<SetStateAction<"local" | "remote" | "ssh">>;
  setMessages?: Dispatch<SetStateAction<ChatMessage[]>>;
  setModel?: Dispatch<SetStateAction<string>>;
  setProvider?: Dispatch<SetStateAction<string>>;
}

const activeBadTurn: ActiveTurn = {
  startIndex: 0,
  status: "running",
  turnId: "turn-bad",
  userId: "u-bad",
};

const activeRecoveryTurn: ActiveTurn = {
  startIndex: 2,
  status: "running",
  turnId: "turn-recovery",
  userId: "u-recovery",
};

function Harness({
  api,
  connectionId,
  connectionRevision,
  fallbackOnUnavailable = false,
  initialConnectionMode = "local",
  onDashboardUnavailable,
  setUsage = vi.fn() as SetUsageMock,
}: {
  api: HarnessApi;
  connectionId?: string;
  connectionRevision?: number;
  fallbackOnUnavailable?: boolean;
  initialConnectionMode?: "local" | "remote" | "ssh";
  onDashboardUnavailable?: (reason: string) => void;
  setUsage?: SetUsageMock;
}): null {
  // Same write-through transcript state Chat.tsx uses — the transport's
  // coalescing contract requires setMessages and messagesRef to be paired.
  const { messages, setMessages, messagesRef } = useTranscriptState([
    {
      id: "u-bad",
      role: "user",
      content: "bad provider turn",
      turnId: "turn-bad",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState("bad-model");
  const [provider, setProvider] = useState("bad-provider");
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >(initialConnectionMode);
  const activeTurnRef = useRef<ActiveTurn | null>({ ...activeBadTurn });
  const transport = useDashboardChatTransport({
    activeTurnRef,
    connectionId,
    connectionRevision,
    contextFolder: null,
    connectionMode,
    enabled: true,
    fallbackOnUnavailable,
    hermesSessionId: null,
    messagesRef,
    model,
    profile: undefined,
    provider,
    setHermesSessionId: vi.fn(),
    setIsLoading,
    setMessages,
    setToolProgress: vi.fn(),
    setUsage,
    onDashboardUnavailable,
  });

  useEffect(() => {
    // Bridge the hook's live values out to the test via the shared `api`
    // object. Object.assign mutates it in place (same reference the test
    // holds) without per-prop assignment, which the immutability rule rejects.
    Object.assign(api, {
      isLoading,
      activeTurnRef,
      abort: transport.abort,
      messages,
      respondApproval: transport.respondApproval,
      respondClarify: transport.respondClarify,
      send: transport.sendMessage,
      setConnectionMode,
      setMessages,
      setModel,
      setProvider,
    });
  }, [
    isLoading,
    activeTurnRef,
    api,
    messages,
    setConnectionMode,
    setMessages,
    transport.sendMessage,
    transport.respondApproval,
    transport.respondClarify,
    transport.abort,
  ]);

  return null;
}

describe("useDashboardChatTransport recovery", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        freshDashboardWsUrl: vi.fn(async () => "ws://fresh-dashboard"),
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
      },
    });
  });

  async function clarifyHarness(): Promise<HarnessApi> {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create")
        return { session_id: "live", stored_session_id: "stored" };
      if (method === "model.options")
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      if (method === "clarify.respond") return { status: "ok" };
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "clarify.request",
        session_id: "live",
        payload: {
          request_id: "q1",
          question: "Where?",
          choices: ["staging", "production"],
        },
      });
    });
    return api;
  }

  // @lat: [[dashboard-clarify#Gateway answer delivery]]
  it.each(["staging", "custom answer", ""])(
    "delivers a dashboard clarification answer %j",
    async (answer) => {
      const api = await clarifyHarness();
      expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
        choices: ["staging", "production"],
      });
      await act(async () => {
        expect(await api.respondClarify?.("q1", answer)).toBe(true);
      });
      expect(dashboardMock.request).toHaveBeenCalledWith("clarify.respond", {
        request_id: "q1",
        answer,
      });
      expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
        resolved: true,
        answer,
      });
    },
  );

  // @lat: [[dashboard-clarify#Consecutive questions]]
  it("preserves the next question when the prior reply acknowledgement arrives late", async () => {
    const api = await clarifyHarness();
    let finish!: (value: { status: string }) => void;
    dashboardMock.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let reply!: Promise<boolean>;
    await act(async () => {
      reply = api.respondClarify!("q1", "staging");
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "clarify.request",
        session_id: "live",
        payload: {
          request_id: "q2",
          question: "Region?",
          choices: ["EU", "US"],
        },
      });
    });
    await act(async () => {
      finish({ status: "ok" });
      expect(await reply).toBe(true);
    });
    expect(
      api.messages?.find((m) => m.kind === "clarify" && m.requestId === "q1"),
    ).toMatchObject({ resolved: true, unavailable: false });
    await act(async () => {
      expect(await api.respondClarify!("q2", "EU")).toBe(true);
    });
    expect(dashboardMock.request).toHaveBeenLastCalledWith("clarify.respond", {
      request_id: "q2",
      answer: "EU",
    });
  });

  // @lat: [[dashboard-clarify#Disconnect during answer]]
  it("releases the busy turn when the socket closes before clarify RPC rejects", async () => {
    const api = await clarifyHarness();
    let reject!: (reason: Error) => void;
    dashboardMock.request.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    let answer!: Promise<boolean>;
    act(() => {
      answer = api.respondClarify!("q1", "yes");
    });
    expect(api.isLoading).toBe(true);
    await act(async () => {
      dashboardMock.onClose?.();
      reject(new Error("socket closed"));
      await answer;
    });
    expect(api.isLoading).toBe(false);
    expect(api.activeTurnRef?.current).toBeNull();
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: true,
    });
    await act(async () => {
      expect(await api.send?.("retry after disconnect")).toBe(true);
    });
  });

  // @lat: [[dashboard-clarify#Stale request isolation]]
  it.each(["answered", "completed"])(
    "preserves the next question when an %s question is replayed",
    async (state) => {
      const api = await clarifyHarness();
      await act(async () => {
        if (state === "answered") await api.respondClarify!("q1", "staging");
        else
          dashboardMock.onEvent?.({
            type: "message.complete",
            session_id: "live",
            payload: { text: "Done" },
          });
        dashboardMock.onEvent?.({
          type: "clarify.request",
          session_id: "live",
          payload: { request_id: "q2", question: "Region?", choices: ["EU"] },
        });
        dashboardMock.onEvent?.({
          type: "clarify.request",
          session_id: "live",
          payload: {
            request_id: "q1",
            question: "Where?",
            choices: ["staging"],
          },
        });
      });
      expect(
        api.messages?.find((m) => m.kind === "clarify" && m.requestId === "q2"),
      ).toMatchObject({ unavailable: false });
      await act(async () => {
        expect(await api.respondClarify!("q2", "EU")).toBe(true);
      });
    },
  );

  // @lat: [[dashboard-clarify#In-flight request replay]]
  it("keeps a resumed turn busy when its question is replayed during delivery", async () => {
    const api = await clarifyHarness();
    let finish!: (value: { status: string }) => void;
    dashboardMock.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let reply!: Promise<boolean>;
    act(() => {
      reply = api.respondClarify!("q1", "staging");
    });
    const resumedTurn = api.activeTurnRef?.current;
    act(() => {
      dashboardMock.onEvent?.({
        type: "clarify.request",
        session_id: "live",
        payload: { request_id: "q1", question: "Where?", choices: ["staging"] },
      });
    });
    expect(api.isLoading).toBe(true);
    expect(api.activeTurnRef?.current).toBe(resumedTurn);
    await act(async () => {
      finish({ status: "ok" });
      await reply;
    });
  });

  // @lat: [[dashboard-clarify#Gateway expiration]]
  it("expires only the matching question and tracks the agent resuming after timeout", async () => {
    const api = await clarifyHarness();
    act(() => {
      dashboardMock.onEvent?.({
        type: "clarify.expire",
        session_id: "live",
        payload: { request_id: "old" },
      });
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: false,
    });
    act(() => {
      dashboardMock.onEvent?.({
        type: "clarify.expire",
        session_id: "other",
        payload: { request_id: "q1" },
      });
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: false,
    });
    act(() => {
      dashboardMock.onEvent?.({
        type: "clarify.expire",
        session_id: "live",
        payload: { request_id: "q1" },
      });
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: true,
    });
    expect(api.isLoading).toBe(true);
    expect(api.activeTurnRef?.current?.turnId).toBe("turn-bad");
    await act(async () => {
      expect(await api.respondClarify!("q1", "staging")).toBe(false);
    });
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "clarify.respond",
      ),
    ).toBe(false);
    act(() => {
      dashboardMock.onEvent?.({
        type: "message.complete",
        session_id: "live",
        payload: { text: "Continued after timeout" },
      });
    });
    expect(api.isLoading).toBe(false);
    expect(api.activeTurnRef?.current).toBeNull();
  });

  // @lat: [[dashboard-clarify#Composer fallback]]
  it("uses the same delivery path when answering through the composer", async () => {
    const api = await clarifyHarness();
    await act(async () => {
      await api.send?.("production");
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      resolved: true,
      answer: "production",
    });
    expect(
      dashboardMock.request.mock.calls.filter(
        ([method]) => method === "clarify.respond",
      ),
    ).toHaveLength(1);
  });

  // @lat: [[dashboard-clarify#Retry and duplicate answers]]
  it("keeps a failed answer retryable and blocks concurrent card/composer replies", async () => {
    const api = await clarifyHarness();
    let reject!: (reason: Error) => void;
    dashboardMock.request.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    let first!: Promise<boolean>;
    await act(async () => {
      first = api.respondClarify!("q1", "staging");
      expect(await api.respondClarify!("q1", "production")).toBe(false);
    });
    await act(async () => {
      reject(new Error("offline"));
      expect(await first).toBe(false);
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).not.toHaveProperty(
      "resolved",
      true,
    );
    await act(async () => {
      expect(await api.respondClarify!("q1", "production")).toBe(true);
    });
  });

  // @lat: [[dashboard-clarify#Expired answers]]
  it("does not report an expired RPC as a successfully delivered answer", async () => {
    const api = await clarifyHarness();
    dashboardMock.request.mockResolvedValueOnce({ status: "expired" });
    await act(async () => {
      expect(await api.respondClarify!("q1", "staging")).toBe(false);
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: true,
    });
  });

  // @lat: [[dashboard-clarify#Connection isolation]]
  it("invalidates pending clarification cards when the connection changes", async () => {
    const api = await clarifyHarness();
    await act(async () => {
      api.setConnectionMode?.("remote");
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: true,
    });
    await act(async () => {
      expect(await api.respondClarify!("q1", "staging")).toBe(false);
    });
    expect(
      dashboardMock.request.mock.calls.filter(
        ([method]) => method === "clarify.respond",
      ),
    ).toHaveLength(0);
  });

  // @lat: [[dashboard-clarify#Completed turns and replay]]
  it("does not reopen a completed turn's question when the request is replayed", async () => {
    const api = await clarifyHarness();
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "message.complete",
        session_id: "live",
        payload: { text: "Done" },
      });
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "clarify.request",
        session_id: "live",
        payload: { request_id: "q1", question: "Where?", choices: ["staging"] },
      });
    });
    expect(api.messages?.find((m) => m.kind === "clarify")).toMatchObject({
      unavailable: true,
    });
    await act(async () => {
      expect(await api.respondClarify!("q1", "staging")).toBe(false);
    });
  });

  it("requests a fresh WebSocket URL immediately before connecting", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") {
        return { session_id: "live", stored_session_id: "stored" };
      }
      return {};
    });
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        connectionId="connection-two"
        initialConnectionMode="remote"
      />,
    );

    await act(async () => {
      await api.send?.("hello");
    });

    expect(window.hermesAPI.freshDashboardWsUrl).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.startDashboard).toHaveBeenCalledWith(
      undefined,
      "connection-two",
    );
    expect(window.hermesAPI.freshDashboardWsUrl).toHaveBeenCalledWith(
      undefined,
      "connection-two",
    );
    expect(dashboardMock.connect).toHaveBeenCalledWith("ws://fresh-dashboard");
  });

  it("does not request model.options twice when no model switch runs", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") {
        return { session_id: "live", stored_session_id: "stored" };
      }
      if (method === "model.options") {
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      }
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} />);

    await act(async () => {
      await api.send?.("first");
      await api.send?.("second");
    });

    const methods = dashboardMock.request.mock.calls.map(([method]) => method);
    expect(methods.filter((method) => method === "slash.exec")).toHaveLength(1);
    expect(methods.filter((method) => method === "model.options")).toHaveLength(
      3,
    );
  });

  it("surfaces OAuth login requirements without legacy fallback", async () => {
    // @lat: [[remote-dashboard-oauth#Test specifications#OAuth no-fallback]]
    const onUnavailable = vi.fn();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          running: false,
          needsOAuthLogin: true,
          error: "Sign in with your browser.",
          connection: { authMode: "oauth", wsUrl: "" },
        })),
      },
    });
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="remote"
        fallbackOnUnavailable
        onDashboardUnavailable={onUnavailable}
      />,
    );

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.send?.("hello");
    });

    expect(handled).toBe(true);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a clean runtime after a failed provider turn", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    let liveModel = "bad-model";
    let liveProvider = "bad-provider";
    dashboardMock.request.mockImplementation(async (method, params) => {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-bad", stored_session_id: "stored-chat" };
      }
      if (method === "session.resume") {
        return { session_id: "live-recovery", resumed: "stored-chat" };
      }
      if (method === "slash.exec") {
        const command =
          params && typeof params === "object" && "command" in params
            ? String(params.command)
            : "";
        const match = command.match(/^\/model\s+(.+?)\s+--provider\s+(.+)$/);
        if (match) {
          liveModel = match[1];
          liveProvider = match[2];
        }
        return {};
      }
      if (method === "model.options") {
        return { model: liveModel, provider: liveProvider, providers: [] };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);

    await act(async () => {
      await api.send?.("bad provider turn");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {
          error: "Invalid API Key",
          status: "error",
        },
        session_id: "live-bad",
        type: "message.complete",
      });
    });

    const badSend = api.send;
    await act(async () => {
      api.setProvider?.("good-provider");
      api.setModel?.("good-model");
      api.activeTurnRef!.current = { ...activeRecoveryTurn };
      api.setMessages?.((prev) => [
        ...prev,
        {
          id: "u-recovery",
          role: "user",
          content: "recovery turn",
          turnId: "turn-recovery",
        },
      ]);
    });
    await waitFor(() => expect(api.send).not.toBe(badSend));

    await act(async () => {
      await api.send?.("recovery turn");
    });

    expect(requests).not.toContainEqual({
      method: "session.resume",
      params: { session_id: "stored-chat", cols: 96 },
    });
    expect(
      requests.filter((request) => request.method === "session.create"),
    ).toEqual([
      { method: "session.create", params: { cols: 96 } },
      { method: "session.create", params: { cols: 96 } },
    ]);
    expect(requests).not.toContainEqual({
      method: "session.create",
      params: {
        cols: 96,
        messages: [
          { role: "user", content: "bad provider turn" },
          { role: "assistant", content: "Error: Invalid API Key" },
        ],
      },
    });
    expect(window.hermesAPI.recordSessionLocalError).toHaveBeenCalledWith(
      "stored-chat",
      {
        error: "Invalid API Key",
        userContent: "bad provider turn",
      },
    );
    expect(window.hermesAPI.recordSessionContinuation).toHaveBeenCalledWith(
      "stored-chat",
      [
        { kind: "user", content: "bad provider turn" },
        { kind: "assistant", content: "", error: "Invalid API Key" },
      ],
    );
  });

  it("discards an in-flight dashboard client after the connection mode changes", async () => {
    let releaseFirstConnect: (() => void) | null = null;
    const requests: Array<{ method: string; params: unknown }> = [];

    dashboardMock.connect
      .mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            releaseFirstConnect = () => resolve(undefined);
          }),
      )
      .mockImplementation(async () => undefined);
    dashboardMock.request.mockImplementation(async (method, params) => {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-new", stored_session_id: "stored-new" };
      }
      if (method === "model.options") {
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      }
      return {};
    });

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi
          .fn()
          .mockResolvedValueOnce({
            connection: { wsUrl: "ws://old-dashboard" },
            running: true,
          })
          .mockResolvedValue({
            connection: { wsUrl: "ws://new-dashboard" },
            running: true,
          }),
      },
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);

    let firstSend: Promise<boolean> | null = null;
    await act(async () => {
      firstSend = api.send?.("first prompt") ?? null;
    });
    await waitFor(() =>
      expect(window.hermesAPI.startDashboard).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      api.setConnectionMode?.("remote");
    });

    await act(async () => {
      releaseFirstConnect?.();
      await firstSend;
    });

    expect(dashboardMock.close).toHaveBeenCalled();

    await act(async () => {
      api.activeTurnRef!.current = {
        startIndex: api.messages?.length ?? 0,
        status: "running",
        turnId: "turn-new",
        userId: "u-new",
      };
      api.setMessages?.((prev) => [
        ...prev,
        {
          id: "u-new",
          role: "user",
          content: "new prompt",
          turnId: "turn-new",
        },
      ]);
    });

    await act(async () => {
      await api.send?.("new prompt");
    });

    expect(dashboardMock.connect).toHaveBeenNthCalledWith(
      1,
      "ws://old-dashboard",
    );
    expect(dashboardMock.connect).toHaveBeenNthCalledWith(
      2,
      "ws://new-dashboard",
    );
    expect(requests.map((request) => request.method)).toContain(
      "prompt.submit",
    );
  });
});

describe("useDashboardChatTransport approvals", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      if (method === "model.options")
        return { provider: "bad-provider", model: "bad-model" };
      if (method === "approval.respond") return { resolved: 1 };
      return {};
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
      },
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("responds only to the pending offered choice and clears after ack", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: {
          request_id: "approval-1",
          command: "npm publish",
          choices: ["once"],
        },
      });
    });

    await expect(api.respondApproval?.("approval-1", "always")).resolves.toBe(
      false,
    );
    await expect(api.respondApproval?.("approval-1", "once")).resolves.toBe(
      true,
    );
    expect(dashboardMock.request).toHaveBeenCalledWith("approval.respond", {
      session_id: "live-1",
      request_id: "approval-1",
      choice: "once",
      all: false,
    });
    await expect(api.respondApproval?.("approval-1", "once")).resolves.toBe(
      false,
    );
  });

  it("keeps a failed response pending for retry", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { request_id: "approval-2", choices: ["deny"] },
      });
    });
    dashboardMock.request.mockRejectedValueOnce(new Error("offline"));

    await expect(api.respondApproval?.("approval-2", "deny")).resolves.toBe(
      false,
    );
    dashboardMock.request.mockResolvedValueOnce({ resolved: 1 });
    await expect(api.respondApproval?.("approval-2", "deny")).resolves.toBe(
      true,
    );
  });

  // @lat: [[chat-commands#Structured command approvals#Stale approval isolation]]
  it.each(["expired", "lost acknowledgement"])(
    "never applies a %s approval to the next queued command",
    async (failure) => {
      const api: HarnessApi = {};
      const serverPending = new Set(["first", "second"]);
      const approved: string[] = [];
      let loseAck = failure === "lost acknowledgement";
      render(<Harness api={api} />);
      await act(async () => {
        await api.send?.("hello");
        for (const request_id of serverPending) {
          dashboardMock.onEvent?.({
            type: "approval.request",
            session_id: "live-1",
            payload: { request_id, choices: ["once"] },
          });
        }
      });
      if (failure === "expired") serverPending.delete("first");
      dashboardMock.request.mockImplementation(
        async (method: string, params: Record<string, unknown>) => {
          if (method !== "approval.respond") return {};
          // Match the upstream resolver: omitting request_id consumes the FIFO head.
          const target = String(
            params.request_id ?? serverPending.values().next().value,
          );
          if (!serverPending.delete(target)) return { resolved: 0 };
          approved.push(target);
          if (loseAck) {
            loseAck = false;
            throw new Error("acknowledgement lost");
          }
          return { resolved: 1 };
        },
      );
      await act(async () => {
        expect(await api.respondApproval?.("first", "once")).toBe(false);
        if (failure === "lost acknowledgement")
          expect(await api.respondApproval?.("first", "once")).toBe(false);
      });
      expect(serverPending.has("second")).toBe(true);
      expect(approved).not.toContain("second");
      expect(dashboardMock.request).toHaveBeenCalledWith("session.interrupt", {
        session_id: "live-1",
      });
      expect(await api.respondApproval?.("second", "once")).toBe(false);
      expect(
        api.messages
          ?.filter((msg) => msg.kind === "approval")
          .every((msg) => msg.kind === "approval" && msg.unavailable),
      ).toBe(true);
    },
  );

  it("stops an approval that has no gateway-issued request ID", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { id: "display-only", command: "npm publish" },
      });
    });
    expect(await api.respondApproval?.("display-only", "once")).toBe(false);
    expect(dashboardMock.request).toHaveBeenCalledWith("session.interrupt", {
      session_id: "live-1",
    });
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "approval.respond",
      ),
    ).toBe(false);
  });

  it("does not recover and replay after an approval precedes a missing-session error", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create")
        return { session_id: "live-1", stored_session_id: "stored-1" };
      if (method === "model.options")
        return { provider: "bad-provider", model: "bad-model" };
      if (method === "prompt.submit") {
        dashboardMock.onEvent?.({
          type: "approval.request",
          session_id: "live-1",
          payload: { request_id: "before-ack", choices: ["once"] },
        });
        throw new Error("session not found");
      }
      return {};
    });
    await act(async () => {
      await api.send?.("hello");
    });
    expect(
      dashboardMock.request.mock.calls.filter(
        ([method]) => method === "prompt.submit",
      ),
    ).toHaveLength(1);
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "session.resume",
      ),
    ).toBe(false);
  });

  it("clears pending approval on completion and abort", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { request_id: "approval-3", choices: ["once"] },
      });
      dashboardMock.onEvent?.({
        type: "message.complete",
        session_id: "live-1",
        payload: { text: "complete" },
      });
    });

    expect(
      api.messages?.find(
        (msg) => msg.kind === "approval" && msg.requestId === "approval-3",
      ),
    ).toMatchObject({ unavailable: true });
    await expect(api.respondApproval?.("approval-3", "once")).resolves.toBe(
      false,
    );

    await act(async () => {
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { request_id: "approval-4", choices: ["once"] },
      });
      api.abort?.();
    });
    await expect(api.respondApproval?.("approval-4", "once")).resolves.toBe(
      false,
    );
  });

  // @lat: [[chat-commands#Structured command approvals#Terminal approval replay]]
  it.each(["resolved", "unavailable"])(
    "does not queue replayed %s approvals ahead of a new command",
    async (state) => {
      const api: HarnessApi = {};
      render(<Harness api={api} />);
      const emit = (request_id: string): void => {
        dashboardMock.onEvent?.({
          type: "approval.request",
          session_id: "live-1",
          payload: { request_id, choices: ["once"] },
        });
      };
      await act(async () => {
        await api.send?.("hello");
        emit("old");
        if (state === "resolved") {
          expect(await api.respondApproval?.("old", "once")).toBe(true);
        } else {
          dashboardMock.onEvent?.({
            type: "message.complete",
            session_id: "live-1",
            payload: { text: "Done" },
          });
        }
        emit("old");
        emit("new");
      });
      await act(async () => {
        expect(await api.respondApproval?.("new", "once")).toBe(true);
        expect(await api.respondApproval?.("old", "once")).toBe(false);
      });
    },
  );

  it("presents queued approvals in arrival order", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { request_id: "approval-first", choices: ["deny"] },
      });
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { request_id: "approval-second", choices: ["once"] },
      });
    });

    await expect(
      api.respondApproval?.("approval-second", "once"),
    ).resolves.toBe(false);
    await expect(api.respondApproval?.("approval-first", "deny")).resolves.toBe(
      true,
    );
    await expect(
      api.respondApproval?.("approval-second", "once"),
    ).resolves.toBe(true);
  });
});

describe("useDashboardChatTransport unavailable fallback (issue #667)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockStartDashboard(): ReturnType<typeof vi.fn> {
    const startDashboard = vi.fn(async () => ({
      running: false,
      error: "Hermes dashboard chat WebSocket is unavailable (404)",
    }));
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard,
      },
    });
    return startDashboard;
  }

  it("latches unavailable on SSH and fails fast on later sends, notifying once", async () => {
    const startDashboard = mockStartDashboard();
    const onUnavailable = vi.fn();
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="ssh"
        fallbackOnUnavailable
        onDashboardUnavailable={onUnavailable}
      />,
    );

    let first: boolean | undefined;
    await act(async () => {
      first = await api.send?.("hello");
    });
    // Dashboard unavailable → caller falls back to legacy (returns false).
    expect(first).toBe(false);
    expect(startDashboard).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);

    let second: boolean | undefined;
    await act(async () => {
      second = await api.send?.("again");
    });
    expect(second).toBe(false);
    // Fast path: no second status/probe round-trip, no duplicate notice.
    expect(startDashboard).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("re-probes after the connection changes", async () => {
    const startDashboard = mockStartDashboard();
    const api: HarnessApi = {};
    render(
      <Harness api={api} initialConnectionMode="ssh" fallbackOnUnavailable />,
    );

    await act(async () => {
      await api.send?.("hello");
    });
    expect(startDashboard).toHaveBeenCalledTimes(1);

    // Switching connection clears the sticky flag → the dashboard is retried.
    await act(async () => {
      api.setConnectionMode?.("remote");
    });
    await act(async () => {
      await api.send?.("after change");
    });
    expect(startDashboard).toHaveBeenCalledTimes(2);
  });

  it("re-probes after the selected connection is edited in place", async () => {
    const startDashboard = mockStartDashboard();
    const api: HarnessApi = {};
    const { rerender } = render(
      <Harness
        api={api}
        connectionId="connection-a"
        connectionRevision={0}
        initialConnectionMode="ssh"
        fallbackOnUnavailable
      />,
    );

    await act(async () => {
      await api.send?.("hello");
    });
    expect(startDashboard).toHaveBeenCalledTimes(1);

    rerender(
      <Harness
        api={api}
        connectionId="connection-a"
        connectionRevision={1}
        initialConnectionMode="ssh"
        fallbackOnUnavailable
      />,
    );
    await act(async () => {
      await api.send?.("after edit");
    });
    expect(startDashboard).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying on local (does not latch)", async () => {
    const startDashboard = mockStartDashboard();
    const api: HarnessApi = {};
    render(
      <Harness api={api} initialConnectionMode="local" fallbackOnUnavailable />,
    );

    await act(async () => {
      await api.send?.("hello");
    });
    await act(async () => {
      await api.send?.("again");
    });
    // Local dashboard may still be spawning, so each send re-checks.
    expect(startDashboard).toHaveBeenCalledTimes(2);
  });
});

describe("useDashboardChatTransport messagesRef sync", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // `background.complete` appends an agent bubble built from `messagesRef.current`,
  // so it reads exactly the array the sync effect maintains — a clean probe for
  // whether the ref adopted an external Chat-state change. It requires a live
  // gateway client, so every test connects with one `send` first (which does not
  // append a user bubble — Chat owns that).
  const connect = async (api: HarnessApi): Promise<void> => {
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    await act(async () => {
      await api.send?.("hello");
    });
    expect(dashboardMock.onEvent).toBeTypeOf("function");
  };

  const backgroundComplete = async (): Promise<void> => {
    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { task_id: "t1", text: "bg answer" },
        type: "background.complete",
      });
    });
  };

  it("adopts an external clear so a new turn does not resurrect deleted messages (#757)", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);

    // Chat's `handleClear` empties the list without unmounting <Chat>. A length
    // guard (`messages.length > ref.length`) would skip this and leave the ref
    // pointing at the deleted turn, so the next event would append onto it.
    await act(async () => {
      api.setMessages?.([]);
    });
    await backgroundComplete();

    expect(api.messages).toHaveLength(1);
    expect(api.messages?.[0]?.id).toBe("bg-t1");
  });

  it("adopts a same-length in-place replacement (clarify resolve / edit)", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);

    // Same length, different content — mirrors `handleClarifyResolved` mapping a
    // clarify card to resolved before the gateway resumes the turn.
    await act(async () => {
      api.setMessages?.([
        { id: "u-edited", role: "user", content: "edited turn" },
      ]);
    });
    await backgroundComplete();

    expect(api.messages).toHaveLength(2);
    expect(api.messages?.[0]?.id).toBe("u-edited");
    expect(api.messages?.[1]?.id).toBe("bg-t1");
  });
});

describe("useDashboardChatTransport context gauge estimate (no usage payload)", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Resolve the final usage object a setUsage((prev) => next) call produces.
  const lastUsage = (setUsage: SetUsageMock): UsageState | null => {
    expect(setUsage).toHaveBeenCalled();
    const updater = setUsage.mock.calls.at(-1)?.[0];
    if (typeof updater !== "function") {
      throw new Error("setUsage was not called with an updater function");
    }
    return updater(null);
  };

  it("sets an estimated contextTokens when a successful completion has no usage", async () => {
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(<Harness api={api} setUsage={setUsage} />);
    await act(async () => {
      await api.send?.("hello");
    });

    // Provider omitted usage entirely → usageFromPayload returns null. The
    // gauge only renders when contextTokens is set, so the estimate must fill
    // it in — this was the case the gauge went blank on (#789).
    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { status: "completed", final_response: "hi there" },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    const usage = lastUsage(setUsage);
    expect(usage?.contextTokens).toBeGreaterThan(0);
  });

  it("prefers exact payload usage over the estimate", async () => {
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(<Harness api={api} setUsage={setUsage} />);
    await act(async () => {
      await api.send?.("hello");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {
          status: "completed",
          final_response: "hi there",
          usage: { input: 5000, output: 200, context_used: 45000 },
        },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    const usage = lastUsage(setUsage);
    expect(usage?.contextTokens).toBe(45000);
  });

  it("does not fabricate usage for a failed turn without usage", async () => {
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(<Harness api={api} setUsage={setUsage} />);
    await act(async () => {
      await api.send?.("hello");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { status: "error", error: "Invalid API Key" },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    expect(setUsage).not.toHaveBeenCalled();
  });
});

describe("useDashboardChatTransport delta coalescing", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("coalesces a burst of message.delta into one commit without losing text", async () => {
    // Capture rAF callbacks so the frame boundary is under test control.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
    });

    // A burst of deltas inside one frame: transcript state must not commit yet
    // (schedule exactly one frame callback), but no delta text may be lost.
    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {},
        session_id: "live-1",
        type: "message.start",
      });
      for (const chunk of ["a", "b", "c", "d", "e"]) {
        dashboardMock.onEvent?.({
          payload: { text: chunk },
          session_id: "live-1",
          type: "message.delta",
        });
      }
    });
    expect(frames).toHaveLength(1);

    // Frame fires → exactly one commit carrying the full accumulated text.
    await act(async () => {
      frames[0](0);
    });
    // The streamed bubble is the trailing message (the harness may add a
    // model-mismatch error bubble before it — unrelated to coalescing).
    const last = api.messages?.[api.messages.length - 1] as
      | { role?: string; content?: string }
      | undefined;
    expect(last?.role).toBe("agent");
    expect(last?.content).toBe("abcde");
  });

  it("message.complete flushes immediately, superseding a pending frame", async () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (h: number) => {
      cancelled.push(h);
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {},
        session_id: "live-1",
        type: "message.start",
      });
      dashboardMock.onEvent?.({
        payload: { text: "partial" },
        session_id: "live-1",
        type: "message.delta",
      });
      // Terminal event arrives before the frame: it must commit synchronously
      // and cancel the queued flush.
      dashboardMock.onEvent?.({
        payload: { text: "partial and done" },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    expect(cancelled).toHaveLength(1);
    const last = api.messages?.[api.messages.length - 1] as
      | { role?: string; content?: string }
      | undefined;
    expect(last?.role).toBe("agent");
    expect(last?.content).toBe("partial and done");

    // A stale frame firing later must not resurrect the pre-complete state.
    await act(async () => {
      frames.forEach((cb) => cb(0));
    });
    const lastAfter = api.messages?.[api.messages.length - 1] as
      | { content?: string }
      | undefined;
    expect(lastAfter?.content).toBe("partial and done");
  });

  it("keeps pending deltas when a functional writer lands mid-frame", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("hello");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {},
        session_id: "live-1",
        type: "message.start",
      });
      dashboardMock.onEvent?.({
        payload: { text: "alpha" },
        session_id: "live-1",
        type: "message.delta",
      });
      dashboardMock.onEvent?.({
        payload: { text: "beta" },
        session_id: "live-1",
        type: "message.delta",
      });
    });

    // Before the coalesced frame commits, a functional writer (the `/btw`
    // side-question path) appends a bubble. It must build on the streamed
    // deltas held in the transcript ref — not fork from the stale committed
    // state and drop them.
    await act(async () => {
      api.setMessages?.((prev) => [
        ...prev,
        { id: "side-q", role: "user", content: "btw question" } as ChatMessage,
      ]);
    });
    const afterAppend = api.messages ?? [];
    expect(afterAppend[afterAppend.length - 1]?.id).toBe("side-q");
    expect(
      (afterAppend[afterAppend.length - 2] as { content?: string }).content,
    ).toBe("alphabeta");

    // The pending frame then fires: it republishes the newest transcript and
    // must never resurrect the pre-append snapshot.
    await act(async () => {
      frames.forEach((cb) => cb(0));
    });
    const afterFlush = api.messages ?? [];
    expect(afterFlush[afterFlush.length - 1]?.id).toBe("side-q");
    expect(
      (afterFlush[afterFlush.length - 2] as { content?: string }).content,
    ).toBe("alphabeta");
  });
});
