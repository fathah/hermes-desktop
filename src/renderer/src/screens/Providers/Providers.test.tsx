import { render, screen, waitFor } from "@testing-library/react";
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

describe("Providers", () => {
  beforeEach(() => {
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
        schedule: "0 4 * * *",
        timezone: "Asia/Kolkata",
        lastCheckedAt: "2026-06-19T22:30:00.000Z",
        nextCheckAt: "2026-06-20T22:30:00.000Z",
        lastResult: {
          checkedAt: "2026-06-19T22:30:00.000Z",
          status: "available",
          message: "Hermes Agent update available.",
          behindBy: 2,
          changelog: "abc123 Update Hermes Agent",
        },
      }),
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
        schedule: "0 4 * * *",
        timezone: "Asia/Kolkata",
        lastCheckedAt: null,
        nextCheckAt: "2026-06-20T22:30:00.000Z",
        lastResult: null,
      }),
      runHermesAgentUpdateCheck: vi.fn().mockResolvedValue({
        checkedAt: "2026-06-20T22:30:00.000Z",
        status: "available",
        message: "Hermes Agent update available.",
      }),
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
    expect(screen.getByText("4:00 AM IST")).toBeInTheDocument();
    expect(screen.getByText("Run now")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });
});
