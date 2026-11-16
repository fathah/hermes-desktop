import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sharedI18n } from "../../../../shared/i18n";
import { SettingsDataContext } from "./SettingsDataContext";
import { useSettingsData } from "./useSettingsData";
import AboutPane from "./AboutPane";

vi.mock("../useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      sharedI18n.t(key, values),
  }),
}));
vi.mock("../../screens/Settings/ConfigHealth", () => ({
  ConfigHealth: () => null,
}));

type Progress = {
  percent: number | null;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};
type AgentProgress = {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
  operation?: "update";
  requestId?: string;
};
const listeners: {
  progress?: (p: Progress) => void;
  downloaded?: () => void;
  agent?: (p: AgentProgress) => void;
  config?: () => void;
} = {};
let resolveAgent: (result: { success: boolean; error?: string }) => void;
let removeAgent: ReturnType<typeof vi.fn>;

function emitAgent(progress: AgentProgress): void {
  listeners.agent?.({
    ...progress,
    requestId:
      progress.requestId ??
      vi.mocked(window.hermesAPI.runHermesUpdate).mock.calls.at(-1)?.[0],
  });
}

function Harness({
  profile = "work",
}: {
  profile?: string;
}): React.JSX.Element {
  const data = useSettingsData(profile);
  return (
    <SettingsDataContext.Provider value={data}>
      <AboutPane />
    </SettingsDataContext.Provider>
  );
}

beforeEach(async () => {
  await sharedI18n.changeLanguage("en");
  localStorage.clear();
  localStorage.setItem("hermes-openclaw-dismissed", "true");
  removeAgent = vi.fn();
  listeners.agent = undefined;
  const connection = {
    connectionId: "local",
    name: "Local",
    mode: "local",
    remoteUrl: "",
    hasApiKey: false,
    apiKeyLength: 0,
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getAppVersion: vi.fn(async () => "0.7.7"),
      getConnectionConfig: vi.fn(async () => connection),
      getConnectionRegistry: vi.fn(async () => ({
        connections: [connection],
        activeConnectionId: "local",
      })),
      getConnectionStatuses: vi.fn(async () => []),
      getApiServerKeyStatus: vi.fn(async () => ({ hasKey: true })),
      getAutoUpgradeEnabled: vi.fn(async () => true),
      getHermesHome: vi.fn(async () => "/isolated/test-home"),
      refreshHermesVersion: vi.fn(async () => "Hermes Agent v1.1.0"),
      getHermesVersion: vi.fn(
        async () => "Hermes Agent v1.0.0 Update available: v1.1.0",
      ),
      getAgentCapabilities: vi.fn(async () => ({
        canUpdate: true,
        compatibility: "compatible",
      })),
      getConfig: vi.fn(async () => ""),
      onConnectionConfigChanged: vi.fn((cb) => {
        listeners.config = cb;
        return vi.fn();
      }),
      onUpdateAvailable: vi.fn(() => vi.fn()),
      onUpdateDownloadProgress: vi.fn((cb) => {
        listeners.progress = cb;
        return vi.fn();
      }),
      onUpdateDownloaded: vi.fn((cb) => {
        listeners.downloaded = cb;
        return vi.fn();
      }),
      onUpdateError: vi.fn(() => vi.fn()),
      onInstallProgress: vi.fn((cb) => {
        listeners.agent = cb;
        return removeAgent;
      }),
      runHermesUpdate: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAgent = resolve;
          }),
      ),
      checkForUpdates: vi.fn(async () => null),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
});
async function ready(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Update Engine" })).toBeEnabled(),
  );
}

// @lat: [[agent-capabilities#Test specifications#Future contract update direction]]
it.each(["en", "he"])(
  "directs a newer Agent contract to the desktop updater in %s",
  async (locale) => {
    await sharedI18n.changeLanguage(locale);
    vi.mocked(window.hermesAPI.getAgentCapabilities).mockResolvedValue({
      compatibility: "desktop-update-recommended",
      canUpdate: true,
      desktopContract: 9,
      recommendedDesktopContract: 8,
    } as Awaited<ReturnType<typeof window.hermesAPI.getAgentCapabilities>>);
    render(<Harness />);

    await screen.findByText("Desktop update needed");
    expect(
      screen.getByText(/This Agent uses a newer interface/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: sharedI18n.t("settings.updateEngine"),
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: sharedI18n.t("settings.checkForUpdates"),
      }),
    );
    await waitFor(() =>
      expect(window.hermesAPI.checkForUpdates).toHaveBeenCalledTimes(1),
    );
    expect(window.hermesAPI.runHermesUpdate).not.toHaveBeenCalled();
  },
);

// @lat: [[desktop-updates#Progress evidence#About download measurements]]
it("retains bytes, speed and fractional progress in the actual About pane", async () => {
  render(<Harness />);
  await ready();
  act(() =>
    listeners.progress?.({
      percent: 50.25,
      transferred: 1572864,
      total: 3145728,
      bytesPerSecond: 524288,
    }),
  );
  expect(screen.getByText(/1.5 MiB.*3 MiB.*512 KiB\/s/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Downloading 50.3%/ }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Restart to update" }),
  ).not.toBeInTheDocument();
  act(() => listeners.downloaded?.());
  expect(
    screen.getByRole("button", { name: "Restart to update" }),
  ).toBeEnabled();
});

// @lat: [[desktop-updates#Progress evidence#Unknown and inactive download feedback]]
it("shows unknown totals honestly and replaces stale speed with waiting feedback", async () => {
  render(<Harness />);
  await ready();
  vi.useFakeTimers();
  act(() => listeners.progress?.({ percent: null, transferred: 8192 }));
  expect(
    screen.getByRole("button", { name: /Downloading\.\.\./ }),
  ).toBeDisabled();
  expect(screen.queryByText(/Downloading 0%/)).not.toBeInTheDocument();
  act(() =>
    listeners.progress?.({
      percent: 25,
      transferred: 1048576,
      total: 4194304,
      bytesPerSecond: 524288,
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(vi.getTimerCount()).toBe(0);
  expect(
    screen.getByRole("button", { name: /Waiting for download progress/ }),
  ).toBeDisabled();
  expect(screen.queryByText(/KiB\/s/)).not.toBeInTheDocument();
  expect(screen.getByText(/1 MiB.*4 MiB/)).toBeInTheDocument();
  act(() =>
    listeners.progress?.({
      percent: 50,
      transferred: 2097152,
      total: 4194304,
      bytesPerSecond: 1048576,
    }),
  );
  expect(
    screen.getByRole("button", { name: /Downloading 50%/ }),
  ).toBeDisabled();
  act(() => listeners.downloaded?.());
  expect(
    screen.getByRole("button", { name: "Restart to update" }),
  ).toBeEnabled();
});

// @lat: [[desktop-updates#Agent phases#About phase lifetime]]
it("shows only admitted Agent update phases until the update result completes", async () => {
  render(<Harness />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
  act(() =>
    emitAgent({
      operation: "update",
      step: 1,
      totalSteps: 1,
      title: "Checking dashboard compatibility",
      detail: "Validating the updated Agent",
      log: "validation\n",
    }),
  );
  expect(
    screen.getByText("Checking dashboard compatibility"),
  ).toBeInTheDocument();
  expect(screen.getByText("Validating the updated Agent")).toBeInTheDocument();
  expect(screen.queryByText("100%")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Hermes updated successfully."),
  ).not.toBeInTheDocument();
  act(() =>
    emitAgent({
      step: 7,
      totalSteps: 7,
      title: "Unrelated migration",
      detail: "other task",
      log: "other",
    }),
  );
  expect(screen.queryByText("Unrelated migration")).not.toBeInTheDocument();
  await act(async () => {
    resolveAgent({ success: true });
  });
  expect(screen.getByText("Hermes updated successfully.")).toBeInTheDocument();
  expect(
    screen.queryByText("Checking dashboard compatibility"),
  ).not.toBeInTheDocument();
  expect(removeAgent).toHaveBeenCalledOnce();
});

// @lat: [[desktop-updates#Agent phases#Changed profile rejects old progress]]
it.each([{ success: true }, { success: false, error: "Old update failure" }])(
  "rejects old Agent progress and result after the About profile changes (%j)",
  async (oldResult) => {
    const view = render(<Harness />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
    view.rerender(<Harness profile="other" />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() =>
      emitAgent({
        operation: "update",
        step: 1,
        totalSteps: 1,
        title: "Old target update",
        detail: "wrong owner",
        log: "old",
      }),
    );
    await act(async () => {
      resolveAgent(oldResult);
    });
    expect(screen.queryByText("Old update failure")).not.toBeInTheDocument();
    expect(screen.queryByText("Old target update")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Hermes updated successfully."),
    ).not.toBeInTheDocument();
    expect(removeAgent).toHaveBeenCalledOnce();
  },
);

// @lat: [[desktop-updates#Agent phases#Changed connection rejects old progress]]
it("clears an old phase and rejects its late result after same-ID connection reload", async () => {
  render(<Harness />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
  const oldPhase = {
    operation: "update" as const,
    step: 0,
    totalSteps: 0,
    title: "Old target phase",
    detail: "old machine",
    log: "old",
  };
  act(() => emitAgent(oldPhase));
  expect(screen.getByText("Old target phase")).toBeInTheDocument();
  act(() => listeners.config?.());
  await act(async () => {
    await Promise.resolve();
  });
  act(() => emitAgent(oldPhase));
  await act(async () => {
    resolveAgent({ success: false, error: "Old config failure" });
  });
  expect(screen.queryByText("Old target phase")).not.toBeInTheDocument();
  expect(screen.queryByText("Old config failure")).not.toBeInTheDocument();
  expect(removeAgent).toHaveBeenCalledOnce();
});

// @lat: [[desktop-updates#Agent phases#Unmount releases the progress listener]]
it("releases a pending Agent update listener immediately on unmount", async () => {
  const view = render(<Harness />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
  view.unmount();
  expect(removeAgent).toHaveBeenCalledOnce();
  await act(async () => {
    resolveAgent({ success: true });
  });
  expect(removeAgent).toHaveBeenCalledOnce();
});

// @lat: [[desktop-updates#Agent phases#Reopened pane rejects another update job]]
it("does not borrow old update phases after About is reopened for a new update", async () => {
  let first!: ReturnType<typeof render>;
  // Settle the initial target's passive effects before admitting either job.
  await act(async () => {
    first = render(<Harness />);
  });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
  await waitFor(() => {
    expect(window.hermesAPI.runHermesUpdate).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.onInstallProgress).toHaveBeenCalledTimes(1);
  });
  const firstId = vi.mocked(window.hermesAPI.runHermesUpdate).mock.calls[0][0];
  expect(firstId).toMatch(/^[\da-f-]{36}$/);
  const finishFirst = resolveAgent;
  first.unmount();
  await act(async () => {
    render(<Harness profile="other" />);
  });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
  await waitFor(() => {
    expect(window.hermesAPI.runHermesUpdate).toHaveBeenCalledTimes(2);
    expect(window.hermesAPI.onInstallProgress).toHaveBeenCalledTimes(2);
  });
  const secondId = vi.mocked(window.hermesAPI.runHermesUpdate).mock.calls[1][0];
  expect(secondId).toMatch(/^[\da-f-]{36}$/);
  expect(secondId).not.toBe(firstId);
  expect(removeAgent).toHaveBeenCalledTimes(1);
  const finishSecond = resolveAgent;
  act(() =>
    emitAgent({
      operation: "update",
      requestId: firstId,
      step: 0,
      totalSteps: 0,
      title: "Old update job",
      detail: "old job",
      log: "old",
    }),
  );
  expect(screen.queryByText("Old update job")).not.toBeInTheDocument();
  act(() =>
    emitAgent({
      operation: "update",
      requestId: secondId,
      step: 0,
      totalSteps: 0,
      title: "Current update job",
      detail: "current job",
      log: "current",
    }),
  );
  expect(screen.getByText("Current update job")).toBeInTheDocument();
  await act(async () => {
    finishFirst({ success: true });
  });
  expect(screen.getByText("Current update job")).toBeInTheDocument();
  expect(removeAgent).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishSecond({ success: true });
  });
  expect(removeAgent).toHaveBeenCalledTimes(2);
});

// @lat: [[desktop-updates#Agent phases#Initial metadata preserves an admitted update]]
it("keeps a cached-ready job while same-config metadata settles but revokes it on a new config epoch", async () => {
  localStorage.setItem(
    "hermes-version-cache:local:work",
    "Hermes Agent v1.0.0 Update available: v1.1.0",
  );
  let finishHome!: (home: string) => void;
  vi.mocked(window.hermesAPI.getHermesHome).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishHome = resolve;
      }),
  );
  await act(async () => {
    render(<Harness />);
  });
  await ready();
  expect(window.hermesAPI.getHermesHome).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("/isolated/test-home")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Update Engine" }));
  await waitFor(() =>
    expect(window.hermesAPI.runHermesUpdate).toHaveBeenCalledTimes(1),
  );
  const requestId = vi.mocked(window.hermesAPI.runHermesUpdate).mock
    .calls[0][0];
  expect(requestId).toMatch(/^[\da-f-]{36}$/);
  const finishUpdate = resolveAgent;
  const phase = {
    operation: "update" as const,
    requestId,
    step: 0,
    totalSteps: 0,
    title: "Admitted cached update",
    detail: "current job",
    log: "current",
  };
  act(() => emitAgent(phase));
  expect(screen.getByText("Admitted cached update")).toBeInTheDocument();
  await act(async () => {
    finishHome("/isolated/test-home");
  });
  expect(screen.getByText("/isolated/test-home")).toBeInTheDocument();
  expect(screen.getByText("Admitted cached update")).toBeInTheDocument();
  expect(removeAgent).not.toHaveBeenCalled();
  act(() => listeners.config?.());
  expect(screen.queryByText("Admitted cached update")).not.toBeInTheDocument();
  expect(removeAgent).toHaveBeenCalledOnce();
  await act(async () => {
    emitAgent(phase);
    finishUpdate({ success: true });
  });
  expect(screen.queryByText("Admitted cached update")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Hermes updated successfully."),
  ).not.toBeInTheDocument();
});
