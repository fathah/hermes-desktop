import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
type PublicConnectionConfig = Awaited<
  ReturnType<typeof window.hermesAPI.getConnectionConfig>
>;

vi.mock("../../components/useI18n", () => {
  const t = (key: string): string => key;
  return { useI18n: () => ({ t }) };
});
const gateway = vi.hoisted(() => ({
  clients: [] as Array<{
    onEvent?: (event: unknown) => void;
    closed: boolean;
    request: (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>;
  }>,
  request: vi.fn(),
}));
vi.mock("./dashboardGatewayClient", () => ({
  DashboardGatewayClient: class {
    connected = true;
    owner: {
      onEvent?: (event: unknown) => void;
      closed: boolean;
      request: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    constructor(options: { onEvent?: (event: unknown) => void }) {
      this.owner = {
        ...options,
        closed: false,
        request: (method, params) => this.request(method, params),
      };
      gateway.clients.push(this.owner);
    }
    async connect(): Promise<void> {
      // The real DashboardGatewayClient begins connect() by closing its old
      // socket before opening the new one; admission must survive that cleanup.
      this.close();
      this.owner.closed = false;
    }
    close(): void {
      this.owner.closed = true;
    }
    request = gateway.request;
  },
}));
import Chat from "./Chat";

let nextFixture = 0;
async function fixture(): Promise<{
  api: Record<string, ReturnType<typeof vi.fn>>;
  emit: (changes?: Partial<PublicConnectionConfig>) => void;
  rotateKey: (notificationId?: string) => void;
  beginAuthChange: (notificationId?: string) => void;
  finishAuthChange: (notificationId?: string) => void;
  target: () => { connectionId: string; revision: string };
}> {
  const authority = await import(
    "../../../../main/" + "provider-request-target"
  );
  let connection = {
    mode: "remote" as const,
    remoteUrl: `https://chat-config-${++nextFixture}.test`,
    apiKey: "aaaaaaaa",
    remoteAuthMode: "token" as const,
    remoteChatTransport: "dashboard" as const,
    sshChatTransport: "auto" as const,
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 8642,
    },
  };
  let name = "Initial label";
  const publicConfig = (): PublicConnectionConfig => ({
    connectionId: "a",
    name,
    mode: connection.mode,
    remoteUrl: connection.remoteUrl,
    remoteAuthMode: connection.remoteAuthMode,
    remoteChatTransport: connection.remoteChatTransport,
    sshChatTransport: connection.sshChatTransport,
    hasApiKey: true,
    apiKeyLength: connection.apiKey.length,
    ssh: connection.ssh,
  });
  const target = (): { connectionId: string; revision: string } => ({
    connectionId: "a",
    revision: authority.providerTargetRevision(connection),
  });
  const listeners = new Set<(config: PublicConnectionConfig) => void>();
  const emit = (changes: Partial<PublicConnectionConfig> = {}): void => {
    if (!changes.connectionId || changes.connectionId === "a") {
      if (changes.name) name = changes.name;
      if (changes.remoteUrl)
        connection = { ...connection, remoteUrl: changes.remoteUrl };
    }
    listeners.forEach((callback) =>
      callback({ ...publicConfig(), ...changes }),
    );
  };
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    sendMessage: vi.fn().mockResolvedValue(null),
    getProviderRequestTarget: vi.fn(async () => target()),
    getConnectionConfig: vi.fn(async () => publicConfig()),
    onConnectionConfigChanged: vi.fn(
      (callback: (config: PublicConnectionConfig) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    ),
    probeRemoteAuthMode: vi.fn().mockResolvedValue({ authMode: "token" }),
    getModelConfig: vi
      .fn()
      .mockResolvedValue({ model: "gpt-x", provider: "openai" }),
    listModels: vi.fn().mockResolvedValue([]),
    discoverModels: vi.fn().mockResolvedValue({ models: [], status: "ok" }),
    getConfig: vi.fn().mockResolvedValue(null),
    getConfigHealth: vi.fn().mockResolvedValue(null),
    getSessionUsage: vi.fn().mockResolvedValue(null),
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
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: new Proxy(api, {
      get(record, key: string) {
        record[key] ||= key.startsWith("on")
          ? vi.fn().mockReturnValue(() => {})
          : vi.fn().mockResolvedValue(null);
        return record[key];
      },
    }),
  });
  gateway.request.mockImplementation(async (method: string) => {
    if (method === "session.resume")
      return {
        session_id: "runtime-saved",
        resumed: "saved",
        info: { usage: { input: 1000, output: 200, total: 1200 } },
      };
    if (method === "model.options")
      return { model: "gpt-x", provider: "openai", providers: [] };
    return { status: "ok" };
  });
  return {
    api,
    emit,
    rotateKey: (notificationId = "a") => {
      connection = { ...connection, apiKey: "bbbbbbbb" };
      emit({ connectionId: notificationId });
    },
    beginAuthChange: (notificationId = "a") => {
      authority.beginProviderAuthChange(connection.remoteUrl);
      emit({ connectionId: notificationId });
    },
    finishAuthChange: (notificationId = "a") => {
      authority.finishProviderAuthChange(connection.remoteUrl);
      emit({ connectionId: notificationId });
    },
    target,
  };
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hermes-follow-x-dismissed", "true");
  gateway.clients.length = 0;
  gateway.request.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        /* No native layout observer in JSDOM. */
      }
      disconnect(): void {
        /* No native layout observer in JSDOM. */
      }
      unobserve(): void {
        /* No native layout observer in JSDOM. */
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {
        /* No native layout observer in JSDOM. */
      }
      disconnect(): void {
        /* No native layout observer in JSDOM. */
      }
      unobserve(): void {
        /* No native layout observer in JSDOM. */
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
function renderChat(): ReturnType<typeof render> {
  return render(
    <Chat
      runId="run"
      connectionId="a"
      profile="work"
      initialSessionId="saved"
      initialMessages={[
        { role: "user", id: "1", content: "saved history" },
        { role: "agent", id: "2", content: "saved reply" },
      ]}
    />,
  );
}
async function send(waitForReady = true): Promise<void> {
  if (waitForReady)
    await waitFor(() =>
      expect(gateway.request).toHaveBeenCalledWith(
        "commands.catalog",
        expect.anything(),
      ),
    );
  const box = screen
    .getAllByRole("textbox")
    .find((el) => el.tagName === "TEXTAREA")!;
  fireEvent.change(box, { target: { value: "new prompt" } });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "chat.send" }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
  await waitFor(() =>
    expect(gateway.request).toHaveBeenCalledWith(
      "prompt.submit",
      expect.anything(),
    ),
  );
}
async function complete(text = "native completed"): Promise<void> {
  await act(async () =>
    gateway.clients.at(-1)?.onEvent?.({
      type: "message.complete",
      session_id: "runtime-saved",
      payload: {
        text,
        status: "ok",
        usage: {
          input: 1300,
          output: 250,
          total: 1550,
          context_used: 400,
          context_max: 200000,
        },
      },
    }),
  );
}

// @lat: [[remote-profiles#Tests#Harmless connection notifications preserve native chat]]
it.each([
  "selected label",
  "unrelated registry edit",
  "different selected connection",
])(
  "preserves a running native chat and draft after %s notification",
  async (kind) => {
    const { emit } = await fixture();
    renderChat();
    await send();
    const client = gateway.clients.at(-1)!;
    const box = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(box, { target: { value: "retained draft" } });
    await act(async () =>
      emit(
        kind === "selected label"
          ? { name: "Friendly label" }
          : kind === "unrelated registry edit"
            ? {}
            : {
                connectionId: "b",
                mode: "local",
                remoteUrl: "https://unrelated.test",
              },
      ),
    );
    expect(client.closed).toBe(false);
    expect(screen.getByText("saved history")).toBeTruthy();
    await complete();
    await screen.findByText("native completed");
    expect((box as HTMLTextAreaElement).value).toBe("retained draft");
    expect(gateway.clients).toHaveLength(1);
  },
);

// @lat: [[remote-profiles#Tests#Private connection authority changes invalidate chat]]
it.each(["address", "same-length key", "OAuth epoch"])(
  "invalidates native transport when %s changes",
  async (kind) => {
    const f = await fixture();
    renderChat();
    await send();
    const client = gateway.clients.at(-1)!;
    await act(async () => {
      if (kind === "address")
        f.emit({ remoteUrl: "https://changed-address.test" });
      else if (kind === "same-length key") f.rotateKey();
      else {
        f.beginAuthChange();
        f.finishAuthChange();
      }
    });
    expect(client.closed).toBe(true);
  },
);

// @lat: [[remote-profiles#Tests#Unknown connection authority invalidates chat]]
it("invalidates the native client while OAuth authority capture is busy", async () => {
  const f = await fixture();
  renderChat();
  await send();
  const client = gateway.clients.at(-1)!;
  try {
    await act(async () => f.beginAuthChange());
    expect(client.closed).toBe(true);
  } finally {
    await act(async () => f.finishAuthChange());
  }
});

// @lat: [[remote-profiles#Tests#Late connection capture cannot replace newer authority]]
it("ignores a late label capture after key rotation and preserves the newly connected runtime", async () => {
  const f = await fixture();
  renderChat();
  await send();
  await complete();
  const oldTarget = f.target();
  let resolve!: (value: typeof oldTarget) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<typeof oldTarget>((done) => {
      resolve = done;
    }),
  );
  await act(async () => f.emit({ name: "Delayed label" }));
  await act(async () => f.rotateKey());
  expect(gateway.clients[0].closed).toBe(true);
  gateway.request.mockClear();
  await send(false);
  const current = gateway.clients.at(-1)!;
  expect(current.closed).toBe(false);
  await act(async () => resolve(oldTarget));
  expect(current.closed).toBe(false);
  await complete("current authority completed");
  await screen.findByText("current authority completed");
});

// @lat: [[remote-profiles#Tests#Pending label authority preserves admitted native work]]
it("holds native writes and events until a deferred label authority is accepted", async () => {
  const f = await fixture();
  renderChat();
  await send();
  const client = gateway.clients.at(-1)!;
  const target = f.target();
  let resolve!: (value: typeof target) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<typeof target>((done) => {
      resolve = done;
    }),
  );
  await act(async () => f.emit({ name: "Deferred label" }));
  gateway.request.mockClear();
  const write = client.request("prompt.background", { text: "same target" });
  await complete("held native completion");
  expect(client.closed).toBe(false);
  expect(screen.queryByText("held native completion")).toBeNull();
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.background",
    expect.anything(),
  );
  await act(async () => {
    resolve(target);
    await write;
  });
  await screen.findByText("held native completion");
  expect(gateway.request).toHaveBeenCalledWith("prompt.background", {
    text: "same target",
  });
  expect(client.closed).toBe(false);
});

// @lat: [[remote-profiles#Tests#Deferred private change rejects old native callbacks]]
it("rejects captured native writes and late events after deferred private authority changes", async () => {
  const f = await fixture();
  renderChat();
  await send();
  const client = gateway.clients.at(-1)!;
  let resolve!: (value: ReturnType<typeof f.target>) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<ReturnType<typeof f.target>>((done) => {
      resolve = done;
    }),
  );
  await act(async () => f.rotateKey());
  gateway.request.mockClear();
  const write = client
    .request("prompt.background", { text: "stale target" })
    .then(
      () => "accepted",
      () => "rejected",
    );
  await complete("obsolete private completion");
  expect(client.closed).toBe(false);
  expect(gateway.request).not.toHaveBeenCalled();
  await act(async () => {
    resolve(f.target());
    expect(await write).toBe("rejected");
  });
  expect(client.closed).toBe(true);
  expect(screen.queryByText("obsolete private completion")).toBeNull();
  await expect(
    client.request("prompt.submit", { text: "captured old callback" }),
  ).rejects.toThrow("authority changed");
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.background",
    expect.anything(),
  );
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.submit",
    expect.anything(),
  );
  expect(f.api.sendMessage).not.toHaveBeenCalled();
});

// @lat: [[remote-profiles#Tests#Pending chat submission waits for private authority]]
it.each(["equal", "changed"])(
  "holds actual Send until deferred authority is %s",
  async (kind) => {
    const f = await fixture();
    renderChat();
    await send();
    await complete();
    const client = gateway.clients.at(-1)!;
    let resolve!: (value: ReturnType<typeof f.target>) => void;
    f.api.getProviderRequestTarget.mockReturnValueOnce(
      new Promise<ReturnType<typeof f.target>>((done) => {
        resolve = done;
      }),
    );
    await act(async () =>
      kind === "equal" ? f.emit({ name: "Pending label" }) : f.rotateKey(),
    );
    gateway.request.mockClear();
    const box = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(box, { target: { value: "waiting prompt" } });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "chat.send" })),
    );
    expect(gateway.request).not.toHaveBeenCalledWith(
      "prompt.submit",
      expect.anything(),
    );
    expect(f.api.sendMessage).not.toHaveBeenCalled();
    await act(async () => resolve(f.target()));
    if (kind === "equal") {
      await waitFor(() =>
        expect(gateway.request).toHaveBeenCalledWith(
          "prompt.submit",
          expect.objectContaining({ text: "waiting prompt" }),
        ),
      );
      expect(client.closed).toBe(false);
    } else {
      expect(client.closed).toBe(true);
      expect(gateway.request).not.toHaveBeenCalledWith(
        "prompt.submit",
        expect.anything(),
      );
      expect(f.api.sendMessage).not.toHaveBeenCalled();
      expect(box).toHaveValue("waiting prompt");
      await screen.findByRole("alert");
    }
  },
);

// @lat: [[remote-profiles#Tests#Refused submissions retain their payload]]
it.each(["send", "quick ask", "background command"])(
  "retains the actual composer text and attachment when %s loses authority",
  async (kind) => {
    const f = await fixture();
    renderChat();
    await send();
    await complete();
    const box = screen.getByPlaceholderText("chat.typeMessage");
    const text = kind === "background command" ? "/btw keep me" : "keep me";
    fireEvent.change(box, { target: { value: text } });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [
          new File(["retained file"], "retained.txt", { type: "text/plain" }),
        ],
      },
    });
    await screen.findByRole("button", { name: "Remove retained.txt" });
    let resolve!: (value: ReturnType<typeof f.target>) => void;
    f.api.getProviderRequestTarget.mockReturnValueOnce(
      new Promise<ReturnType<typeof f.target>>((done) => {
        resolve = done;
      }),
    );
    await act(async () => f.rotateKey());
    gateway.request.mockClear();
    fireEvent.click(
      screen.getByTitle(
        kind === "quick ask" ? "chat.quickAskTitle" : "chat.send",
      ),
    );
    await act(async () => resolve(f.target()));
    expect(box).toHaveValue(text);
    expect(
      screen.getByRole("button", { name: "Remove retained.txt" }),
    ).toBeTruthy();
    await screen.findByRole("alert");
    expect(gateway.request).not.toHaveBeenCalledWith(
      "prompt.submit",
      expect.anything(),
    );
    expect(gateway.request).not.toHaveBeenCalledWith(
      "prompt.background",
      expect.anything(),
    );
    expect(f.api.sendMessage).not.toHaveBeenCalled();
  },
);

// @lat: [[remote-profiles#Tests#Refused queued submissions remain recoverable]]
it("restores a queued prompt when private authority refuses its drain", async () => {
  const f = await fixture();
  renderChat();
  await send();
  const box = screen.getByPlaceholderText("chat.typeMessage");
  fireEvent.change(box, { target: { value: "queued intent" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByText("queued intent");
  let resolve!: (value: ReturnType<typeof f.target>) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<ReturnType<typeof f.target>>((done) => {
      resolve = done;
    }),
  );
  await act(async () => f.rotateKey());
  gateway.request.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "common.stop" }));
  await act(async () => resolve(f.target()));
  await waitFor(() =>
    expect(document.querySelector(".chat-queue-single")?.textContent).toBe(
      "queued intent",
    ),
  );
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.submit",
    expect.anything(),
  );
  expect(f.api.sendMessage).not.toHaveBeenCalled();
});

it("does not reinsert a refused old queued prompt into a different run or profile", async () => {
  const f = await fixture();
  const view = renderChat();
  await send();
  const box = screen.getByPlaceholderText("chat.typeMessage");
  fireEvent.change(box, { target: { value: "old queued intent" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByText("old queued intent");
  let resolve!: (value: ReturnType<typeof f.target>) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<ReturnType<typeof f.target>>((done) => {
      resolve = done;
    }),
  );
  await act(async () => f.rotateKey());
  fireEvent.click(screen.getByRole("button", { name: "common.stop" }));
  view.rerender(
    <Chat
      runId="different-run"
      connectionId="a"
      profile="other-profile"
      initialSessionId="saved"
      initialMessages={[]}
    />,
  );
  await act(async () => resolve(f.target()));
  expect(document.querySelector(".chat-queue-single")).toBeNull();
  expect(f.api.sendMessage).not.toHaveBeenCalled();
});

// @lat: [[remote-profiles#Tests#Retained chat validates its own changed authority]]
it.each(["same-length key", "shared-origin OAuth"])(
  "validates a retained chat's own %s revision when the notification names another selected connection",
  async (kind) => {
    const f = await fixture();
    renderChat();
    await send();
    await complete();
    const old = gateway.clients.at(-1)!;
    await act(async () => {
      if (kind === "same-length key") f.rotateKey("b");
      else {
        f.beginAuthChange("b");
        f.finishAuthChange("b");
      }
    });
    expect(old.closed).toBe(true);
    expect(f.api.getConnectionConfig).toHaveBeenLastCalledWith("a");
    gateway.request.mockClear();
    await send(false);
    expect(gateway.request).toHaveBeenCalledWith(
      "prompt.submit",
      expect.anything(),
    );
    expect(f.api.sendMessage).not.toHaveBeenCalled();
  },
);

// @lat: [[remote-profiles#Tests#Closed native client cannot deliver buffered replies]]
it("rejects an old client's buffered completion after an equal-authority reconnect", async () => {
  const f = await fixture();
  renderChat();
  await send();
  const old = gateway.clients.at(-1)! as (typeof gateway.clients)[number] & {
    onClose?: () => void;
  };
  const target = f.target();
  let resolveFirst!: (value: typeof target) => void;
  let resolveSecond!: (value: typeof target) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<typeof target>((done) => {
      resolveFirst = done;
    }),
  );
  await act(async () => f.emit({ name: "first delayed label" }));
  await complete("obsolete transport completion");
  expect(screen.queryByText("obsolete transport completion")).toBeNull();
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<typeof target>((done) => {
      resolveSecond = done;
    }),
  );
  await act(async () => f.emit({ name: "second delayed label" }));
  // Close while classification is still pending; a later accepted capture
  // cannot transfer this old socket's buffered event to a replacement.
  await act(async () => old.onClose?.());
  fireEvent.click(document.querySelector(".chat-stop-btn")!);
  await act(async () => resolveSecond(target));
  gateway.request.mockClear();
  await send(false);
  expect(gateway.clients).toHaveLength(2);
  expect(document.querySelector(".chat-stop-btn")).not.toBeNull();
  await act(async () => resolveFirst(target));
  expect(screen.queryByText("obsolete transport completion")).toBeNull();
  expect(document.querySelector(".chat-stop-btn")).not.toBeNull();
  await expect(
    old.request("prompt.background", { text: "old closed callback" }),
  ).rejects.toThrow("authority changed");
});

// @lat: [[remote-profiles#Tests#Failed retained settings cannot borrow selected mode]]
it("fails closed without adopting the selected Local mode when a retained Remote settings read fails", async () => {
  const f = await fixture();
  renderChat();
  await send();
  await complete();
  const old = gateway.clients.at(-1)!;
  f.api.getConnectionConfig.mockRejectedValue(
    new Error("own settings unavailable"),
  );
  f.api.validateChatReadiness.mockClear();
  await act(async () => f.rotateKey("b"));
  await act(async () => f.emit({ connectionId: "b", mode: "local" }));
  expect(old.closed).toBe(true);
  // Readiness depends on connection mode; borrowing B would start a Local check.
  expect(f.api.validateChatReadiness).not.toHaveBeenCalled();
  gateway.request.mockClear();
  const box = screen
    .getAllByRole("textbox")
    .find((el) => el.tagName === "TEXTAREA")!;
  fireEvent.change(box, { target: { value: "unverified retained target" } });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "chat.send" })),
  );
  expect(gateway.request).not.toHaveBeenCalledWith(
    "prompt.submit",
    expect.anything(),
  );
  expect(f.api.sendMessage).not.toHaveBeenCalled();
});

// @lat: [[remote-profiles#Tests#Pending native events retain receipt order]]
it("preserves approval-before-terminal order and wakes obsolete equal-authority reads", async () => {
  const f = await fixture();
  renderChat();
  await send();
  const target = f.target();
  let resolveFirst!: (value: typeof target) => void;
  let resolveSecond!: (value: typeof target) => void;
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<typeof target>((done) => {
      resolveFirst = done;
    }),
  );
  await act(async () => f.emit({ name: "first pending label" }));
  await act(async () =>
    gateway.clients.at(-1)?.onEvent?.({
      type: "approval.request",
      session_id: "runtime-saved",
      payload: {
        request_id: "ordered-approval",
        command: "echo fixture",
        description: "ordered approval",
        choices: ["once", "deny"],
      },
    }),
  );
  f.api.getProviderRequestTarget.mockReturnValueOnce(
    new Promise<typeof target>((done) => {
      resolveSecond = done;
    }),
  );
  await act(async () => f.emit({ name: "second pending label" }));
  await act(async () => resolveSecond(target));
  await complete("ordered terminal");
  // The newer valid capture releases the ordered stream while P1 stays pending.
  await screen.findByText("ordered terminal");
  expect(screen.getByText("ordered approval")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "chat.approval.once" }),
  ).toBeNull();
  expect(screen.getByText("chat.approval.unavailable")).toBeTruthy();
  await act(async () => resolveFirst(target));
  expect(
    screen.queryByRole("button", { name: "chat.approval.once" }),
  ).toBeNull();
});
