import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../../components/common/BrandLogo", () => ({
  default: () => <div data-testid="brand-logo" />,
}));

import Gateway from "./Gateway";

function createHermesAPIMock(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getEnv: vi.fn().mockResolvedValue({}),
    gatewayStatus: vi.fn().mockResolvedValue(true),
    getApiServerKeyStatus: vi.fn().mockResolvedValue({ hasKey: true }),
    invalidateSecretsCache: vi.fn().mockResolvedValue(undefined),
    getPlatformEnabled: vi.fn().mockResolvedValue({}),
    restartGateway: vi.fn().mockResolvedValue(false),
    startGateway: vi.fn().mockResolvedValue(false),
    stopGateway: vi.fn().mockResolvedValue(true),
    setPlatformEnabled: vi.fn().mockResolvedValue(true),
    setEnv: vi.fn().mockResolvedValue(true),
    getMessagingPlatforms: vi.fn().mockResolvedValue({
      platforms: [],
      message: null,
    }),
    updateMessagingPlatform: vi.fn().mockResolvedValue({
      ok: true,
      message: null,
    }),
    testMessagingPlatform: vi.fn().mockResolvedValue({
      ok: true,
      message: null,
    }),
    openExternal: vi.fn().mockResolvedValue(true),
  };
}

describe("Gateway screen recovery controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: createHermesAPIMock(),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps a failed restart error visible while showing the refreshed running status", async () => {
    render(<Gateway />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("gateway.running")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("gateway.restart"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("gateway.restartFailed")).toBeTruthy();
    expect(screen.getByText("gateway.running")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    expect(screen.getByText("gateway.restartFailed")).toBeTruthy();
    expect(screen.getByText("gateway.running")).toBeTruthy();
  });

  it("shows a gateway error when restart IPC rejects", async () => {
    window.hermesAPI.restartGateway = vi
      .fn()
      .mockRejectedValue(new Error("restart failed"));
    window.hermesAPI.gatewayStatus = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    render(<Gateway />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("gateway.restart"));
      await Promise.resolve();
    });

    expect(screen.getByText("gateway.restartFailed")).toBeTruthy();
    expect(screen.getByText("gateway.stopped")).toBeTruthy();
  });
});

describe("Gateway API server key vault refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: createHermesAPIMock(),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("picks up a vault key rotation via the 10s poll", async () => {
    const keyStatusMock = vi.fn().mockResolvedValue({ hasKey: false });
    window.hermesAPI.getApiServerKeyStatus = keyStatusMock;

    render(<Gateway />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("gateway.apiServerKey.missing")).toBeTruthy();

    keyStatusMock.mockResolvedValue({ hasKey: true });
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("gateway.apiServerKey.configured")).toBeTruthy();
    expect(screen.queryByText("gateway.apiServerKey.missing")).toBeNull();
  });

  it("invalidates the secrets cache and reloads config from the Refresh from vault button", async () => {
    let resolveInvalidate: () => void = () => {};
    const invalidateMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveInvalidate = resolve;
        }),
    );
    window.hermesAPI.invalidateSecretsCache = invalidateMock;

    render(<Gateway />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusCallsBeforeRefresh = (
      window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByText("gateway.refreshFromVault"));
    });
    expect(invalidateMock).toHaveBeenCalledTimes(1);
    const refreshingButton = screen.getByText(
      "gateway.refreshingFromVault",
    ) as HTMLButtonElement;
    expect(refreshingButton.disabled).toBe(true);

    await act(async () => {
      resolveInvalidate();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("gateway.refreshFromVault")).toBeTruthy();
    // The refresh triggered a config reload. Exact counts are unstable here
    // because the test's per-render `t` mock re-fires the load effects.
    expect(
      (window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>).mock.calls
        .length,
    ).toBeGreaterThan(statusCallsBeforeRefresh);
  });
});
