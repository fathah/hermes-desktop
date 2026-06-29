import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import Gateway from "./Gateway";

vi.mock("../../hooks/useGatewayHealth", () => ({
  useGatewayHealth: () => "healthy",
}));

vi.mock("./components/PlatformCard", () => ({
  default: () => null,
}));

vi.mock("./components/WhatsAppCloudSetup", () => ({
  default: () => null,
}));

function renderGateway(): void {
  render(
    <I18nProvider>
      <Gateway profile="work" />
    </I18nProvider>,
  );
}

describe("Gateway", () => {
  beforeEach(() => {
    const hermesAPI = {
      getLocale: vi.fn().mockResolvedValue("en"),
      getEnv: vi.fn().mockResolvedValue({}),
      getKeychainKeys: vi.fn().mockResolvedValue([]),
      gatewayStatus: vi.fn().mockResolvedValue(false),
      getPlatformEnabled: vi.fn().mockResolvedValue({}),
      listPairings: vi.fn().mockResolvedValue(""),
      readLogs: vi.fn().mockResolvedValue({ content: "" }),
      startGateway: vi.fn().mockResolvedValue({
        success: false,
        running: false,
        error: "Missing Hermes Python",
        logPath: "/tmp/hermes/gateway-stderr.log",
      }),
      stopGateway: vi.fn().mockResolvedValue(true),
      setPlatformEnabled: vi.fn().mockResolvedValue(true),
      setEnv: vi.fn().mockResolvedValue(true),
      approvePairing: vi.fn().mockResolvedValue({ success: true }),
      revokePairing: vi.fn().mockResolvedValue({ success: true }),
      clearPendingPairings: vi.fn().mockResolvedValue({ success: true }),
      macContactsStatus: vi.fn().mockResolvedValue({
        available: true,
        authorized: true,
      }),
      macContactsSync: vi.fn().mockResolvedValue({
        available: true,
        authorized: true,
        added: 1,
        updated: 0,
      }),
    };

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: hermesAPI as unknown as Window["hermesAPI"],
    });
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: { process: { platform: "darwin" } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows gateway start failures with stderr log guidance", async () => {
    renderGateway();

    const start = await screen.findByRole("button", { name: "Start" });
    fireEvent.click(start);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Missing Hermes Python");
    expect(alert).toHaveTextContent("/tmp/hermes/gateway-stderr.log");
    await waitFor(() => {
      expect(window.hermesAPI.startGateway).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces macOS Contacts sync from the real Connected Apps page", async () => {
    renderGateway();

    const sync = await screen.findByRole("button", {
      name: /Sync Mac Contacts/,
    });
    fireEvent.click(sync);

    await waitFor(() => {
      expect(window.hermesAPI.macContactsSync).toHaveBeenCalledWith("work");
    });
    expect(
      await screen.findByText("Synced — 1 added, 0 updated."),
    ).toBeVisible();
  });
});
