import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteGatewayCommandStatus } from "../../../../shared/gateway";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../../components/common/BrandLogo", () => ({
  default: () => <div data-testid="brand-logo" />,
}));

import Gateway from "./Gateway";

describe("Gateway screen recovery controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getEnv: vi.fn().mockResolvedValue({}),
        getApiServerKeyStatus: vi.fn().mockResolvedValue({
          exists: true,
          valid: true,
          message: null,
        }),
        gatewayStatus: vi.fn().mockResolvedValue(true),
        gatewayCommandPending: vi.fn().mockResolvedValue(false),
        gatewayCommandStatus: vi.fn().mockResolvedValue({
          pending: false,
        } satisfies RemoteGatewayCommandStatus),
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
        onConnectionConfigChanged: vi.fn().mockReturnValue(() => {}),
      },
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

  // @lat: [[main-process#Main Process#Remote Gateway management#Healthy Remote Gateway load]]
  it("loads the healthy Remote screen without local key controls or a load error", async () => {
    const { container } = render(<Gateway remoteMode />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.hermesAPI.gatewayCommandStatus).toHaveBeenCalled();
    expect(screen.getByText("gateway.running")).toBeTruthy();
    expect(
      (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(container.querySelector(".gateway-inline-warning")).toBeNull();
    expect(window.hermesAPI.getApiServerKeyStatus).not.toHaveBeenCalled();
    expect(screen.queryByText("gateway.apiServerKey.title")).toBeNull();
  });

  it("still reads and shows the API server key in local mode", async () => {
    render(<Gateway />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.hermesAPI.getApiServerKeyStatus).toHaveBeenCalled();
    expect(screen.getByText("gateway.apiServerKey.title")).toBeTruthy();
  });
});
