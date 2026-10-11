import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../../components/common/HermesLogo", () => ({
  default: (): React.JSX.Element => <div data-testid="hermes-logo" />,
}));

// Agents reads the global profile modal via useProfileModal, which throws
// outside a ProfileModalProvider. These tests render Agents in isolation, so
// stub the hook with a no-op modal opener.
vi.mock("../../components/profile/ProfileModalContext", () => ({
  useProfileModal: () => ({
    openProfile: vi.fn(),
    closeProfile: vi.fn(),
  }),
}));

import Agents from "./Agents";
import { profileEditorFixture } from "../../test/profileEditorFixture";

interface ProfileInfo {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

function profile(name: string, isDefault = false): ProfileInfo {
  return {
    id: name,
    name,
    path: isDefault ? "C:/hermes" : `C:/hermes/profiles/${name}`,
    isDefault,
    isActive: isDefault,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
  };
}

function installHermesAPI(): {
  listProfiles: ReturnType<typeof vi.fn>;
  createProfile: ReturnType<typeof vi.fn>;
  deleteProfile: ReturnType<typeof vi.fn>;
  setActiveProfile: ReturnType<typeof vi.fn>;
} {
  const api = {
    ...profileEditorFixture().api,
    listProfiles: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    setActiveProfile: vi.fn(),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("Agents profile creation", () => {
  it("refreshes profiles after a failed create so ambiguous successes appear", async () => {
    const api = installHermesAPI();
    api.listProfiles
      .mockResolvedValueOnce([profile("default", true)])
      .mockResolvedValueOnce([profile("default", true), profile("test2")]);
    api.createProfile.mockResolvedValue({
      success: false,
      error:
        "Error: Profile 'test2' already exists at C:/hermes/profiles/test2",
    });

    render(
      <Agents
        activeProfile="default"
        onSelectProfile={() => {}}
        onChatWith={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("default")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("agents.newAgent"));
    fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
      target: { value: "test2" },
    });
    fireEvent.click(screen.getByText("agents.create"));

    expect(api.createProfile).toHaveBeenCalledWith(
      "test2",
      "default",
      expect.objectContaining({ mode: "local" }),
    );

    // The create modal stays open on failure (so the user can retry), and its
    // clone-from <select> also lists profiles — so "test2" can appear both as
    // an <option> and as the refreshed table row. Assert it shows up at all.
    await waitFor(() => {
      expect(screen.getAllByText("test2").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(api.listProfiles).toHaveBeenCalledTimes(2);
  });

  // Profile deletion (optimistic hide + rollback on failure) moved out of the
  // Agents screen into the ProfileModal danger zone, so its rendering tests no
  // longer belong here. The Agents screen only opens that modal now.
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  return {
    promise: new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    }),
    resolve,
    reject,
  };
}
function scopedApi(mode: "local" | "remote" | "ssh" = "remote"): {
  fixture: ReturnType<typeof profileEditorFixture>;
  api: Record<string, ReturnType<typeof vi.fn>>;
} {
  const fixture = profileEditorFixture(mode);
  const api = {
    ...fixture.api,
    listProfiles: vi
      .fn()
      .mockResolvedValue([profile("default", true), profile("work")]),
    createProfile: vi.fn(),
    setActiveProfile: vi.fn().mockResolvedValue(true),
    getAgentSyncStatus: vi
      .fn()
      .mockResolvedValue({ signedIn: true, running: false }),
    syncAgents: vi.fn().mockResolvedValue({ outcomes: [] }),
    onAgentSyncUpdated: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return { fixture, api };
}
async function showCreate(name = "new-one"): Promise<void> {
  fireEvent.click(await screen.findByText("agents.newAgent"));
  fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
    target: { value: name },
  });
}
// @lat: [[remote-profiles#Tests#Remote Agents capability and automatic sync]]
it("waits for authority and exposes Remote list/create without local editors or automatic/manual cloud sync", async () => {
  const { api } = scopedApi();
  const capture =
    deferred<
      Awaited<ReturnType<typeof window.hermesAPI.getProfileEditorTarget>>
    >();
  api.getProfileEditorTarget.mockReturnValue(capture.promise);
  render(
    <Agents
      activeProfile="default"
      onSelectProfile={vi.fn()}
      onChatWith={vi.fn()}
    />,
  );
  expect(screen.queryByText("agents.newAgent")).toBeNull();
  capture.resolve({
    connectionId: "a",
    profile: "default",
    mode: "remote",
    scopeToken: "a-scope",
  });
  expect(await screen.findByText("work")).toBeTruthy();
  expect(screen.queryByText("agents.sync")).toBeNull();
  expect(document.querySelector(".agents-row-edit")).toBeNull();
  expect(api.getAgentSyncStatus).not.toHaveBeenCalled();
  expect(api.syncAgents).not.toHaveBeenCalled();
});
// @lat: [[remote-profiles#Tests#Late lists and create results]]
it("clears forms and ignores an old list/create result when the connection changes", async () => {
  const { fixture, api } = scopedApi();
  const create = deferred<{ success: boolean; error?: string }>();
  api.createProfile.mockReturnValue(create.promise);
  render(
    <Agents
      activeProfile="default"
      onSelectProfile={vi.fn()}
      onChatWith={vi.fn()}
    />,
  );
  await showCreate();
  fireEvent.click(screen.getByText("agents.create"));
  api.listProfiles.mockResolvedValue([profile("server-b")]);
  await act(async () => fixture.change("b"));
  expect(await screen.findByText("server-b")).toBeTruthy();
  expect(screen.queryByPlaceholderText("agents.namePlaceholder")).toBeNull();
  const reads = api.listProfiles.mock.calls.length;
  create.resolve({ success: false, error: "A failed" });
  await waitFor(() => expect(api.listProfiles.mock.calls.length).toBe(reads));
  expect(screen.queryByRole("alert")).toBeNull();
  await showCreate("b-new");
  expect(
    (screen.getByText("agents.create") as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("ignores a delayed old list instead of adopting its rows in the new target", async () => {
  const { fixture, api } = scopedApi();
  const read = deferred<ProfileInfo[]>();
  api.listProfiles.mockReturnValueOnce(read.promise);
  render(
    <Agents
      activeProfile="default"
      onSelectProfile={vi.fn()}
      onChatWith={vi.fn()}
    />,
  );
  await waitFor(() => expect(api.listProfiles).toHaveBeenCalledTimes(1));
  api.listProfiles.mockResolvedValue([profile("server-b")]);
  await act(async () => fixture.change("b"));
  await screen.findByText("server-b");
  read.resolve([profile("old-a")]);
  await waitFor(() => expect(screen.queryByText("old-a")).toBeNull());
});
// @lat: [[remote-profiles#Tests#Late selection and chat callbacks]]
it.each([false, true])(
  "suppresses stale parent callbacks after a pending %s chat selection",
  async (chat) => {
    const { fixture, api } = scopedApi("ssh");
    const select = deferred<boolean>();
    api.setActiveProfile.mockReturnValue(select.promise);
    const onSelect = vi.fn(),
      onChat = vi.fn();
    render(
      <Agents
        activeProfile="default"
        onSelectProfile={onSelect}
        onChatWith={onChat}
      />,
    );
    await screen.findByText("work");
    if (chat) fireEvent.click(screen.getAllByText("agents.chat")[1]);
    else fireEvent.click(screen.getByText("work"));
    expect(api.setActiveProfile).toHaveBeenCalledWith(
      "work",
      expect.objectContaining({ mode: "ssh" }),
    );
    api.listProfiles.mockResolvedValue([profile("server-b")]);
    await act(async () => fixture.change("b", "remote"));
    await screen.findByText("server-b");
    const reads = api.listProfiles.mock.calls.length;
    select.resolve(true);
    await waitFor(() => expect(onSelect).not.toHaveBeenCalled());
    expect(onChat).not.toHaveBeenCalled();
    expect(api.listProfiles.mock.calls.length).toBe(reads);
  },
);
// @lat: [[remote-profiles#Tests#Action failures remain retryable]]
it("catches rejected creation and selection while keeping the current create draft retryable", async () => {
  const { api } = scopedApi();
  api.createProfile.mockRejectedValue(new Error("create refused"));
  api.setActiveProfile.mockRejectedValue(new Error("select refused"));
  render(
    <Agents
      activeProfile="default"
      onSelectProfile={vi.fn()}
      onChatWith={vi.fn()}
    />,
  );
  await showCreate();
  fireEvent.click(screen.getByText("agents.create"));
  expect(await screen.findByText("create refused")).toBeTruthy();
  await waitFor(() =>
    expect(
      (screen.getByText("agents.create") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(
    (screen.getByPlaceholderText("agents.namePlaceholder") as HTMLInputElement)
      .value,
  ).toBe("new-one");
  fireEvent.click(screen.getByText("common.cancel"));
  fireEvent.click(
    [...document.querySelectorAll(".agents-row")].find((row) =>
      row.textContent?.includes("work"),
    )!,
  );
  expect(await screen.findByText("select refused")).toBeTruthy();
});
// @lat: [[remote-profiles#Tests#Local cloud sync remains available]]
it("retains one automatic Local sync with captured authority", async () => {
  const { api } = scopedApi("local");
  render(
    <Agents
      activeProfile="default"
      onSelectProfile={vi.fn()}
      onChatWith={vi.fn()}
    />,
  );
  await waitFor(() => expect(api.syncAgents).toHaveBeenCalledTimes(1));
  expect(api.syncAgents).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "local" }),
  );
  expect(await screen.findByText("agents.sync")).toBeTruthy();
});
// @lat: [[remote-profiles#Tests#Gateway polls stop at target changes]]
it("does not apply or reschedule an admitted old SSH readiness poll after target change", async () => {
  vi.useFakeTimers();
  try {
    const { fixture, api } = scopedApi("ssh");
    render(
      <Agents
        activeProfile="default"
        onSelectProfile={vi.fn()}
        onChatWith={vi.fn()}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () =>
      fireEvent.click(
        [...document.querySelectorAll(".agents-row")].find((row) =>
          row.textContent?.includes("work"),
        )!,
      ),
    );
    const read = deferred<ProfileInfo[]>();
    api.listProfiles.mockReturnValueOnce(read.promise);
    await act(async () => vi.advanceTimersByTime(700));
    api.listProfiles.mockResolvedValue([profile("server-b")]);
    await act(async () => fixture.change("b", "remote"));
    const reads = api.listProfiles.mock.calls.length;
    await act(async () => {
      read.resolve([profile("old-a")]);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTime(10000));
    expect(screen.queryByText("old-a")).toBeNull();
    expect(api.listProfiles.mock.calls.length).toBe(reads);
  } finally {
    vi.useRealTimers();
  }
});
