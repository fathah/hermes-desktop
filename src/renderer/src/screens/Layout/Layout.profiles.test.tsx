import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { profileEditorFixture } from "../../test/profileEditorFixture";
import { useState } from "react";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/settings/SettingsModalContext", () => ({
  useSettingsModal: () => ({ openSettings: vi.fn() }),
}));
vi.mock("../../components/profile/ProfileModalContext", () => ({
  useProfileModal: () => ({ openProfile: vi.fn() }),
}));
vi.mock("../Chat/Chat", () => ({
  default: function Chat({
    profile,
    connectionId,
    active,
    runId,
    initialSessionId,
  }: {
    profile: string;
    connectionId: string;
    active: boolean;
    runId: string;
    initialSessionId?: string;
  }) {
    const [draft, setDraft] = useState("");
    return active ? (
      <div
        data-testid="active-chat"
        data-run-id={runId}
        data-session-id={initialSessionId}
      >
        {connectionId}:{profile}
        <textarea
          aria-label="Conversation draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    ) : null;
  },
}));
vi.mock("./StatusBar", () => ({
  StatusBar: ({ activeProfile }: { activeProfile: string }) => (
    <div data-testid="selected-profile">{activeProfile}</div>
  ),
}));
vi.mock("./ActiveSessionsBar", () => ({ ActiveSessionsBar: () => null }));
vi.mock("./SidebarRecentSessions", () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect("existing-conversation")}>
      Resume existing conversation
    </button>
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
import Layout from "./Layout";
function row(
  id: string,
  active = false,
): Awaited<ReturnType<typeof window.hermesAPI.listProfiles>>[number] {
  return {
    id,
    name: id,
    isActive: active,
    isDefault: id === "default",
    path: "",
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: true,
  };
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}
function fixture(): {
  scope: ReturnType<typeof profileEditorFixture>;
  api: Record<string, ReturnType<typeof vi.fn>>;
} {
  const scope = profileEditorFixture("remote");
  const api = {
    ...scope.api,
    listProfiles: vi
      .fn()
      .mockResolvedValue([row("default", true), row("work")]),
    setActiveProfile: vi.fn().mockResolvedValue(true),
    createProfile: vi.fn(),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    isRemoteOnlyMode: vi.fn().mockResolvedValue(true),
    onUpdateAvailable: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloadProgress: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloaded: vi.fn().mockReturnValue(() => {}),
    onUpdateError: vi.fn().mockReturnValue(() => {}),
    onMenuNewChat: vi.fn().mockReturnValue(() => {}),
    onMenuSearchSessions: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return { scope, api };
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        /* JSDOM has no layout engine. */
      }
      disconnect(): void {
        /* No native observation to disconnect. */
      }
      unobserve(): void {
        /* JSDOM has no layout engine. */
      }
    },
  );
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
async function openAgents(): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.switchProfile" }),
  );
  fireEvent.click(await screen.findByText("agents.manageProfiles"));
  await screen.findByText("agents.newAgent");
}
// @lat: [[remote-profiles#Tests#Real Layout selection and chat acceptance]]
it("routes Remote selection and Chat through the actual Layout parent with captured authority", async () => {
  const { api } = fixture();
  render(<Layout connectionId="a" />);
  await openAgents();
  fireEvent.click(document.querySelectorAll(".agents-row")[1]);
  await waitFor(() =>
    expect(screen.getByTestId("selected-profile").textContent).toBe("work"),
  );
  expect(screen.getByTestId("active-chat").textContent).toBe("a:work");
  expect(api.setActiveProfile).toHaveBeenCalledWith(
    "work",
    expect.objectContaining({ mode: "remote" }),
  );
  fireEvent.click(screen.getAllByText("agents.chat")[0]);
  await waitFor(() =>
    expect(screen.getByTestId("active-chat").textContent).toBe("a:default"),
  );
});
// @lat: [[remote-profiles#Tests#Real Layout stale callback isolation]]
it("an old Agents selection cannot retarget the real parent after switching connections", async () => {
  const { scope, api } = fixture();
  const pending = deferred<boolean>();
  api.setActiveProfile.mockReturnValue(pending.promise);
  const view = render(<Layout connectionId="a" />);
  await openAgents();
  fireEvent.click(document.querySelectorAll(".agents-row")[1]);
  api.listProfiles.mockResolvedValue([row("server-b", true)]);
  await act(async () => {
    scope.change("b");
    view.rerender(<Layout connectionId="b" />);
  });
  await waitFor(() =>
    expect(screen.getByTestId("selected-profile").textContent).toBe("server-b"),
  );
  await act(async () => pending.resolve(true));
  expect(screen.getByTestId("selected-profile").textContent).toBe("server-b");
  expect(screen.getByTestId("active-chat").textContent).toBe("b:server-b");
});
// @lat: [[remote-profiles#Tests#Restoration cannot undo a newer choice]]
it("a delayed initial restore cannot undo the user's newly selected profile", async () => {
  const { api } = fixture();
  const restore =
    deferred<Awaited<ReturnType<typeof window.hermesAPI.listProfiles>>>();
  // ProfileSwitcher loads first, Layout appearance second, restoration third.
  api.listProfiles
    .mockResolvedValueOnce([row("default", true), row("work")])
    .mockResolvedValueOnce([row("default", true), row("work")])
    .mockReturnValueOnce(restore.promise);
  render(<Layout connectionId="a" />);
  await openAgents();
  fireEvent.click(document.querySelectorAll(".agents-row")[1]);
  await waitFor(() =>
    expect(screen.getByTestId("selected-profile").textContent).toBe("work"),
  );
  await act(async () => restore.resolve([row("default", true), row("work")]));
  expect(screen.getByTestId("active-chat").textContent).toBe("a:work");
});

// @lat: [[remote-profiles#Tests#Failed reload keeps the shell target aligned]]
it("aligns the visible chat with the default fallback when a same-ID reload cannot restore profiles", async () => {
  const { scope, api } = fixture();
  render(<Layout connectionId="a" />);
  await openAgents();
  fireEvent.click(document.querySelectorAll(".agents-row")[1]);
  await waitFor(() =>
    expect(screen.getByTestId("active-chat").textContent).toBe("a:work"),
  );
  api.listProfiles.mockRejectedValue(
    new Error("offline after reconfiguration"),
  );
  await act(async () => scope.change("a"));
  await waitFor(() =>
    expect(screen.getByTestId("selected-profile").textContent).toBe("default"),
  );
  expect(screen.getByTestId("active-chat").textContent).toBe("a:default");
});

// @lat: [[remote-profiles#Tests#Connection renames preserve the visible conversation]]
it.each(["selected label", "unrelated connection"] as const)(
  "preserves a named existing conversation and its draft after renaming the %s",
  async (renamed) => {
    const { scope, api } = fixture();
    render(<Layout connectionId="a" />);
    await openAgents();
    fireEvent.click(document.querySelectorAll(".agents-row")[1]);
    await waitFor(() =>
      expect(screen.getByTestId("active-chat")).toHaveTextContent("a:work"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Resume existing conversation" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-chat")).toHaveAttribute(
        "data-session-id",
        "existing-conversation",
      ),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation draft" }),
      { target: { value: "unsent named-profile draft" } },
    );
    const runId = screen.getByTestId("active-chat").getAttribute("data-run-id");
    // Both rename IPC paths emit selected configuration again without changing
    // its private settings or the main-issued authority token.
    api.listProfiles.mockResolvedValue([row("default"), row("work", true)]);
    await act(async () =>
      scope.listeners.forEach((notify) =>
        (notify as (config: { connectionId: string; name: string }) => void)({
          connectionId: "a",
          name:
            renamed === "selected label"
              ? "Renamed selected connection"
              : "Original selected connection",
        }),
      ),
    );
    expect(screen.getByTestId("selected-profile")).toHaveTextContent("work");
    expect(screen.getByTestId("active-chat")).toHaveAttribute(
      "data-run-id",
      runId,
    );
    expect(screen.getByTestId("active-chat")).toHaveAttribute(
      "data-session-id",
      "existing-conversation",
    );
    expect(
      screen.getByRole("textbox", { name: "Conversation draft" }),
    ).toHaveValue("unsent named-profile draft");
    expect(api.getSessionMessages).toHaveBeenCalledExactlyOnceWith(
      "existing-conversation",
      "a",
      "work",
    );
  },
);

// @lat: [[remote-profiles#Tests#Selected settings still reset profile restoration]]
it.each(["endpoint", "authentication"] as const)(
  "invalidates the named conversation after selected %s settings change",
  async () => {
    const { scope, api } = fixture();
    render(<Layout connectionId="a" />);
    await openAgents();
    fireEvent.click(document.querySelectorAll(".agents-row")[1]);
    await waitFor(() =>
      expect(screen.getByTestId("active-chat")).toHaveTextContent("a:work"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Resume existing conversation" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-chat")).toHaveAttribute(
        "data-session-id",
        "existing-conversation",
      ),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation draft" }),
      { target: { value: "old target draft" } },
    );
    const runId = screen.getByTestId("active-chat").getAttribute("data-run-id");
    api.listProfiles.mockResolvedValue([row("default", true), row("work")]);
    await act(async () => scope.change("a"));
    await waitFor(() =>
      expect(screen.getByTestId("active-chat")).toHaveTextContent("a:default"),
    );
    expect(
      screen.getByTestId("active-chat").getAttribute("data-run-id"),
    ).not.toBe(runId);
    expect(
      screen.getByRole("textbox", { name: "Conversation draft" }),
    ).toHaveValue("");
    expect(api.setActiveProfile).toHaveBeenCalledTimes(1);
  },
);

// @lat: [[remote-profiles#Tests#Renames during pending restoration preserve user choices]]
it.each([
  { userChose: false, oldReadTiming: "later" },
  { userChose: false, oldReadTiming: "during rename" },
  { userChose: true, oldReadTiming: "during rename" },
])(
  "retries renamed initial authority: choice=$userChose, old read=$oldReadTiming",
  async ({ userChose, oldReadTiming }) => {
    const { scope, api } = fixture();
    const restore =
      deferred<Awaited<ReturnType<typeof window.hermesAPI.listProfiles>>>();
    api.listProfiles
      .mockResolvedValueOnce([row("default", true), row("work")])
      .mockResolvedValueOnce([row("default", true), row("work")])
      .mockReturnValueOnce(restore.promise);
    render(<Layout connectionId="a" />);
    await waitFor(() =>
      expect(api.listProfiles.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    if (userChose) {
      await openAgents();
      fireEvent.click(document.querySelectorAll(".agents-row")[1]);
      await waitFor(() =>
        expect(screen.getByTestId("active-chat")).toHaveTextContent("a:work"),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Resume existing conversation" }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("active-chat")).toHaveAttribute(
          "data-session-id",
          "existing-conversation",
        ),
      );
    }
    const runId = screen.getByTestId("active-chat").getAttribute("data-run-id");
    api.listProfiles.mockResolvedValue([
      row("default", userChose),
      row("work", !userChose),
    ]);
    await act(async () => {
      scope.listeners.forEach((notify) => notify());
      if (oldReadTiming === "during rename") {
        restore.resolve([row("default", true), row("work")]);
        await Promise.resolve();
        await Promise.resolve();
      }
    });
    await waitFor(() =>
      expect(screen.getByTestId("active-chat")).toHaveTextContent("a:work"),
    );
    if (userChose)
      expect(screen.getByTestId("active-chat")).toHaveAttribute(
        "data-run-id",
        runId,
      );
    await act(async () => restore.resolve([row("default", true), row("work")]));
    expect(screen.getByTestId("active-chat")).toHaveTextContent("a:work");
  },
);
