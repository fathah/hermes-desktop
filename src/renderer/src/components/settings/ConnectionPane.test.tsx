import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionPane from "./ConnectionPane";

const settings = vi.hoisted(() => ({
  profile: undefined,
  connections: [
    {
      connectionId: "connection-local",
      name: "Local",
      mode: "local" as const,
    },
    {
      connectionId: "connection-remote",
      name: "Production",
      mode: "remote" as const,
    },
  ],
  connectionStatuses: [
    {
      connectionId: "connection-remote",
      health: "online" as const,
      latencyMs: 42,
      authentication: "authenticated" as const,
      capabilities: {
        version: "1.2.3",
        compatibility: "compatible" as const,
      },
    },
  ],
  connectionStatusesLoading: false,
  refreshConnectionStatuses: vi.fn(),
  connectionId: "connection-remote",
  connectionName: "Production",
  setConnectionName: vi.fn(),
  connMode: "remote" as const,
  setConnMode: vi.fn(),
  connStatus: null,
  setConnStatus: vi.fn(),
  connLoaded: { current: true },
  connRemoteUrl: "https://hermes.example",
  setConnRemoteUrl: vi.fn(),
  connApiKey: "",
  setConnApiKey: vi.fn(),
  connApiKeyMask: "",
  connTesting: false,
  apiServerKeyMissing: false,
  setApiServerKeyMissing: vi.fn(),
  generatingKey: false,
  setGeneratingKey: vi.fn(),
  remoteAuthMode: "oauth" as "auto" | "token" | "oauth",
  setRemoteAuthMode: vi.fn(),
  remoteOAuthSignedIn: false,
  remoteOAuthBusy: false,
  remoteChatTransport: "dashboard" as const,
  sshChatTransport: "auto" as const,
  transportProbe: null,
  sshHost: "",
  setSshHost: vi.fn(),
  sshPort: "",
  setSshPort: vi.fn(),
  sshUser: "",
  setSshUser: vi.fn(),
  sshKeyPath: "",
  setSshKeyPath: vi.fn(),
  sshRemotePort: "",
  setSshRemotePort: vi.fn(),
  handleSaveConnection: vi.fn(),
  handleCreateConnection: vi.fn(),
  handleRenameConnection: vi.fn(),
  handleSelectConnection: vi.fn(),
  handleRemoveConnection: vi.fn(),
  handleTestConnection: vi.fn(),
  handleChatTransportChange: vi.fn(),
  handleRemoteOAuthLogin: vi.fn(),
  handleRemoteOAuthLogout: vi.fn(),
  handleSwitchToLocal: vi.fn(),
  handleSwitchToRemote: vi.fn(),
  handleSwitchToSsh: vi.fn(),
  forceIpv4: false,
  setForceIpv4: vi.fn(),
  httpProxy: "",
  setHttpProxy: vi.fn(),
  httpProxyRef: { current: "" },
  saveHttpProxy: vi.fn(),
  networkSaved: false,
  setNetworkSaved: vi.fn(),
}));

vi.mock("./SettingsDataContext", () => ({ useSettings: () => settings }));
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("ConnectionPane remote OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.remoteAuthMode = "oauth";
    settings.remoteOAuthSignedIn = false;
  });

  it("replaces token input with browser sign-in for OAuth gateways", () => {
    render(<ConnectionPane />);

    expect(screen.queryByLabelText("settings.remoteApiKey")).toBeNull();
    expect(screen.queryByText("Legacy")).toBeNull();
    fireEvent.click(screen.getByText("settings.remoteOAuthSignIn"));
    expect(settings.handleRemoteOAuthLogin).toHaveBeenCalledTimes(1);
  });

  it("shows connected state and sign-out after OAuth login", () => {
    settings.remoteOAuthSignedIn = true;
    render(<ConnectionPane />);

    expect(screen.getByText("settings.remoteOAuthConnected")).toBeTruthy();
    fireEvent.click(screen.getByText("settings.remoteOAuthSignOut"));
    expect(settings.handleRemoteOAuthLogout).toHaveBeenCalledTimes(1);
  });

  it("keeps API key input for token gateways and invalidates detection on URL edit", () => {
    settings.remoteAuthMode = "token";
    render(<ConnectionPane />);

    expect(screen.getByLabelText("settings.remoteApiKey")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("settings.remoteUrl"), {
      target: { value: "https://new.example" },
    });
    expect(settings.setRemoteAuthMode).toHaveBeenCalledWith("auto");
  });

  it("manages named connections above the existing mode editor", () => {
    render(<ConnectionPane />);

    fireEvent.change(screen.getByLabelText("settings.savedConnections"), {
      target: { value: "connection-local" },
    });
    fireEvent.click(screen.getByText("settings.addConnection"));
    fireEvent.change(screen.getByLabelText("settings.connectionName"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByText("settings.renameConnection"));
    fireEvent.click(screen.getByText("settings.remove"));

    expect(settings.handleSelectConnection).toHaveBeenCalledWith(
      "connection-local",
    );
    expect(settings.handleCreateConnection).toHaveBeenCalledTimes(1);
    expect(settings.setConnectionName).toHaveBeenCalledWith("Renamed");
    expect(settings.handleRenameConnection).toHaveBeenCalledTimes(1);
    expect(settings.handleRemoveConnection).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("42 ms")).toBeTruthy();
    fireEvent.click(screen.getByText("Refresh status"));
    expect(settings.refreshConnectionStatuses).toHaveBeenCalledTimes(1);
  });
});
