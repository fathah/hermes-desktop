// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import ConnectedApps from "../src/renderer/src/screens/Settings/ConnectedApps";

// i18n: echo the key (and interpolation values) so assertions stay
// locale-independent while still exposing the synced counts.
vi.mock("../src/renderer/src/components/useI18n", () => ({
  useI18n: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(",")}` : k,
  }),
}));

type MacStatus = { available: boolean; authorized: boolean };
type MacSync = {
  available: boolean;
  authorized: boolean;
  added: number;
  updated: number;
  error?: string;
};

function mockApi(status: MacStatus, sync: MacSync): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    macContactsStatus: vi.fn().mockResolvedValue(status),
    macContactsSync: vi.fn().mockResolvedValue(sync),
  };
}

function mockApiRejected(status: MacStatus, error: Error): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    macContactsStatus: vi.fn().mockResolvedValue(status),
    macContactsSync: vi.fn().mockRejectedValue(error),
  };
}

function setPlatform(platform: string): void {
  (window as unknown as { electron?: unknown }).electron = {
    process: { platform },
  };
}

afterEach(cleanup);
beforeEach(() => setPlatform("darwin"));

describe("<ConnectedApps>", () => {
  it("on macOS, renders the Connected Apps section and a sync button", () => {
    mockApi(
      { available: true, authorized: true },
      { available: true, authorized: true, added: 0, updated: 0 },
    );
    render(<ConnectedApps profile="default" />);
    expect(screen.getByText("settings.connectedAppsSection")).toBeTruthy();
    expect(screen.getByText("settings.macContactsSync")).toBeTruthy();
  });

  it("clicking sync calls macContactsSync(profile) and shows the counts", async () => {
    mockApi(
      { available: true, authorized: true },
      { available: true, authorized: true, added: 2, updated: 1 },
    );
    render(<ConnectedApps profile="work" />);
    const api = (
      window as unknown as {
        hermesAPI: { macContactsSync: ReturnType<typeof vi.fn> };
      }
    ).hermesAPI;

    fireEvent.click(screen.getByText("settings.macContactsSync"));

    await waitFor(() =>
      expect(screen.getByText(/settings.macContactsSynced 2,1/)).toBeTruthy(),
    );
    expect(api.macContactsSync).toHaveBeenCalledTimes(1);
    expect(api.macContactsSync).toHaveBeenCalledWith("work");
  });

  it("renders the human-readable error when sync fails", async () => {
    mockApi(
      { available: true, authorized: false },
      {
        available: true,
        authorized: false,
        added: 0,
        updated: 0,
        error: "Contacts access not granted",
      },
    );
    render(<ConnectedApps profile="default" />);

    fireEvent.click(screen.getByText("settings.macContactsSync"));

    await waitFor(() =>
      expect(screen.getByText("Contacts access not granted")).toBeTruthy(),
    );
  });

  it("renders a rejected sync error and re-enables the button", async () => {
    mockApiRejected(
      { available: true, authorized: true },
      new Error("Native module crashed"),
    );
    render(<ConnectedApps profile="default" />);

    fireEvent.click(screen.getByText("settings.macContactsSync"));

    await waitFor(() =>
      expect(screen.getByText("Native module crashed")).toBeTruthy(),
    );
    expect(screen.getByText("settings.macContactsSync")).not.toBeDisabled();
  });

  it("reports 'already up to date' when nothing changed", async () => {
    mockApi(
      { available: true, authorized: true },
      { available: true, authorized: true, added: 0, updated: 0 },
    );
    render(<ConnectedApps profile="default" />);

    fireEvent.click(screen.getByText("settings.macContactsSync"));

    await waitFor(() =>
      expect(screen.getByText("settings.macContactsUpToDate")).toBeTruthy(),
    );
  });

  it("shows the unavailable hint when the native module is absent", async () => {
    mockApi(
      { available: false, authorized: false },
      { available: false, authorized: false, added: 0, updated: 0 },
    );
    render(<ConnectedApps profile="default" />);

    await waitFor(() =>
      expect(screen.getByText("settings.macContactsUnavailable")).toBeTruthy(),
    );
  });

  it("renders nothing off macOS", () => {
    setPlatform("win32");
    mockApi(
      { available: false, authorized: false },
      { available: false, authorized: false, added: 0, updated: 0 },
    );
    const { container } = render(<ConnectedApps profile="default" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("settings.connectedAppsSection")).toBeNull();
  });
});
