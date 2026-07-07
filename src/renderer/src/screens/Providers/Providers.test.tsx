import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import Providers from "./Providers";

vi.mock("../../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: () => ({
    status: "idle",
    models: [],
    freeModels: [],
  }),
}));

function renderProviders(): void {
  render(
    <I18nProvider>
      <Providers profile="work" visible={true} />
    </I18nProvider>,
  );
}

let verifyEngineContract: ReturnType<typeof vi.fn>;

describe("Providers", () => {
  beforeEach(() => {
    verifyEngineContract = vi.fn().mockResolvedValue({
      checkedAt: "2026-06-19T10:30:00.000Z",
      status: "broken",
      findings: [
        {
          entryId: "http-chat-completions",
          kind: "http",
          value: "/v1/chat/completions",
          tier: "fail",
          verdict: "broken",
          detail: "Missing endpoint",
        },
      ],
    });

    const hermesAPI = {
      getLocale: vi.fn().mockResolvedValue("en"),
      setLocale: vi.fn().mockResolvedValue("en"),
      getEnv: vi.fn().mockResolvedValue({ XAI_API_KEY: "xai-test-key" }),
      getModelConfig: vi.fn().mockResolvedValue({
        provider: "xai",
        model: "grok-4",
        baseUrl: "",
      }),
      getCredentialPool: vi.fn().mockResolvedValue({}),
      getOAuthProviderStatus: vi.fn().mockImplementation((provider: string) =>
        Promise.resolve({
          provider,
          signedIn: provider === "xai-oauth",
          source: provider === "xai-oauth" ? "providers" : null,
        }),
      ),
      getHermesAgentUpdateRoutine: vi.fn().mockResolvedValue({
        enabled: true,
        autoApply: false,
        engineUpdateChannel: "release",
        schedule: "0 4 * * *",
        timezone: "America/New_York",
        lastCheckedAt: "2026-06-19T08:00:00.000Z",
        nextCheckAt: "2026-06-20T08:00:00.000Z",
        lastResult: {
          checkedAt: "2026-06-19T08:00:00.000Z",
          status: "available",
          message: "Hermes Agent update available.",
          behindBy: 2,
          changelog: "abc123 Update Hermes Agent",
        },
        autoApplySuppressed: false,
        autoApplySuppressionReason: null,
        autoApplySuppressedAt: null,
        autoApplySuppressedSha: null,
      }),
      getHermesUpstreamWatchState: vi.fn().mockResolvedValue({
        lastRunAt: "2026-06-19T09:00:00.000Z",
        lastSeenCommit: "a0471e2",
        lastSeenRelease: "v2026.6.19",
        anchorSha: "abc123def456",
        pendingCommitCount: 2,
        contractRiskCount: 1,
        latestReportPath:
          "/tmp/hermes/profiles/work/upstream-watch/2026-06-19.md",
        classifiedCounts: {
          "contract-risk": 1,
          "desktop-parity": 2,
          "cron-automation": 1,
        },
      }),
      getEngineCapabilities: vi.fn().mockResolvedValue({
        installedSha: "abc123def456",
        lastVerifiedSha: null,
        lastVerification: {
          checkedAt: "2026-06-19T10:00:00.000Z",
          status: "passed",
          findings: [],
        },
        snapshot: {
          status: "ready",
          fetchedAt: "2026-06-19T09:30:00.000Z",
          mode: "local",
          engineSha: "abc123def456",
          features: {
            chat_completions: true,
            audio_api: false,
            session_continuity_header: "X-Hermes-Session-Id",
          },
          endpoints: {
            chat_completions: {
              method: "POST",
              path: "/v1/chat/completions",
            },
          },
        },
      }),
      refreshEngineCapabilities: vi.fn().mockResolvedValue({
        installedSha: "abc123def456",
        lastVerifiedSha: null,
        lastVerification: {
          checkedAt: "2026-06-19T10:00:00.000Z",
          status: "passed",
          findings: [],
        },
        snapshot: {
          status: "ready",
          fetchedAt: "2026-06-19T09:31:00.000Z",
          mode: "local",
          engineSha: "abc123def456",
          features: {
            chat_completions: true,
            audio_api: false,
          },
          endpoints: {
            chat_completions: {
              method: "POST",
              path: "/v1/chat/completions",
            },
          },
        },
      }),
      verifyEngineContract,
      setModelConfig: vi.fn().mockResolvedValue(true),
      addModel: vi.fn().mockResolvedValue({}),
      setEnv: vi.fn().mockResolvedValue(true),
      addCredentialPoolEntry: vi.fn().mockResolvedValue([]),
      setCredentialPool: vi.fn().mockResolvedValue(true),
      discoverProviderModels: vi.fn().mockResolvedValue({
        status: "ok",
        models: ["grok-4"],
        cached: false,
      }),
      removeOAuthProviderCredentials: vi
        .fn()
        .mockResolvedValue({ provider: "xai-oauth", removed: true }),
      setHermesAgentUpdateRoutine: vi.fn().mockResolvedValue({
        enabled: true,
        autoApply: false,
        engineUpdateChannel: "release",
        schedule: "0 4 * * *",
        timezone: "America/New_York",
        lastCheckedAt: null,
        nextCheckAt: "2026-06-20T08:00:00.000Z",
        lastResult: null,
        autoApplySuppressed: false,
        autoApplySuppressionReason: null,
        autoApplySuppressedAt: null,
        autoApplySuppressedSha: null,
      }),
      runHermesAgentUpdateCheck: vi.fn().mockResolvedValue({
        checkedAt: "2026-06-20T08:00:00.000Z",
        status: "available",
        message: "Hermes Agent update available.",
      }),
      acknowledgeHermesAgentUpdateContractBreak: vi.fn().mockResolvedValue({
        enabled: true,
        autoApply: true,
        engineUpdateChannel: "release",
        schedule: "0 4 * * *",
        timezone: "America/New_York",
        lastCheckedAt: "2026-06-20T08:00:00.000Z",
        nextCheckAt: "2026-06-21T08:00:00.000Z",
        lastResult: {
          checkedAt: "2026-06-20T08:00:00.000Z",
          status: "contract-broken",
          message: "Hermes Agent contract broken.",
        },
        autoApplySuppressed: false,
        autoApplySuppressionReason: null,
        autoApplySuppressedAt: null,
        autoApplySuppressedSha: null,
      }),
      rollbackEngine: vi.fn().mockResolvedValue({
        success: true,
        sha: "abc123def456abc123def456abc123def456abcd",
      }),
      runHermesUpstreamWatch: vi.fn().mockResolvedValue({
        lastRunAt: "2026-06-20T09:00:00.000Z",
        lastSeenCommit: "a0471e2",
        lastSeenRelease: "v2026.6.19",
        latestReportPath:
          "/tmp/hermes/profiles/work/upstream-watch/2026-06-20.md",
        classifiedCounts: {
          "desktop-parity": 2,
          "cron-automation": 1,
        },
      }),
      openFileInEditor: vi.fn().mockResolvedValue(true),
    };

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: hermesAPI as unknown as Window["hermesAPI"],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows distinct xAI API-key, Grok OAuth, and agent update affordances", async () => {
    renderProviders();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "AI Setup" }),
      ).toBeInTheDocument();
      expect(screen.getByText("xAI (Grok) API Key")).toBeInTheDocument();
    });

    expect(screen.getAllByText("xAI Grok (OAuth)").length).toBeGreaterThan(0);
    expect(screen.getByText("API key saved")).toBeInTheDocument();
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getAllByText("Active model").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Test").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Use").length).toBeGreaterThan(0);
    expect(screen.getByText("Remove local sign-in")).toBeInTheDocument();
    expect(screen.getByText("Hermes Agent Updates")).toBeInTheDocument();
    expect(
      screen.getByText(
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(new Date("2026-06-20T08:00:00.000Z")),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Run now")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Notify-only")).toBeInTheDocument();
    expect(screen.getByText("Upstream Watch")).toBeInTheDocument();
    expect(screen.getByText("a0471e2")).toBeInTheDocument();
    expect(screen.getByText("Anchor")).toBeInTheDocument();
    expect(screen.getByText("Pending commits")).toBeInTheDocument();
    expect(screen.getByText("Contract-risk files")).toBeInTheDocument();
    expect(screen.getByText("Anchor").parentElement).toHaveTextContent(
      "abc123d",
    );
    expect(screen.getByText("Pending commits").parentElement).toHaveTextContent(
      "2",
    );
    expect(
      screen.getByText("Contract-risk files").parentElement,
    ).toHaveTextContent("1");
    expect(screen.getByText("Open report")).toBeInTheDocument();
    expect(screen.getByText("Engine features")).toBeInTheDocument();
    expect(screen.getByText("Verify engine contract")).toBeInTheDocument();
    expect(screen.getByText("Contract status")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("No findings")).toBeInTheDocument();
    expect(screen.getAllByText("abc123d").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1 enabled")).toBeInTheDocument();
    expect(screen.getByText("1 endpoint")).toBeInTheDocument();
  });

  it("runs engine contract verification for the active profile", async () => {
    renderProviders();

    const button = await screen.findByRole("button", {
      name: /verify engine contract/i,
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(verifyEngineContract).toHaveBeenCalledWith("work");
      expect(screen.getByText("Broken")).toBeInTheDocument();
      expect(screen.getByText("1 finding")).toBeInTheDocument();
      expect(
        screen.getByText("Engine contract has breaking findings."),
      ).toBeInTheDocument();
    });
  });

  it("refreshes the engine capability snapshot for the active profile", async () => {
    renderProviders();

    const refreshButton = await screen.findByRole("button", {
      name: /refresh engine features/i,
    });
    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(window.hermesAPI.refreshEngineCapabilities).toHaveBeenCalledWith(
        "work",
      );
    });
  });

  it("does not show rollback when no last verified SHA is recorded", async () => {
    renderProviders();

    await screen.findByText("Engine features");

    expect(
      screen.queryByRole("button", { name: /rollback engine/i }),
    ).not.toBeInTheDocument();
  });

  it("shows contract-break suppression and acknowledges it for the active profile", async () => {
    const api = window.hermesAPI as unknown as {
      getHermesAgentUpdateRoutine: ReturnType<typeof vi.fn>;
      acknowledgeHermesAgentUpdateContractBreak: ReturnType<typeof vi.fn>;
    };
    api.getHermesAgentUpdateRoutine.mockResolvedValue({
      enabled: true,
      autoApply: true,
      engineUpdateChannel: "release",
      schedule: "0 4 * * *",
      timezone: "America/New_York",
      lastCheckedAt: "2026-06-20T08:00:00.000Z",
      nextCheckAt: "2026-06-21T08:00:00.000Z",
      lastResult: {
        checkedAt: "2026-06-20T08:00:00.000Z",
        status: "contract-broken",
        message: "Hermes Agent contract broken.",
      },
      autoApplySuppressed: true,
      autoApplySuppressionReason: "contract-broken",
      autoApplySuppressedAt: "2026-06-20T08:00:00.000Z",
      autoApplySuppressedSha: "def4567890abcdef1234567890abcdef12345678",
    });

    renderProviders();

    expect(
      await screen.findByText(
        /Auto-apply is paused after a broken engine contract/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /resume auto-apply/i }));

    await waitFor(() => {
      expect(
        api.acknowledgeHermesAgentUpdateContractBreak,
      ).toHaveBeenCalledWith("work");
      expect(screen.getByText("Auto-apply resumed.")).toBeInTheDocument();
    });
  });

  it("confirms and runs rollback to the last verified SHA", async () => {
    const lastVerifiedSha = "abc123def456abc123def456abc123def456abcd";
    const capabilityState = {
      installedSha: "def4567890abcdef1234567890abcdef12345678",
      lastVerifiedSha,
      lastVerification: {
        checkedAt: "2026-06-19T10:00:00.000Z",
        status: "passed",
        findings: [],
      },
      snapshot: {
        status: "ready",
        fetchedAt: "2026-06-19T09:30:00.000Z",
        mode: "local",
        engineSha: "def4567890abcdef1234567890abcdef12345678",
        features: {},
        endpoints: {},
      },
    };
    const api = window.hermesAPI as unknown as {
      getEngineCapabilities: ReturnType<typeof vi.fn>;
      refreshEngineCapabilities: ReturnType<typeof vi.fn>;
      rollbackEngine: ReturnType<typeof vi.fn>;
    };
    api.getEngineCapabilities.mockResolvedValue(capabilityState);
    api.refreshEngineCapabilities.mockResolvedValue({
      ...capabilityState,
      installedSha: lastVerifiedSha,
      snapshot: {
        ...capabilityState.snapshot,
        engineSha: lastVerifiedSha,
      },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderProviders();

    const rollbackButton = await screen.findByRole("button", {
      name: /rollback engine/i,
    });
    fireEvent.click(rollbackButton);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("reinstalls Python dependencies"),
      );
      expect(api.rollbackEngine).toHaveBeenCalledWith("work");
      expect(
        screen.getByText(/Hermes Agent rolled back to abc123d/),
      ).toBeInTheDocument();
    });
  });

  it("removes an API-key provider through the existing blank setEnv seam", async () => {
    renderProviders();

    const removeButton = await screen.findByRole("button", {
      name: /remove xAI \(Grok\) API Key/i,
    });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(window.hermesAPI.setEnv).toHaveBeenCalledWith(
        "XAI_API_KEY",
        "",
        "work",
      );
    });
    expect(screen.getByPlaceholderText("xAI (Grok) API Key")).toHaveValue("");
    expect(screen.getAllByText("Missing credential").length).toBeGreaterThan(0);
  });
});
