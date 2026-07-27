import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsData } from "./useSettingsData";

vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

type PublicConnectionConfig = Awaited<
  ReturnType<typeof window.hermesAPI.getConnectionConfig>
>;

function connectionConfig(): PublicConnectionConfig {
  return {
    mode: "remote" as const,
    remoteUrl: "https://hermes.example",
    remoteAuthMode: "auto" as const,
    remoteChatTransport: "dashboard" as const,
    sshChatTransport: "auto" as const,
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
  };
}

describe("useSettingsData remote OAuth", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    localStorage.setItem("hermes-openclaw-dismissed", "true");
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getAppVersion: vi.fn(async () => "1.0.0"),
        getConnectionConfig: vi.fn(async () => connectionConfig()),
        getApiServerKeyStatus: vi.fn(async () => ({ hasKey: true })),
        getAutoUpgradeEnabled: vi.fn(async () => true),
        getHermesHome: vi.fn(async () => "/tmp/hermes"),
        getHermesVersion: vi.fn(async () => "Hermes Agent v1.0.0"),
        getConfig: vi.fn(async () => ""),
        onConnectionConfigChanged: vi.fn(() => vi.fn()),
        onUpdateAvailable: vi.fn(() => vi.fn()),
        onUpdateDownloadProgress: vi.fn(() => vi.fn()),
        onUpdateDownloaded: vi.fn(() => vi.fn()),
        onUpdateError: vi.fn(() => vi.fn()),
        probeRemoteAuthMode: vi.fn(async () => ({
          authMode: "oauth" as const,
          version: "1.0.0",
        })),
        remoteOAuthSessionState: vi.fn(async () => ({ signedIn: false })),
        dashboardStatus: vi.fn(async () => ({
          supported: true,
          running: false,
          needsOAuthLogin: true,
          error: "Sign in required",
        })),
        setConnectionConfig: vi.fn(async () => true),
        setConnectionChatTransports: vi.fn(async () => true),
        remoteOAuthLogin: vi.fn(async () => ({ signedIn: true as const })),
        remoteOAuthLogout: vi.fn(async () => ({ signedIn: false as const })),
      },
    });
  });

  it("automatically detects OAuth and reads bounded session state", async () => {
    // @lat: [[remote-dashboard-oauth#Test specifications#Settings authentication state]]
    const { result } = renderHook(() => useSettingsData());

    await waitFor(() => expect(result.current.remoteAuthMode).toBe("oauth"));
    expect(window.hermesAPI.probeRemoteAuthMode).toHaveBeenCalledWith(
      "https://hermes.example",
    );
    expect(window.hermesAPI.remoteOAuthSessionState).toHaveBeenCalledTimes(1);
    expect(result.current.remoteOAuthSignedIn).toBe(false);
  });

  it("opens browser login and updates signed-in state", async () => {
    const { result } = renderHook(() => useSettingsData());
    await waitFor(() => expect(result.current.remoteAuthMode).toBe("oauth"));

    await act(async () => result.current.handleRemoteOAuthLogin());

    expect(window.hermesAPI.setConnectionConfig).toHaveBeenCalledWith(
      "remote",
      "https://hermes.example",
      "",
    );
    expect(window.hermesAPI.remoteOAuthLogin).toHaveBeenCalledTimes(1);
    expect(result.current.remoteOAuthSignedIn).toBe(true);
    expect(result.current.connStatus).toBe("settings.remoteOAuthLoginSuccess");
  });

  it("reports browser cancellation without marking session signed in", async () => {
    vi.mocked(window.hermesAPI.remoteOAuthLogin).mockRejectedValueOnce(
      new Error("Remote gateway sign-in was cancelled."),
    );
    const { result } = renderHook(() => useSettingsData());
    await waitFor(() => expect(result.current.remoteAuthMode).toBe("oauth"));

    await act(async () => result.current.handleRemoteOAuthLogin());

    expect(result.current.remoteOAuthSignedIn).toBe(false);
    expect(result.current.connStatus).toBe("settings.remoteOAuthCancelled");
  });
});
