import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ControlCenterOverview from "./ControlCenterOverview";
import type { NormalizedAdminView } from "../../lib/openSettings";
import type { OperatorReadinessReport } from "../../../../shared/operator-readiness";

const setSurface = vi.fn();
const setScheduledOpen = vi.fn();

vi.mock("../SpsAgent/store", () => ({
  useStore: {
    getState: () => ({ setSurface, setScheduledOpen }),
  },
}));

function readinessReport(): OperatorReadinessReport {
  return {
    profile: "default",
    status: "attention",
    headline: "Ready with follow-up work",
    summary: "0 blocked, 3 need attention, 0 ready.",
    generatedAt: 1,
    items: [
      {
        id: "review",
        title: "Review queue",
        status: "attention",
        summary: "2 pending vault proposals need review.",
        action: {
          label: "Open Review Queue",
          target: { kind: "surface", surface: "review" },
        },
      },
      {
        id: "scheduler",
        title: "Scheduler",
        status: "attention",
        summary: "1 scheduled job skip recorded.",
        action: {
          label: "Open Scheduled",
          target: { kind: "modal", modal: "scheduled" },
        },
      },
      {
        id: "storage",
        title: "Storage writes",
        status: "attention",
        summary: "1 storage warning reported.",
        action: {
          label: "Open Data & Privacy",
          target: { kind: "settings", view: "dataPrivacy" },
        },
      },
    ],
  };
}

function installHermesApi(
  overrides: Partial<Window["hermesAPI"]> = {},
): Partial<Window["hermesAPI"]> {
  const api = {
    getConnectionConfig: vi.fn().mockResolvedValue({
      mode: "local",
      remoteUrl: "",
      hasApiKey: true,
      apiKeyLength: 16,
      ssh: {
        host: "",
        port: 22,
        username: "",
        keyPath: "",
        remotePort: 8642,
        localPort: 18642,
      },
    }),
    getModelConfig: vi.fn().mockResolvedValue({
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      baseUrl: "",
    }),
    validateChatReadiness: vi.fn().mockResolvedValue({ ok: true }),
    getOperatorReadiness: vi.fn().mockResolvedValue(readinessReport()),
    ...overrides,
  } satisfies Partial<Window["hermesAPI"]>;

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("ControlCenterOverview", () => {
  beforeEach(() => {
    setSurface.mockClear();
    setScheduledOpen.mockClear();
    installHermesApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("renders the task cards users need from the settings gear", () => {
    render(
      <ControlCenterOverview
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        profile="default"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Control Center" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open AI Setup" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Open Data & Privacy" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Open Troubleshooting" }),
    ).toBeEnabled();
  });

  it("routes personalization to the existing My Alignment surface", () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn<(view: NormalizedAdminView) => void>();

    render(
      <ControlCenterOverview
        onNavigate={onNavigate}
        onClose={onClose}
        profile="default"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Personalization" }),
    );

    expect(setSurface).toHaveBeenCalledWith("you");
    expect(onClose).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows ready local AI status and the active model", async () => {
    render(
      <ControlCenterOverview
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        profile="default"
      />,
    );

    expect(await screen.findByText("Ready to chat")).toBeInTheDocument();
    expect(
      screen.getByText("anthropic / claude-3-5-sonnet"),
    ).toBeInTheDocument();
    expect(window.hermesAPI.getConnectionConfig).toHaveBeenCalled();
    expect(window.hermesAPI.getModelConfig).toHaveBeenCalledWith("default");
    expect(window.hermesAPI.validateChatReadiness).toHaveBeenCalledWith(
      "default",
    );
  });

  it("shows operator readiness and routes its fix actions", async () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn<(view: NormalizedAdminView) => void>();

    render(
      <ControlCenterOverview
        onNavigate={onNavigate}
        onClose={onClose}
        profile="default"
      />,
    );

    const panel = await screen.findByRole("region", {
      name: "Operator readiness",
    });
    expect(
      within(panel).getByText("Ready with follow-up work"),
    ).toBeInTheDocument();
    expect(window.hermesAPI.getOperatorReadiness).toHaveBeenCalledWith(
      "default",
    );

    fireEvent.click(
      within(panel).getByRole("button", { name: "Open Review Queue" }),
    );
    expect(setSurface).toHaveBeenCalledWith("review");
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(
      within(panel).getByRole("button", { name: "Open Scheduled" }),
    );
    expect(setScheduledOpen).toHaveBeenCalledWith(true);

    fireEvent.click(
      within(panel).getByRole("button", { name: "Open Data & Privacy" }),
    );
    expect(onNavigate).toHaveBeenCalledWith("dataPrivacy");
  });

  it("routes missing API key status to AI Setup", async () => {
    installHermesApi({
      validateChatReadiness: vi.fn().mockResolvedValue({
        ok: false,
        code: "MISSING_API_KEY",
        fixLocation: "providers",
      }),
    });
    const onNavigate = vi.fn<(view: NormalizedAdminView) => void>();

    render(
      <ControlCenterOverview
        onNavigate={onNavigate}
        onClose={vi.fn()}
        profile="default"
      />,
    );

    expect(await screen.findByText("Add API key")).toBeInTheDocument();
    const statusStrip = screen.getByText("AI status").closest("section");
    expect(statusStrip).not.toBeNull();
    fireEvent.click(
      within(statusStrip as HTMLElement).getByRole("button", {
        name: "Open AI Setup",
      }),
    );

    expect(onNavigate).toHaveBeenCalledWith("aiSetup");
  });

  it("routes missing active model status to Models", async () => {
    installHermesApi({
      getModelConfig: vi.fn().mockResolvedValue({
        provider: "anthropic",
        model: "",
        baseUrl: "",
      }),
      validateChatReadiness: vi.fn().mockResolvedValue({
        ok: false,
        code: "NO_ACTIVE_MODEL",
        fixLocation: "models",
      }),
    });
    const onNavigate = vi.fn<(view: NormalizedAdminView) => void>();

    render(
      <ControlCenterOverview
        onNavigate={onNavigate}
        onClose={vi.fn()}
        profile="default"
      />,
    );

    expect(await screen.findByText("Choose a model")).toBeInTheDocument();
    expect(screen.getByText("No model selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Models" }));

    expect(onNavigate).toHaveBeenCalledWith("models");
  });

  it("shows remote connection guidance without local-only setup dead ends", async () => {
    const api = installHermesApi();
    const onNavigate = vi.fn<(view: NormalizedAdminView) => void>();

    render(
      <ControlCenterOverview
        onNavigate={onNavigate}
        onClose={vi.fn()}
        profile="default"
        remoteMode
      />,
    );

    const statusStrip = screen.getByText("AI status").closest("section");
    expect(statusStrip).not.toBeNull();
    expect(
      within(statusStrip as HTMLElement).getByText("Remote-managed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Configured on remote server")).toBeInTheDocument();
    fireEvent.click(
      within(statusStrip as HTMLElement).getByRole("button", {
        name: "Review remote connection",
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith("advanced");

    expect(
      screen.queryByRole("button", { name: "Open AI Setup" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Connected Apps" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remote-managed" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Remote Connection" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review Connection" }));
    expect(onNavigate).toHaveBeenCalledWith("advanced");
    await waitFor(() => {
      expect(api.getModelConfig).not.toHaveBeenCalled();
      expect(api.validateChatReadiness).not.toHaveBeenCalled();
    });
  });
});
