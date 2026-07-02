import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/openSettings", () => ({ openSettings: vi.fn() }));

import { StatusChip } from "./StatusChip";
import type { GatewayHealthChange } from "../../../../../shared/gateway";

describe("StatusChip", () => {
  let gatewayHealthCallback: ((change: GatewayHealthChange) => void) | null;

  beforeEach(() => {
    gatewayHealthCallback = null;
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getConnectionConfig: vi.fn().mockResolvedValue({
          mode: "local",
          hasApiKey: true,
        }),
        gatewayHealthStatus: vi.fn().mockResolvedValue("recovering"),
        onGatewayHealthChanged: vi.fn((callback) => {
          gatewayHealthCallback = callback;
          return vi.fn();
        }),
        listProfiles: vi
          .fn()
          .mockResolvedValue([{ name: "work", isActive: true }]),
        runHermesAgentUpdateCheck: vi.fn().mockResolvedValue({
          status: "available",
          message: "Hermes Agent update available.",
        }),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("offers a one-click engine update check from the SPS shell", async () => {
    render(<StatusChip />);

    const updateButton = await screen.findByRole("button", {
      name: "Update Hermes Agent engine now",
    });
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(window.hermesAPI.runHermesAgentUpdateCheck).toHaveBeenCalledWith(
        "work",
        { autoApply: true },
      );
    });
  });

  it("reflects supervisor health push states", async () => {
    render(<StatusChip />);

    expect(
      await screen.findByRole("button", { name: /Gateway recovering/ }),
    ).toBeInTheDocument();

    gatewayHealthCallback?.({ status: "unhealthy" });
    expect(
      await screen.findByRole("button", { name: /Gateway unhealthy/ }),
    ).toBeInTheDocument();

    gatewayHealthCallback?.({ status: "down" });
    expect(
      await screen.findByRole("button", { name: /Gateway down/ }),
    ).toBeInTheDocument();
  });

  it("renders remote status when profile listing is unsupported", async () => {
    vi.mocked(window.hermesAPI.getConnectionConfig).mockResolvedValue({
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
    });
    vi.mocked(window.hermesAPI.gatewayHealthStatus).mockResolvedValue(
      "healthy",
    );
    vi.mocked(window.hermesAPI.listProfiles).mockRejectedValue(
      new Error("remote unsupported"),
    );

    render(<StatusChip />);

    expect(
      await screen.findByRole("button", {
        name: /Connection Remote, profile default\. Gateway healthy\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Remote · default")).toBeInTheDocument();
  });
});
