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
import {
  getSubagents,
  subagentScopeKey,
  resetSubagents,
  type SubagentControls,
} from "../subagents";
import {
  dashboardUsageDelta,
  useDashboardChatTransport,
} from "./useDashboardChatTransport";
import { useTranscriptState } from "./useTranscriptState";
import type { ActiveTurn, Attachment, ChatMessage, UsageState } from "../types";

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
  send?: (text: string, attachments?: Attachment[]) => Promise<boolean>;
  setConnectionMode?: Dispatch<SetStateAction<"local" | "remote" | "ssh">>;
  setMessages?: Dispatch<SetStateAction<ChatMessage[]>>;
  setModel?: Dispatch<SetStateAction<string>>;
  setProvider?: Dispatch<SetStateAction<string>>;
  subagents?: SubagentControls | null;
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
  hermesSessionId = null,
  profile,
  fallbackOnUnavailable = false,
  initialConnectionMode = "local",
  onDashboardUnavailable,
  onPetEvent,
  onPetFailure,
  setUsage = vi.fn() as SetUsageMock,
}: {
  api: HarnessApi;
  connectionId?: string;
  connectionRevision?: number;
  hermesSessionId?: string | null;
  profile?: string;
  fallbackOnUnavailable?: boolean;
  initialConnectionMode?: "local" | "remote" | "ssh";
  onDashboardUnavailable?: (reason: string) => void;
  onPetEvent?: (event: DashboardRpcEvent) => void;
  onPetFailure?: () => void;
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
    hermesSessionId,
    messagesRef,
    model,
    profile,
    provider,
    setHermesSessionId: vi.fn(),
    setIsLoading,
    setMessages,
    setToolProgress: vi.fn(),
    setUsage,
    onDashboardUnavailable,
    onPetEvent,
    onPetFailure,
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
      subagents: transport.subagents,
    });
  }, [
    isLoading,
    activeTurnRef,
    api,
    messages,
    setConnectionMode,
    setMessages,
    transport.sendMessage,
    transport.subagents,
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

  // @lat: [[model-selection#Live model reconciliation#Matching runtime preserves the no-op path]]
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
      dashboardMock.onEvent?.({
        type: "message.complete",
        session_id: "live",
        payload: { text: "Done" },
      });
    });
    await act(async () => {
      api.activeTurnRef!.current = { ...activeRecoveryTurn };
      await api.send?.("second");
    });

    const methods = dashboardMock.request.mock.calls.map(([method]) => method);
    expect(methods.filter((method) => method === "slash.exec")).toHaveLength(1);
    expect(methods.filter((method) => method === "model.options")).toHaveLength(
      3,
    );
  });

  // @lat: [[model-selection#Live model reconciliation#Fallback drift is reconciled before submission]]
  it.each([
    ["fallback-provider", "fallback-model"],
    ["bad-provider", "fallback-model"],
    ["fallback-provider", "bad-model"],
  ])(
    "reapplies a cached selection after live drift to %s/%s",
    async (fallbackProvider, fallbackModel) => {
      let liveProvider = "bad-provider";
      let liveModel = "bad-model";
      dashboardMock.request.mockImplementation(async (method) => {
        if (method === "session.create")
          return { session_id: "live", stored_session_id: "stored" };
        if (method === "model.options")
          return { provider: liveProvider, model: liveModel, providers: [] };
        if (method === "slash.exec") {
          liveProvider = "bad-provider";
          liveModel = "bad-model";
        }
        return {};
      });
      const api: HarnessApi = {};
      render(<Harness api={api} initialConnectionMode="ssh" />);
      await act(async () => {
        await api.send?.("first");
        dashboardMock.onEvent?.({
          type: "message.complete",
          session_id: "live",
          payload: { text: "Done on fallback" },
        });
      });
      liveProvider = fallbackProvider;
      liveModel = fallbackModel;
      dashboardMock.request.mockClear();

      await act(async () => {
        api.activeTurnRef!.current = { ...activeRecoveryTurn };
        await api.send?.("second");
      });

      expect(
        dashboardMock.request.mock.calls.map(([method]) => method),
      ).toEqual([
        "model.options",
        "slash.exec",
        "model.options",
        "prompt.submit",
      ]);
      expect(dashboardMock.request).toHaveBeenCalledWith("slash.exec", {
        session_id: "live",
        command: "/model bad-model --provider bad-provider",
      });
      expect(dashboardMock.request).toHaveBeenLastCalledWith("prompt.submit", {
        session_id: "live",
        text: "second",
      });
      expect(api.activeTurnRef?.current?.status).toBe("running");
    },
  );

  // @lat: [[model-selection#Live model reconciliation#Refused drift repair cannot submit to the fallback]]
  it.each(["busy", "warning"] as const)(
    "does not submit or replay a prompt when a drift repair returns %s",
    async (refusal) => {
      let drifted = false;
      dashboardMock.request.mockImplementation(async (method) => {
        if (method === "session.create")
          return { session_id: "live", stored_session_id: "stored" };
        if (method === "model.options")
          return drifted
            ? { provider: "fallback-provider", model: "fallback-model" }
            : { provider: "bad-provider", model: "bad-model" };
        if (method === "slash.exec" && drifted) {
          if (refusal === "busy") throw new Error("session busy");
          return {
            warning: "Switch deferred until the running turn completes",
          };
        }
        return {};
      });
      const api: HarnessApi = {};
      render(<Harness api={api} initialConnectionMode="ssh" />);
      await act(async () => {
        await api.send?.("first");
        dashboardMock.onEvent?.({
          type: "message.complete",
          session_id: "live",
          payload: { text: "Done" },
        });
      });
      drifted = true;
      dashboardMock.request.mockClear();

      await act(async () => {
        api.activeTurnRef!.current = { ...activeRecoveryTurn };
        await api.send?.("second");
      });

      expect(dashboardMock.request).toHaveBeenCalledWith("slash.exec", {
        session_id: "live",
        command: "/model bad-model --provider bad-provider",
      });
      const methods = dashboardMock.request.mock.calls.map(
        ([method]) => method,
      );
      expect(methods).not.toContain("prompt.submit");
      expect(methods).not.toContain("session.close");
      expect(methods).not.toContain("session.create");
      expect(methods).not.toContain("session.interrupt");
      expect(api.isLoading).toBe(false);
      expect(api.activeTurnRef?.current).toBeNull();
      expect(
        api.messages?.some(
          (message) =>
            "error" in message &&
            message.error?.includes(
              refusal === "busy" ? "session busy" : "Switch deferred",
            ),
        ),
      ).toBe(true);
    },
  );

  it("surfaces OAuth login requirements without legacy fallback", async () => {
    // @lat: [[remote-dashboard-oauth#Test specifications#OAuth no-fallback]]
    const onUnavailable = vi.fn();
    const onPetFailure = vi.fn();
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
        onPetFailure={onPetFailure}
      />,
    );

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.send?.("hello");
    });

    expect(handled).toBe(true);
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onPetFailure).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // @lat: [[chat-commands#Busy refusal preserves conversation#Saved conversation retry]]
  it.each([
    ["local", "session busy"],
    ["ssh", "session busy — /interrupt the current turn before /model"],
    ["remote", "session busy"],
  ] as const)(
    "keeps the saved conversation after a %s busy refusal",
    async (mode, busyMessage) => {
      let busy = true;
      dashboardMock.request.mockImplementation(async (method) => {
        if (method === "session.resume")
          return {
            session_id: "existing-runtime",
            stored_session_id: "stored-chat",
          };
        if (method === "session.create")
          return {
            session_id: "replacement-runtime",
            stored_session_id: "replacement-conversation",
          };
        if (method === "model.options")
          return {
            model: "bad-model",
            provider: "bad-provider",
            providers: [],
          };
        if (method === "prompt.submit" && busy) throw new Error(busyMessage);
        return {};
      });
      const api: HarnessApi = {};
      render(
        <Harness
          api={api}
          hermesSessionId="stored-chat"
          initialConnectionMode={mode}
          profile="work"
        />,
      );
      await act(async () => {
        expect(await api.send?.("first try")).toBe(true);
      });
      expect(api.isLoading).toBe(false);
      expect(api.activeTurnRef?.current).toBeNull();
      expect(
        api.messages?.some((m) => "error" in m && m.error === busyMessage),
      ).toBe(true);
      busy = false;
      await act(async () => {
        api.activeTurnRef!.current = { ...activeRecoveryTurn };
        api.setMessages?.((prev) => [
          ...prev,
          {
            id: "u-recovery",
            role: "user",
            content: "retry",
            turnId: "turn-recovery",
          },
        ]);
      });
      await act(async () => {
        expect(await api.send?.("retry")).toBe(true);
      });
      const methods = dashboardMock.request.mock.calls.map(
        ([method]) => method,
      );
      expect(methods).not.toContain("session.create");
      expect(methods).not.toContain("session.close");
      expect(methods).not.toContain("session.interrupt");
      expect(window.hermesAPI.recordSessionContinuation).not.toHaveBeenCalled();
      expect(dashboardMock.request).toHaveBeenLastCalledWith("prompt.submit", {
        session_id: "existing-runtime",
        text: "retry",
        profile: "work",
      });
    },
  );

  // @lat: [[chat-commands#Busy refusal preserves conversation#Busy model setup]]
  it("retries model setup on the same runtime after its busy refusal", async () => {
    let busy = true;
    let liveModel = "other-model";
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.resume")
        return { session_id: "existing-runtime", resumed: "stored-chat" };
      if (method === "session.create")
        return {
          session_id: "replacement-runtime",
          stored_session_id: "new-chat",
        };
      if (method === "model.options")
        return {
          model: liveModel,
          provider: "bad-provider",
          providers: [],
        };
      if (method === "slash.exec") {
        if (busy)
          throw new Error(
            "session busy — /interrupt the current turn before /model",
          );
        liveModel = "bad-model";
      }
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} hermesSessionId="stored-chat" />);
    await act(async () => {
      await api.send?.("first try");
    });
    expect(
      dashboardMock.request.mock.calls.map(([method]) => method),
    ).not.toContain("prompt.submit");
    busy = false;
    await act(async () => {
      api.activeTurnRef!.current = { ...activeRecoveryTurn };
      await api.send?.("retry");
    });
    const methods = dashboardMock.request.mock.calls.map(([method]) => method);
    expect(methods).not.toContain("session.create");
    expect(methods).not.toContain("session.close");
    expect(methods).not.toContain("session.interrupt");
    expect(dashboardMock.request).toHaveBeenLastCalledWith("prompt.submit", {
      session_id: "existing-runtime",
      text: "retry",
    });
  });

  // @lat: [[chat-commands#Busy refusal preserves conversation#Busy refusal never interrupts shared work]]
  it("does not interrupt busy upstream work when expiring a displayed approval", async () => {
    let rejectSubmit: ((reason: Error) => void) | undefined;
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.resume")
        return { session_id: "existing-runtime", resumed: "stored-chat" };
      if (method === "model.options")
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      if (method === "prompt.submit")
        return new Promise((_, reject) => {
          rejectSubmit = reject;
        });
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} hermesSessionId="stored-chat" />);
    let submitted: Promise<boolean> | undefined;
    act(() => {
      submitted = api.send?.("first try");
    });
    await waitFor(() => expect(rejectSubmit).toBeTypeOf("function"));
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "existing-runtime",
        payload: {
          request_id: "busy-approval",
          command: "npm publish",
          choices: ["once"],
        },
      });
    });
    expect(api.messages?.some((m) => m.kind === "approval")).toBe(true);
    await act(async () => {
      rejectSubmit?.(new Error("session busy"));
      expect(await submitted).toBe(true);
    });
    expect(
      dashboardMock.request.mock.calls.map(([method]) => method),
    ).not.toContain("session.interrupt");
    expect(api.messages?.find((m) => m.kind === "approval")).toMatchObject({
      unavailable: true,
    });
    expect(api.activeTurnRef?.current).toBeNull();
    expect(api.isLoading).toBe(false);
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

  // @lat: [[approval-completion#Confirmed decisions]]
  it.each(["once", "deny"] as const)(
    "accepts a confirmed %s decision when completion arrives before its acknowledgement",
    async (choice) => {
      const api: HarnessApi = {};
      render(<Harness api={api} />);
      await act(async () => {
        await api.send?.("hello");
        dashboardMock.onEvent?.({
          type: "approval.request",
          session_id: "live-1",
          payload: { request_id: "in-flight", choices: ["once", "deny"] },
        });
        dashboardMock.onEvent?.({
          type: "approval.request",
          session_id: "live-1",
          payload: { request_id: "unanswered", choices: ["once"] },
        });
      });
      let acknowledge!: (value: { resolved: number }) => void;
      dashboardMock.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      );
      let response!: Promise<boolean>;
      act(() => {
        response = api.respondApproval!("in-flight", choice);
      });
      await act(async () => {
        dashboardMock.onEvent?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "Done" },
        });
      });
      expect(
        api.messages?.find(
          (m) => m.kind === "approval" && m.requestId === "in-flight",
        ),
      ).not.toMatchObject({ unavailable: true });
      expect(
        api.messages?.find(
          (m) => m.kind === "approval" && m.requestId === "unanswered",
        ),
      ).toMatchObject({ unavailable: true });
      await act(async () => {
        acknowledge({ resolved: 1 });
        expect(await response).toBe(true);
      });
      expect(await api.respondApproval!("unanswered", "once")).toBe(false);
      expect(await api.respondApproval!("in-flight", choice)).toBe(false);
    },
  );

  // @lat: [[approval-completion#Failed and obsolete decisions]]
  it.each([
    "reject",
    "unresolved",
    "abort",
    "disconnect",
    "connection",
    "new turn",
  ])("does not revive completed approvals after %s", async (outcome) => {
    const api: HarnessApi = {};
    const view = render(<Harness api={api} connectionId="original" />);
    await act(async () => {
      await api.send?.("hello");
      dashboardMock.onEvent?.({
        type: "approval.request",
        session_id: "live-1",
        payload: { request_id: "late", choices: ["once"] },
      });
    });
    let acknowledge!: (value: { resolved: number }) => void;
    let reject!: (reason: Error) => void;
    dashboardMock.request.mockImplementationOnce(
      () =>
        new Promise((resolve, fail) => {
          acknowledge = resolve;
          reject = fail;
        }),
    );
    let response!: Promise<boolean>;
    act(() => {
      response = api.respondApproval!("late", "once");
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "message.complete",
        session_id: "live-1",
        payload: { text: "Done" },
      });
    });
    await act(async () => {
      if (outcome === "abort") api.abort?.();
      if (outcome === "disconnect") dashboardMock.onClose?.();
      if (outcome === "new turn") await api.send?.("next turn");
    });
    if (outcome === "connection")
      view.rerender(<Harness api={api} connectionId="other" />);
    const loadingBeforeAck = api.isLoading;
    await act(async () => {
      if (outcome === "reject") reject(new Error("acknowledgement lost"));
      else
        acknowledge({
          resolved: outcome === "unresolved" || outcome === "new turn" ? 0 : 1,
        });
      expect(await response).toBe(false);
    });
    expect(
      api.messages?.find(
        (m) => m.kind === "approval" && m.requestId === "late",
      ),
    ).toMatchObject({ unavailable: true });
    expect(await api.respondApproval!("late", "once")).toBe(false);
    if (outcome === "new turn") expect(api.isLoading).toBe(loadingBeforeAck);
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
    // ...and it is flagged as a guess so the UI never presents it as exact.
    expect(usage?.contextEstimated).toBe(true);
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
    expect(usage?.contextEstimated).toBe(false);
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

  it("relays only accepted activity events to the pet, not another session's events", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create")
        return { session_id: "live-1", stored_session_id: "stored-1" };
      if (method === "model.options")
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      return {};
    });
    const onPetEvent = vi.fn();
    const api: HarnessApi = {};
    render(<Harness api={api} onPetEvent={onPetEvent} />);
    await act(async () => {
      await api.send?.("hello");
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "tool.start",
        session_id: "other",
        payload: { name: "terminal" },
      });
      dashboardMock.onEvent?.({
        type: "tool.start",
        session_id: "live-1",
        payload: { name: "terminal" },
      });
    });
    expect(onPetEvent).toHaveBeenCalledTimes(1);
    expect(onPetEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tool.start", session_id: "live-1" }),
    );
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

describe("useDashboardChatTransport subagent roster", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    resetSubagents();
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

  afterEach(() => {
    resetSubagents();
    vi.clearAllMocks();
  });

  // @lat: [[subagents#Recovery regressions#Reopened conversation]]
  it("resumes a saved conversation for roster and controls without sending or replacing it", async () => {
    let finishResume!: (value: unknown) => void;
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.resume")
        return new Promise((resolve) => {
          finishResume = resolve;
        });
      if (method === "subagent.list")
        return { subagents: [{ subagent_id: "existing", status: "running" }] };
      return { available: true, text: "working", truncated: false };
    });
    const api: HarnessApi = {};
    render(<Harness api={api} hermesSessionId="saved-parent" profile="work" />);
    const roster = api.subagents!.list();
    const tail = api.subagents!.tail("existing");
    await waitFor(() =>
      expect(dashboardMock.request).toHaveBeenCalledWith("session.resume", {
        session_id: "saved-parent",
        cols: 96,
        lazy: true,
        profile: "work",
      }),
    );
    finishResume({ session_id: "resumed-parent" });
    expect(await roster).toEqual([
      { subagent_id: "existing", status: "running" },
    ]);
    expect(await tail).toEqual({
      available: true,
      text: "working",
      truncated: false,
    });
    await api.subagents!.steer("existing", "continue");
    expect(
      dashboardMock.request.mock.calls.filter(
        ([method]) => method === "session.resume",
      ),
    ).toHaveLength(1);
    expect(dashboardMock.request).toHaveBeenCalledWith("subagent.steer", {
      session_id: "resumed-parent",
      subagent_id: "existing",
      text: "continue",
    });
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "session.create" || method === "session.send",
      ),
    ).toBe(false);
  });

  // @lat: [[model-context#Tests#Passive roster resume retains native usage baseline]]
  it("keeps the native usage baseline when a passive roster read resumes the saved chat", async () => {
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.resume")
        return {
          session_id: "resumed-parent",
          info: { usage: { input: 1000, output: 200, total: 1200 } },
        };
      if (method === "subagent.list") return { subagents: [] };
      if (method === "model.options")
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      return {};
    });
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(
      <Harness api={api} hermesSessionId="saved-parent" setUsage={setUsage} />,
    );
    await act(async () => {
      await api.subagents!.list();
    });
    expect(setUsage).not.toHaveBeenCalled();
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "session.send" || method === "session.create",
      ),
    ).toBe(false);
    await act(async () => {
      await api.send?.("next turn");
      dashboardMock.onEvent?.({
        type: "message.complete",
        session_id: "resumed-parent",
        payload: {
          text: "completed",
          usage: { input: 1300, output: 250, total: 1550 },
        },
      });
    });
    const update = setUsage.mock.calls.at(-1)?.[0];
    expect(typeof update).toBe("function");
    expect(typeof update === "function" ? update(null) : update).toMatchObject({
      promptTokens: 300,
      completionTokens: 50,
      totalTokens: 350,
    });
    expect(
      dashboardMock.request.mock.calls.filter(
        ([method]) => method === "session.resume",
      ),
    ).toHaveLength(1);
  });

  it("answers empty for a new chat and does not replace a missing saved conversation", async () => {
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    expect(await api.subagents!.list()).toEqual([]);
    expect(window.hermesAPI.startDashboard).not.toHaveBeenCalled();
    dashboardMock.request.mockRejectedValue(new Error("session not found"));
    view.rerender(<Harness api={api} hermesSessionId="missing-parent" />);
    await expect(api.subagents!.list()).rejects.toThrow("session not found");
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "session.create",
      ),
    ).toBe(false);
  });

  // @lat: [[subagents#Recovery regressions#Resume target isolation]]
  it("rejects a late saved-chat resume after the connection revision changes", async () => {
    let finishResume!: (value: unknown) => void;
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.resume")
        return new Promise((resolve) => {
          finishResume = resolve;
        });
      return {};
    });
    const api: HarnessApi = {};
    const view = render(
      <Harness
        api={api}
        connectionId="server"
        connectionRevision={1}
        hermesSessionId="saved-parent"
      />,
    );
    const pending = api
      .subagents!.steer("existing", "old target")
      .catch((error: unknown) => error);
    await waitFor(() =>
      expect(dashboardMock.request).toHaveBeenCalledWith(
        "session.resume",
        expect.anything(),
      ),
    );
    view.rerender(
      <Harness
        api={api}
        connectionId="server"
        connectionRevision={2}
        hermesSessionId="saved-parent"
      />,
    );
    finishResume({ session_id: "old-runtime" });
    expect(await pending).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("conversation changed"),
      }),
    );
    expect(
      dashboardMock.request.mock.calls.some(
        ([method]) => method === "subagent.steer",
      ),
    ).toBe(false);
  });

  // @lat: [[subagents#Recovery regressions#Conversation return fencing]]
  it.each([false, true])(
    "rejects a pending saved-chat control after leaving its conversation (unmount: %s)",
    async (unmount) => {
      let finishResume!: (value: unknown) => void;
      dashboardMock.request.mockImplementation(async (method: string) => {
        if (method === "session.resume")
          return new Promise((resolve) => {
            finishResume = resolve;
          });
        return {};
      });
      const api: HarnessApi = {};
      const view = render(<Harness api={api} hermesSessionId="saved-A" />);
      const pending = api
        .subagents!.steer("existing", "old draft")
        .catch((error: unknown) => error);
      await waitFor(() =>
        expect(dashboardMock.request).toHaveBeenCalledWith(
          "session.resume",
          expect.anything(),
        ),
      );
      if (unmount) view.unmount();
      else {
        view.rerender(<Harness api={api} hermesSessionId="saved-B" />);
        view.rerender(<Harness api={api} hermesSessionId="saved-A" />);
      }
      finishResume({ session_id: "old-runtime" });
      expect(await pending).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("conversation changed"),
        }),
      );
      expect(
        dashboardMock.request.mock.calls.some(
          ([method]) => method === "subagent.steer",
        ),
      ).toBe(false);
    },
  );

  it("keeps a delegated child's activity in the roster, not the transcript", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    dashboardMock.request.mockImplementation(
      async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "session.create") {
          return { session_id: "live-sub", stored_session_id: "stored-sub" };
        }
        if (method === "subagent.list") {
          return {
            subagents: [
              { goal: "Audit", status: "running", subagent_id: "sub-1" },
            ],
          };
        }
        return {};
      },
    );

    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("delegate the audit");
    });
    await waitFor(() => expect(api.subagents).toBeTruthy());

    const transcriptBefore = JSON.stringify(api.messages);
    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { goal: "Audit the auth module", subagent_id: "sub-1" },
        session_id: "live-sub",
        type: "subagent.start",
      });
      dashboardMock.onEvent?.({
        payload: { subagent_id: "sub-1", text: "reading src/auth.ts" },
        session_id: "live-sub",
        type: "subagent.progress",
      });
    });

    // Child activity is roster state keyed by the conversation, so it reaches
    // the in-chat section...
    const rows = getSubagents(
      subagentScopeKey(undefined, undefined, "stored-sub"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].goal).toBe("Audit the auth module");
    expect(rows[0].stream.map((entry) => entry.text)).toEqual([
      "reading src/auth.ts",
    ]);
    // ...and never the message stream.
    expect(JSON.stringify(api.messages)).toBe(transcriptBefore);

    const entries = await api.subagents!.list();
    expect(entries).toHaveLength(1);
    expect(requests).toContainEqual({
      method: "subagent.list",
      params: { session_id: "live-sub" },
    });

    await act(async () => {
      await api.subagents!.steer("sub-1", "check the null case");
    });
    expect(requests).toContainEqual({
      method: "subagent.steer",
      params: {
        session_id: "live-sub",
        subagent_id: "sub-1",
        text: "check the null case",
      },
    });
  });

  it("retires a finished child at the next turn boundary", async () => {
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-sub", stored_session_id: "stored-sub" };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => {
      await api.send?.("delegate the audit");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { goal: "Audit", subagent_id: "sub-1" },
        session_id: "live-sub",
        type: "subagent.start",
      });
      dashboardMock.onEvent?.({
        payload: { status: "completed", subagent_id: "sub-1", summary: "Done" },
        session_id: "live-sub",
        type: "subagent.complete",
      });
    });
    expect(
      getSubagents(subagentScopeKey(undefined, undefined, "stored-sub")),
    ).toHaveLength(1);

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {},
        session_id: "live-sub",
        type: "message.start",
      });
    });

    expect(
      getSubagents(subagentScopeKey(undefined, undefined, "stored-sub")),
    ).toEqual([]);
  });
});

// @lat: [[model-context#Tests#Native cumulative counters and legacy deltas]]
it("deduplicates native runtime counters while preserving context, legacy deltas and reset boundaries", () => {
  const snapshots = new Map<string, Partial<UsageState>>();
  const first = dashboardUsageDelta(
    { usage: { input: 100, output: 20, total: 120, context_used: 80 } },
    "runtime-a",
    snapshots,
  );
  expect(first).toMatchObject({
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    contextTokens: 80,
  });
  expect(
    dashboardUsageDelta(
      { usage: { input: 150, output: 30, total: 180, context_used: 110 } },
      "runtime-a",
      snapshots,
    ),
  ).toMatchObject({
    promptTokens: 50,
    completionTokens: 10,
    totalTokens: 60,
    contextTokens: 110,
  });
  expect(
    dashboardUsageDelta(
      { usage: { input: 150, output: 30, total: 180 } },
      "runtime-a",
      snapshots,
    ),
  ).toMatchObject({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  expect(
    dashboardUsageDelta(
      { usage: { input: 5, output: 2, total: 7 } },
      "runtime-a",
      snapshots,
    ),
  ).toMatchObject({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  expect(
    dashboardUsageDelta(
      { usage: { input: 5, output: 2, total: 7 } },
      "runtime-b",
      snapshots,
    ),
  ).toMatchObject({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  expect(
    dashboardUsageDelta(
      { usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
      "runtime-a",
      snapshots,
    ),
  ).toMatchObject({ promptTokens: 8, completionTokens: 4, totalTokens: 12 });
  expect(
    dashboardUsageDelta(
      { usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
      "runtime-a",
      snapshots,
    ),
  ).toMatchObject({ promptTokens: 8, completionTokens: 4, totalTokens: 12 });
});

// @lat: [[shared-pets#Recovery regressions#Invalid payload handoff releases native authority]]
it("invalid attachment handoff releases native teardown ownership", async () => {
  const api: HarnessApi = {};
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      startDashboard: vi.fn().mockResolvedValue({
        running: true,
        connection: { wsUrl: "ws://fixture" },
      }),
      freshDashboardWsUrl: vi.fn().mockResolvedValue("ws://fixture"),
    },
  });
  const view = render(
    <Harness
      api={api}
      initialConnectionMode="remote"
      fallbackOnUnavailable
      connectionRevision={0}
    />,
  );
  await waitFor(() => expect(api.send).toBeDefined());
  const originalTurn = api.activeTurnRef!.current;
  let handled: boolean | undefined;
  await act(async () => {
    handled = await api.send!("legacy payload", [
      {
        id: "invalid-path",
        kind: "path-ref",
        name: "gone.pdf",
        mime: "application/pdf",
        size: 10,
        path: "",
      },
    ]);
  });
  expect(handled).toBe(false);
  expect(api.activeTurnRef!.current).toBe(originalTurn);
  view.rerender(
    <Harness
      api={api}
      initialConnectionMode="remote"
      fallbackOnUnavailable
      connectionRevision={1}
    />,
  );
  expect(api.activeTurnRef!.current).toBe(originalTurn);
  expect(originalTurn!.status).toBe("running");
  expect(
    api.messages!.some((message) => "error" in message && !!message.error),
  ).toBe(false);
});
