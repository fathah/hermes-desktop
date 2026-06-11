import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramSetupWizard } from "./TelegramSetupWizard";

type ApiOverrides = Record<string, unknown>;

function installApi(overrides: ApiOverrides = {}): Record<string, unknown> {
  const api: Record<string, unknown> = {
    getPlatformEnabled: vi.fn().mockResolvedValue({ telegram: false }),
    telegramGetScope: vi.fn().mockResolvedValue("read-info"),
    telegramCheckStatus: vi
      .fn()
      .mockResolvedValue({ state: "active", botUsername: "my_bot" }),
    srTelegramAvailability: vi
      .fn()
      .mockResolvedValue({ available: false, targets: [] }),
    setEnv: vi.fn().mockResolvedValue(true),
    setPlatformEnabled: vi.fn().mockResolvedValue(true),
    telegramSetReadInfoScope: vi.fn().mockResolvedValue(true),
    approvePairing: vi.fn().mockResolvedValue({ success: true, output: "" }),
    revokePairing: vi.fn().mockResolvedValue({ success: true, output: "" }),
    ...overrides,
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("TelegramSetupWizard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the manage view with a live status pill when already connected", async () => {
    installApi({
      getPlatformEnabled: vi.fn().mockResolvedValue({ telegram: true }),
    });
    await act(async () => {
      render(<TelegramSetupWizard onClose={() => {}} />);
    });
    expect(
      await screen.findByText(/Online — @my_bot is connected/),
    ).toBeTruthy();
  });

  it("shows gateway-stopped status honestly (token OK, bot offline)", async () => {
    installApi({
      getPlatformEnabled: vi.fn().mockResolvedValue({ telegram: true }),
      telegramCheckStatus: vi
        .fn()
        .mockResolvedValue({ state: "gateway-stopped", botUsername: "my_bot" }),
    });
    await act(async () => {
      render(<TelegramSetupWizard onClose={() => {}} />);
    });
    expect(
      await screen.findByText(/gateway stopped, bot offline/),
    ).toBeTruthy();
  });

  it("lists connected accounts and revokes by id", async () => {
    const api = installApi({
      getPlatformEnabled: vi.fn().mockResolvedValue({ telegram: true }),
      srTelegramAvailability: vi.fn().mockResolvedValue({
        available: true,
        targets: [{ id: "123", name: "Amar" }],
      }),
    });
    await act(async () => {
      render(<TelegramSetupWizard onClose={() => {}} />);
    });
    expect(await screen.findByText(/Amar/)).toBeTruthy();
    expect(screen.getByText(/\(123\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Remove access"));
    });
    await waitFor(() => {
      expect(api.revokePairing).toHaveBeenCalledWith("123", undefined);
    });
  });

  it("writes TELEGRAM_ALLOWED_USERS when the optional field is filled", async () => {
    const api = installApi();
    await act(async () => {
      render(<TelegramSetupWizard onClose={() => {}} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Get started"));
    });
    fireEvent.change(screen.getByPlaceholderText("123456789:ABCdef…"), {
      target: { value: "999:TOKEN" },
    });
    fireEvent.change(screen.getByPlaceholderText("123456789, @you"), {
      target: { value: "@amar, 555" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save & continue"));
    });
    await waitFor(() => {
      expect(api.setEnv).toHaveBeenCalledWith(
        "TELEGRAM_BOT_TOKEN",
        "999:TOKEN",
        undefined,
      );
    });
    expect(api.setEnv).toHaveBeenCalledWith(
      "TELEGRAM_ALLOWED_USERS",
      "@amar, 555",
      undefined,
    );
  });

  it("does NOT write TELEGRAM_ALLOWED_USERS when the field is left blank", async () => {
    const api = installApi();
    await act(async () => {
      render(<TelegramSetupWizard onClose={() => {}} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Get started"));
    });
    fireEvent.change(screen.getByPlaceholderText("123456789:ABCdef…"), {
      target: { value: "999:TOKEN" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save & continue"));
    });
    await waitFor(() => {
      expect(api.setEnv).toHaveBeenCalledWith(
        "TELEGRAM_BOT_TOKEN",
        "999:TOKEN",
        undefined,
      );
    });
    const allowedCall = (
      api.setEnv as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) => c[0] === "TELEGRAM_ALLOWED_USERS");
    expect(allowedCall).toBeUndefined();
  });
});
