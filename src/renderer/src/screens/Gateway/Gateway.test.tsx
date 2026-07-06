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
});
