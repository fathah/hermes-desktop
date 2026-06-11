import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("../../components/ThemeProvider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    rounded: true,
    setRounded: vi.fn(),
  }),
}));

vi.mock("../../components/FontProvider", () => ({
  useFont: () => ({
    font: "manrope",
    setFont: vi.fn(),
  }),
}));

vi.mock("../../utils/analytics", () => ({
  getAnalyticsConsent: () => false,
  setAnalyticsConsent: vi.fn(),
}));

vi.mock("./ConfigHealth", () => ({
  ConfigHealth: () => <div data-testid="config-health" />,
}));

import Settings from "./Settings";

function createHermesAPIMock(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getHermesHome: vi.fn().mockResolvedValue("/home/test/.hermes"),
    getAppVersion: vi.fn().mockResolvedValue("0.0.0-test"),
    getConnectionConfig: vi.fn().mockResolvedValue({
      mode: "local",
      remoteUrl: "",
      hasApiKey: false,
      apiKeyLength: 0,
      ssh: null,
    }),
    getApiServerKeyStatus: vi.fn().mockResolvedValue({ hasKey: true }),
    invalidateSecretsCache: vi.fn().mockResolvedValue(undefined),
    generateApiServerKey: vi
      .fn()
      .mockResolvedValue({ key: "synthetic-test-marker" }),
    getConfig: vi.fn().mockResolvedValue(""),
    setConfig: vi.fn().mockResolvedValue(undefined),
    getHermesVersion: vi.fn().mockResolvedValue("0.0.0-engine-test"),
    checkOpenClaw: vi.fn().mockResolvedValue({ found: false, path: null }),
    openExternal: vi.fn().mockResolvedValue(true),
  };
}

async function flushLoadConfig(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Settings API server key vault refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: createHermesAPIMock(),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("re-polls key status on the 10s interval and clears the missing-key banner", async () => {
    const keyStatusMock = vi.fn().mockResolvedValue({ hasKey: false });
    window.hermesAPI.getApiServerKeyStatus = keyStatusMock;

    render(<Settings />);
    await flushLoadConfig();

    expect(keyStatusMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("settings.sessionDisabledTitle")).toBeTruthy();

    keyStatusMock.mockResolvedValue({ hasKey: true });
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await flushLoadConfig();

    expect(keyStatusMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("settings.sessionDisabledTitle")).toBeNull();
  });

  it("clears the interval on unmount", async () => {
    const keyStatusMock = vi.fn().mockResolvedValue({ hasKey: false });
    window.hermesAPI.getApiServerKeyStatus = keyStatusMock;

    const { unmount } = render(<Settings />);
    await flushLoadConfig();
    expect(keyStatusMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await flushLoadConfig();

    expect(keyStatusMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates the secrets cache and re-fetches when Refresh from vault is clicked", async () => {
    const keyStatusMock = vi
      .fn()
      .mockResolvedValueOnce({ hasKey: false })
      .mockResolvedValue({ hasKey: true });
    window.hermesAPI.getApiServerKeyStatus = keyStatusMock;
    const invalidateMock = window.hermesAPI
      .invalidateSecretsCache as ReturnType<typeof vi.fn>;

    render(<Settings />);
    await flushLoadConfig();

    expect(screen.getByText("settings.sessionDisabledTitle")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("settings.refreshFromVault"));
    });
    await flushLoadConfig();

    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(keyStatusMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("settings.sessionDisabledTitle")).toBeNull();
  });
});
