import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { profileEditorFixture } from "../../test/profileEditorFixture";
vi.mock("../../components/useI18n", () => {
  const t = (key: string): string => key;
  return { useI18n: () => ({ t }) };
});
vi.mock("../../components/settings/SettingsModalContext", () => ({
  useSettingsModal: () => ({ openSettings: vi.fn() }),
}));
vi.mock("../../components/profile/ProfileModalContext", () => ({
  useProfileModal: () => ({ openProfile: vi.fn() }),
}));
vi.mock("./SidebarRecentSessions", () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect("saved-a")}>Resume saved chat</button>
  ),
}));
vi.mock("../Sessions/Sessions", () => ({ default: () => null }));
vi.mock("../Discover/Discover", () => ({ default: () => null }));
vi.mock("../Skills/Skills", () => ({ default: () => null }));
vi.mock("../Memory/Memory", () => ({ default: () => null }));
vi.mock("../Tools/Tools", () => ({ default: () => null }));
vi.mock("../Gateway/Gateway", () => ({ default: () => null }));
vi.mock("../Office/Office", () => ({ default: () => null }));
vi.mock("../Providers/Providers", () => ({ default: () => null }));
vi.mock("../Providers/RemoteProviders", () => ({ default: () => null }));
vi.mock("../Schedules/Schedules", () => ({ default: () => null }));
vi.mock("../Kanban/Kanban", () => ({ default: () => null }));
const gateway = vi.hoisted(() => ({
  clients: [] as Array<{ onEvent?: (event: unknown) => void; closed: boolean }>,
  request: vi.fn(),
}));
vi.mock("../Chat/dashboardGatewayClient", () => ({
  DashboardGatewayClient: class {
    connected = true;
    owner: { onEvent?: (event: unknown) => void; closed: boolean };
    constructor(options: { onEvent?: (event: unknown) => void }) {
      this.owner = { ...options, closed: false };
      gateway.clients.push(this.owner);
    }
    async connect(): Promise<void> {
      /* Synthetic gateway is already connected. */
    }
    close(): void {
      this.owner.closed = true;
    }
    request = gateway.request;
  },
}));
const editorStore = vi.hoisted(() => ({
  id: "a",
  configs: {} as Record<
    string,
    {
      connectionId: string;
      mode: "remote";
      remoteUrl: string;
      remoteAuthMode: "token";
      remoteChatTransport: "dashboard";
    }
  >,
}));
vi.mock("../../../../main/config", () => ({
  getActiveConnection: () => ({ connectionId: editorStore.id }),
  getConnectionConfig: (id = editorStore.id) => editorStore.configs[id],
}));
vi.mock("../../../../main/utils", () => ({
  getActiveProfileNameSync: () => "default",
}));
vi.mock("../../../../main/provider-request-target", () => ({
  providerTargetRevision: (config: unknown) => JSON.stringify(config),
}));
import Layout from "./Layout";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}
function row(id: string, active = false): Record<string, unknown> {
  return {
    id,
    name: id,
    isActive: active,
    isDefault: id === "default",
    path: "",
    model: "gpt-x",
    provider: "openai",
    hasEnv: true,
    hasSoul: false,
    skillCount: 3,
    gatewayRunning: true,
  };
}
function fixture(): {
  scope: ReturnType<typeof profileEditorFixture>;
  api: Record<string, ReturnType<typeof vi.fn>>;
  change: (id: string, url?: string) => void;
} {
  const scope = profileEditorFixture("remote");
  scope.change("a");
  let config = {
    connectionId: "a",
    mode: "remote" as const,
    remoteUrl: "https://a.test",
    remoteAuthMode: "token" as const,
    remoteChatTransport: "dashboard" as const,
  };
  editorStore.configs.a = config;
  const listeners = new Set<(value: typeof config) => void>();
  const change = (id: string, url = `https://${id}.test`): void => {
    config = { ...config, connectionId: id, remoteUrl: url };
    editorStore.id = id;
    editorStore.configs[id] = config;
    scope.change(id);
    listeners.forEach((callback) => callback(config));
  };
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    ...scope.api,
    // Exercise main's authority at runtime without importing its Electron
    // ambient globals into the renderer's TypeScript compilation.
    getProfileEditorTarget: vi
      .fn()
      .mockImplementation(async (profile?: string, id?: string) =>
        (
          await import("../../../../main/" + "profile-editor-target")
        ).captureProfileEditorTarget(profile, id),
      ),
    onConnectionConfigChanged: vi
      .fn()
      .mockImplementation((callback: (value: typeof config) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      }),
    listProfiles: vi
      .fn()
      .mockResolvedValue([row("default", true), row("work")]),
    setActiveProfile: vi.fn().mockResolvedValue(true),
    // Main permits explicit-ID provider authority for retained Chats, while
    // the real profile-editor capture above still requires selected ownership.
    getProviderRequestTarget: vi
      .fn()
      .mockImplementation(async (id: string) => ({
        ...editorStore.configs[id],
        revision: JSON.stringify(editorStore.configs[id]),
      })),
    getConnectionConfig: vi
      .fn()
      .mockImplementation(
        async (id = editorStore.id) => editorStore.configs[id],
      ),
    isRemoteOnlyMode: vi.fn().mockResolvedValue(true),
    getModelConfig: vi
      .fn()
      .mockResolvedValue({ model: "gpt-x", provider: "openai", baseUrl: "" }),
    listModels: vi.fn().mockResolvedValue([]),
    discoverModels: vi.fn().mockResolvedValue({ models: [], status: "ok" }),
    getConfig: vi.fn().mockResolvedValue(null),
    getConfigHealth: vi.fn().mockResolvedValue(null),
    sendMessage: vi.fn().mockResolvedValue(null),
    getSessionUsage: vi.fn().mockResolvedValue(null),
    getSessionMessages: vi.fn().mockResolvedValue([
      { kind: "user", id: 1, content: "saved conversation", timestamp: 1 },
      { kind: "assistant", id: 2, content: "saved reply", timestamp: 2 },
    ]),
    getSessionContextFolder: vi.fn().mockResolvedValue(null),
    getSessionModelOverride: vi.fn().mockResolvedValue(null),
    getModelContextWindow: vi.fn().mockResolvedValue(200000),
    validateChatReadiness: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    checkChatReadiness: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    startDashboard: vi.fn().mockResolvedValue({
      running: true,
      connection: { wsUrl: "ws://fixture" },
    }),
    freshDashboardWsUrl: vi.fn().mockResolvedValue("ws://fixture"),
  };
  const bridge = new Proxy(api, {
    get(target, key: string) {
      if (!target[key])
        target[key] = key.startsWith("on")
          ? vi.fn().mockReturnValue(() => {})
          : vi.fn().mockResolvedValue(null);
      return target[key];
    },
  });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: bridge,
  });
  gateway.request.mockImplementation(
    async (method: string, params?: Record<string, unknown>) => {
      if (method === "session.resume")
        return {
          session_id: `runtime-${params?.session_id}`,
          resumed: params?.session_id,
          info: { usage: { input: 1000, output: 200, total: 1200 } },
        };
      if (method === "session.create")
        return {
          session_id: "runtime-new",
          stored_session_id: "new-chat",
          info: { usage: { input: 0, output: 0, total: 0 } },
        };
      if (method === "model.options")
        return { model: "gpt-x", provider: "openai", providers: [] };
      return { status: "ok" };
    },
  );
  return { scope, api, change };
}
beforeEach(() => {
  editorStore.id = "a";
  editorStore.configs = {};
  localStorage.clear();
  localStorage.setItem("hermes-follow-x-dismissed", "true");
  gateway.clients.length = 0;
  gateway.request.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        /* No layout observer in JSDOM. */
      }
      disconnect(): void {
        /* No native observer to disconnect. */
      }
      unobserve(): void {
        /* No layout observer in JSDOM. */
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {
        /* No layout observer in JSDOM. */
      }
      disconnect(): void {
        /* No native observer to disconnect. */
      }
      unobserve(): void {
        /* No layout observer in JSDOM. */
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});
async function resume(): Promise<void> {
  await waitFor(() =>
    expect(document.querySelector(".status-bar")?.textContent).toContain(
      "gpt-x",
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Resume saved chat" }),
  );
  await screen.findAllByText("saved conversation");
}
async function send(): Promise<void> {
  const boxes = screen.getAllByRole("textbox");
  const box = boxes.find((el) => el.tagName === "TEXTAREA")!;
  fireEvent.change(box, { target: { value: "new turn" } });
  fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
  await waitFor(() =>
    expect(gateway.request).toHaveBeenCalledWith(
      "prompt.submit",
      expect.anything(),
    ),
  );
}
async function complete(input: number, output: number): Promise<void> {
  await act(async () =>
    gateway.clients.at(-1)?.onEvent?.({
      type: "message.complete",
      session_id: "runtime-saved-a",
      payload: {
        text: "completed",
        status: "ok",
        usage: {
          input,
          output,
          total: input + output,
          context_used: 400,
          context_max: 200000,
        },
      },
    }),
  );
}
// @lat: [[model-context#Tests#Saved totals and delayed completed turns]]
it("actual Chat to Layout to StatusBar retains saved totals when a live reply overtakes the metadata read", async () => {
  const { api } = fixture();
  const early = deferred<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>();
  api.getSessionUsage.mockReturnValueOnce(early.promise).mockResolvedValue({
    promptTokens: 1300,
    completionTokens: 250,
    totalTokens: 1550,
  });
  render(<Layout connectionId="a" />);
  await resume();
  await waitFor(() =>
    expect(api.getSessionUsage).toHaveBeenCalledWith("saved-a", "a", "default"),
  );
  await send();
  await complete(1300, 250);
  await act(async () =>
    early.resolve({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
    }),
  );
  await waitFor(() =>
    expect(document.querySelector(".status-usage")?.textContent).toContain(
      "↑1.3k ↓250",
    ),
  );
  expect(
    document.querySelector(".status-usage")?.getAttribute("title"),
  ).toContain("1,550 total");
  api.getSessionUsage.mockResolvedValue(null);
  await send();
  await complete(1500, 290);
  await waitFor(() =>
    expect(document.querySelector(".status-usage")?.textContent).toContain(
      "↑1.5k ↓290",
    ),
  );
  expect(document.querySelector(".status-usage")?.textContent).not.toContain(
    "↑2.8k",
  );
});

// @lat: [[model-context#Tests#Saved totals follow the visible scope]]
it("discards late same-ID metadata and keeps connection/profile totals on their visible run", async () => {
  const { api, change } = fixture();
  const late = deferred<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>();
  api.getSessionUsage.mockReturnValue(late.promise);
  const view = render(<Layout connectionId="a" />);
  await resume();
  await waitFor(() =>
    expect(api.getSessionUsage).toHaveBeenCalledWith("saved-a", "a", "default"),
  );
  api.getSessionUsage.mockResolvedValue({
    promptTokens: 20,
    completionTokens: 3,
    totalTokens: 23,
  });
  await act(async () => change("a", "https://new-a.test"));
  await resume();
  await waitFor(() =>
    expect(document.querySelector(".status-usage")?.textContent).toContain(
      "↑20 ↓3",
    ),
  );
  await act(async () =>
    late.resolve({
      promptTokens: 99000,
      completionTokens: 9900,
      totalTokens: 108900,
    }),
  );
  expect(document.querySelector(".status-usage")?.textContent).toContain(
    "↑20 ↓3",
  );
  await act(async () => {
    change("b");
    view.rerender(<Layout connectionId="b" />);
  });
  await waitFor(() =>
    expect(document.querySelector(".status-bar")?.textContent).toContain(
      "gpt-x",
    ),
  );
  expect(document.querySelector(".status-usage")).toBeNull();
  api.getSessionUsage.mockResolvedValue({
    promptTokens: 40,
    completionTokens: 5,
    totalTokens: 45,
  });
  await resume();
  await waitFor(() =>
    expect(api.getSessionUsage).toHaveBeenCalledWith("saved-a", "b", "default"),
  );
  await waitFor(() =>
    expect(document.querySelector(".status-usage")?.textContent).toContain(
      "↑40 ↓5",
    ),
  );
  // The real editor capture refuses a retained nonselected connection; the
  // footer must keep its totals without painting the selected machine's metadata.
  api.listProfiles.mockClear();
  fireEvent.keyDown(window, { ctrlKey: true, code: "Digit1" });
  await waitFor(() =>
    expect(document.querySelector(".status-usage")?.textContent).toContain(
      "↑20 ↓3",
    ),
  );
  await waitFor(() =>
    expect(api.getProfileEditorTarget).toHaveBeenCalledWith("default", "a"),
  );
  expect(document.querySelector(".status-strong")).toBeNull();
  expect(
    api.listProfiles.mock.calls.some(
      ([target]) => target?.connectionId === "a",
    ),
  ).toBe(false);
  fireEvent.keyDown(window, { ctrlKey: true, code: "Digit2" });
  await waitFor(() =>
    expect(document.querySelector(".status-usage")?.textContent).toContain(
      "↑40 ↓5",
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.switchProfile" }),
  );
  fireEvent.click(await screen.findByText("agents.manageProfiles"));
  await screen.findByText("agents.newAgent");
  fireEvent.click(document.querySelectorAll(".agents-row")[1]);
  await waitFor(() =>
    expect(api.setActiveProfile).toHaveBeenCalledWith(
      "work",
      expect.objectContaining({ connectionId: "b", profile: "default" }),
    ),
  );
  expect(document.querySelector(".status-usage")).toBeNull();
  // The profile picker returns to the actual Chat view via the selected agent.
  fireEvent.click(screen.getAllByText("agents.chat")[1]);
  await waitFor(() =>
    expect(document.querySelector(".status-usage")).toBeNull(),
  );
});

// @lat: [[model-context#Tests#Refused prompts do not add usage]]
it("retains confirmed totals and the composer when a pending authority check refuses a prompt", async () => {
  const { api, change } = fixture();
  api.getSessionUsage.mockResolvedValue({
    promptTokens: 1300,
    completionTokens: 250,
    totalTokens: 1550,
  });
  render(<Layout connectionId="a" />);
  await resume();
  await send();
  await complete(1300, 250);
  await waitFor(() =>
    expect(
      document.querySelector(".status-usage")?.getAttribute("title"),
    ).toContain("1,550 total"),
  );
  const messages = document.querySelectorAll(".chat-message-user").length;
  const authority = deferred<null>();
  api.getProviderRequestTarget.mockReturnValueOnce(authority.promise);
  await act(async () => change("a"));
  gateway.request.mockClear();
  const box = screen.getByPlaceholderText("chat.typeMessage");
  fireEvent.change(box, { target: { value: "keep this unsent prompt" } });
  fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
  expect(box).toHaveValue("keep this unsent prompt");
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.submit",
    expect.anything(),
  );
  await act(async () => authority.resolve(null));
  await screen.findByRole("alert");
  expect(box).toHaveValue("keep this unsent prompt");
  expect(document.querySelectorAll(".chat-message-user")).toHaveLength(
    messages,
  );
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.submit",
    expect.anything(),
  );
  expect(api.sendMessage).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "common.stop" })).toBeNull();
  await waitFor(() =>
    expect(
      document.querySelector(".status-usage")?.getAttribute("title"),
    ).toContain("1,550 total"),
  );
  expect(document.querySelector(".status-usage")?.textContent).toContain(
    "↑1.3k ↓250",
  );
});
