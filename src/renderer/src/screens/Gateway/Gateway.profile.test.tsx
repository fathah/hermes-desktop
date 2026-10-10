import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stable `t`, like the real hook: a fresh function per render would recreate
// `loadConfig` and re-run its effect forever once a request fails.
const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));
vi.mock("../../components/common/BrandLogo", () => ({
  default: () => <div data-testid="brand-logo" />,
}));

import Gateway from "./Gateway";

function installApi(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getEnv: vi.fn().mockResolvedValue({}),
      getApiServerKeyStatus: vi.fn().mockResolvedValue({ hasKey: true }),
      gatewayStatus: vi.fn().mockResolvedValue(true),
      getPlatformEnabled: vi.fn().mockResolvedValue({}),
      restartGateway: vi.fn().mockResolvedValue(true),
      startGateway: vi
        .fn()
        .mockResolvedValue({ success: true, running: false }),
      stopGateway: vi.fn().mockResolvedValue(true),
      getMessagingPlatforms: vi
        .fn()
        .mockResolvedValue({ platforms: [], message: null }),
      openExternal: vi.fn(),
      ...overrides,
    },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Gateway screen with a selected profile / failing platform list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps the gateway status and controls when the platform list fails to load", async () => {
    installApi({
      getMessagingPlatforms: vi
        .fn()
        .mockRejectedValue(new Error("Unauthorized")),
    });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    expect(screen.getByText("gateway.running")).toBeTruthy();
    expect(screen.getByText("gateway.restart")).toBeTruthy();
    expect(screen.getByText("Unauthorized")).toBeTruthy();
    expect(window.hermesAPI.gatewayStatus).toHaveBeenCalledWith("work");
  });

  it("passes the selected profile to status, start and stop", async () => {
    installApi({ gatewayStatus: vi.fn().mockResolvedValue(false) });
    render(<Gateway profile="work" />);
    await settle();
    fireEvent.click(screen.getByText("common.start"));
    await settle();
    expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("work");
    expect(window.hermesAPI.gatewayStatus).toHaveBeenCalledWith("work");
  });

  it("passes the selected profile to stop", async () => {
    installApi();
    render(<Gateway profile="work" />);
    await settle();
    fireEvent.click(screen.getByText("common.stop"));
    await settle();
    expect(window.hermesAPI.stopGateway).toHaveBeenCalledWith("work");
  });

  it("drops the pending 5 s status check when the screen goes away (profile switch remounts it)", async () => {
    installApi({ gatewayStatus: vi.fn().mockResolvedValue(false) });
    const { unmount } = render(<Gateway profile="work" />);
    await settle();
    fireEvent.click(screen.getByText("common.start"));
    await settle();
    const callsBefore = (
      window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    // Nothing queried the old profile's status after the unmount.
    expect(
      (window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>).mock.calls
        .length,
    ).toBe(callsBefore);
  });
});
