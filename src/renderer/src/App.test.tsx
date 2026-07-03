import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./components/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./components/useFocusTrap", () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock("./utils/analytics", () => ({
  captureScreenView: vi.fn(),
}));

vi.mock("./screens/Welcome/Welcome", () => ({
  default: ({
    error,
    onRecheck,
  }: {
    error: string | null;
    onRecheck: () => void;
  }) => (
    <div data-testid="welcome">
      {error && <p>{error}</p>}
      <button onClick={onRecheck}>Recheck</button>
    </div>
  ),
}));

vi.mock("./screens/Install/Install", () => ({
  default: () => <div data-testid="installing" />,
}));

vi.mock("./screens/Setup/Setup", () => ({
  default: () => <div data-testid="setup" />,
}));

vi.mock("./screens/Onboarding/Onboarding", () => ({
  default: () => <div data-testid="onboarding" />,
}));

vi.mock("./screens/SpsAgent/SpsAgent", () => ({
  default: () => <div data-testid="sps-agent" />,
}));

vi.mock("./screens/Layout/Layout", () => ({
  default: () => <div data-testid="layout" />,
}));

type HermesApiStub = Pick<
  Window["hermesAPI"],
  | "checkInstall"
  | "copyToClipboard"
  | "getConnectionConfig"
  | "getOnboardingCompleted"
  | "onMenuNewChat"
  | "onMenuSearchSessions"
  | "setConnectionConfig"
  | "startSshTunnel"
  | "testRemoteConnection"
  | "verifyInstall"
>;

type ConnectionConfigResult = Awaited<
  ReturnType<HermesApiStub["getConnectionConfig"]>
>;
type SshTunnelResult = Awaited<ReturnType<HermesApiStub["startSshTunnel"]>>;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function installApi(overrides: Partial<HermesApiStub> = {}): HermesApiStub {
  const api: HermesApiStub = {
    checkInstall: vi.fn().mockResolvedValue({
      installed: false,
      configured: false,
      hasApiKey: false,
    }),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    getConnectionConfig: vi.fn().mockResolvedValue({
      mode: "local",
      remoteUrl: "",
      hasApiKey: false,
      apiKeyLength: 0,
      ssh: {
        host: "",
        port: 22,
        username: "",
        keyPath: "",
        remotePort: 8642,
        localPort: 18642,
      },
    }),
    getOnboardingCompleted: vi.fn().mockResolvedValue(true),
    onMenuNewChat: vi.fn(() => () => {}),
    onMenuSearchSessions: vi.fn(() => () => {}),
    setConnectionConfig: vi.fn().mockResolvedValue(true),
    startSshTunnel: vi.fn().mockResolvedValue(true),
    testRemoteConnection: vi.fn().mockResolvedValue(true),
    verifyInstall: vi.fn().mockResolvedValue(true),
    ...overrides,
  };

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });

  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform: "linux" } },
  });

  return api;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

async function flushStartup(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("App startup timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a diagnostic fallback when the connection config check never resolves", async () => {
    installApi({
      getConnectionConfig: vi.fn(() => never<ConnectionConfigResult>()),
    });

    render(<App />);

    expect(screen.getByText(/Checking installation/)).toBeInTheDocument();

    await advance(8000);

    expect(
      screen.getByText("Startup check is taking too long"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/connection settings/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("button", { name: /retry check/i })).toBeEnabled();
  });

  it("ignores a stale startup result after the timeout fallback appears", async () => {
    const config = deferred<ConnectionConfigResult>();
    installApi({
      getConnectionConfig: vi.fn(() => config.promise),
      checkInstall: vi.fn().mockResolvedValue({
        installed: true,
        configured: true,
        hasApiKey: true,
      }),
    });

    render(<App />);
    await advance(8000);

    expect(
      screen.getByText("Startup check is taking too long"),
    ).toBeInTheDocument();

    await act(async () => {
      config.resolve({
        mode: "local",
        remoteUrl: "",
        hasApiKey: false,
        apiKeyLength: 0,
        ssh: {
          host: "",
          port: 22,
          username: "",
          keyPath: "",
          remotePort: 8642,
          localPort: 18642,
        },
      });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("sps-agent")).toBeNull();
    expect(
      screen.getByText("Startup check is taking too long"),
    ).toBeInTheDocument();
  });

  it("keeps the normal local setup route when startup checks resolve", async () => {
    installApi({
      checkInstall: vi.fn().mockResolvedValue({
        installed: true,
        configured: true,
        hasApiKey: false,
      }),
    });

    render(<App />);

    await flushStartup();

    expect(screen.getByTestId("setup")).toBeInTheDocument();
    expect(screen.queryByText("Startup check is taking too long")).toBeNull();
  });

  it("routes a setup-ready local install straight to the workspace", async () => {
    installApi({
      checkInstall: vi.fn().mockResolvedValue({
        installed: true,
        configured: true,
        hasApiKey: true,
      }),
    });

    render(<App />);

    await flushStartup();

    expect(screen.getByTestId("sps-agent")).toBeInTheDocument();
    expect(screen.queryByTestId("setup")).toBeNull();
  });

  it("keeps SSH startup on the loading screen during the short IPC budget", async () => {
    installApi({
      getConnectionConfig: vi.fn().mockResolvedValue({
        mode: "ssh",
        remoteUrl: "",
        hasApiKey: true,
        apiKeyLength: 8,
        ssh: {
          host: "example.test",
          port: 22,
          username: "hermes",
          keyPath: "",
          remotePort: 8642,
          localPort: 18642,
        },
      }),
      startSshTunnel: vi.fn(() => never<SshTunnelResult>()),
    });

    render(<App />);
    await flushStartup();

    await advance(8000);

    expect(screen.getByText(/Checking installation/)).toBeInTheDocument();
    expect(screen.queryByText("Startup check is taking too long")).toBeNull();

    await advance(27000);

    expect(
      screen.getByText("Startup check is taking too long"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/SSH tunnel/i).length).toBeGreaterThan(0);
  });

  it("routes remote health failures to the existing welcome recovery path", async () => {
    installApi({
      getConnectionConfig: vi.fn().mockResolvedValue({
        mode: "remote",
        remoteUrl: "http://127.0.0.1:8642",
        hasApiKey: false,
        apiKeyLength: 0,
        ssh: {
          host: "",
          port: 22,
          username: "",
          keyPath: "",
          remotePort: 8642,
          localPort: 18642,
        },
      }),
      testRemoteConnection: vi.fn().mockResolvedValue(false),
    });

    render(<App />);

    await flushStartup();

    expect(screen.getByTestId("welcome")).toBeInTheDocument();
    expect(
      screen.getByText(/Cannot reach remote Hermes at http:\/\/127.0.0.1:8642/),
    ).toBeInTheDocument();
  });

  it("copies a bounded startup diagnostic summary", async () => {
    const api = installApi({
      getConnectionConfig: vi.fn(() => never<ConnectionConfigResult>()),
    });

    render(<App />);
    await advance(8000);

    fireEvent.click(screen.getByRole("button", { name: /copy diagnostics/i }));

    expect(api.copyToClipboard).toHaveBeenCalledWith(
      expect.stringContaining("Startup phase: connection settings"),
    );
  });
});
