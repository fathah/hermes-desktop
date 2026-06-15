import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResearchReachSummary from "./ResearchReachSummary";

const api = {
  getResearchReachStatus: vi.fn(),
  getResearchReachInstallInstructions: vi.fn(),
  runResearchReachSafeInstall: vi.fn(),
  importAgentReachSkill: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("ResearchReachSummary", () => {
  it("renders ready and setup-needed channels", async () => {
    api.getResearchReachStatus.mockResolvedValue({
      installed: true,
      version: "1.5.0",
      checkedAt: Date.now(),
      channels: [
        {
          key: "github",
          label: "GitHub",
          status: "ready",
          tier: 0,
          activeBackend: "gh CLI",
          backends: ["gh CLI"],
          message: "ready",
          needsLogin: false,
          zeroConfig: true,
        },
        {
          key: "reddit",
          label: "Reddit",
          status: "needsSetup",
          tier: 1,
          activeBackend: "OpenCLI",
          backends: ["OpenCLI", "rdt-cli"],
          message: "login required",
          needsLogin: true,
          zeroConfig: false,
        },
      ],
    });

    render(<ResearchReachSummary active={true} />);

    expect(await screen.findByText("Research Reach")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Reddit")).toBeInTheDocument();
    expect(screen.getByText("1 ready / 1 needs setup")).toBeInTheDocument();
  });

  it("shows install instructions without running install", async () => {
    api.getResearchReachStatus.mockResolvedValue({
      installed: false,
      version: null,
      checkedAt: Date.now(),
      channels: [],
      error: "Agent-Reach is not installed.",
    });
    api.getResearchReachInstallInstructions.mockResolvedValue(
      "pipx install agent-reach",
    );

    render(<ResearchReachSummary active={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /show setup/i }));

    expect(await screen.findByText("pipx install agent-reach")).toBeInTheDocument();
    expect(api.runResearchReachSafeInstall).not.toHaveBeenCalled();
  });

  it("loads lazily only when active", async () => {
    api.getResearchReachStatus.mockResolvedValue({
      installed: false,
      version: null,
      checkedAt: Date.now(),
      channels: [],
    });

    render(<ResearchReachSummary active={false} />);

    await waitFor(() => {
      expect(api.getResearchReachStatus).not.toHaveBeenCalled();
    });
  });
});
