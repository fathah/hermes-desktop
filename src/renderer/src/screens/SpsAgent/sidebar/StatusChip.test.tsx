import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/openSettings", () => ({ openSettings: vi.fn() }));

import { StatusChip } from "./StatusChip";

describe("StatusChip", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getConnectionConfig: vi.fn().mockResolvedValue({
          mode: "local",
          hasApiKey: true,
        }),
        gatewayStatus: vi.fn().mockResolvedValue(true),
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
});
